//! 录制状态机：同步定位棋盘 → 后台线程 200ms 轮询识别 → 帧间 diff 产出走子事件
//! 事件: recorder://status | recorder://position | recorder://move | recorder://warning

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::capture::{find_window, CaptureWindow};
use crate::detect::{
    board_check, board_diff, board_fix, board_fen, detections_bound, detections_to_board, BoardChangeState, Camp,
};
use crate::yolo;

const LOOP_INTERVAL_MS: u64 = 200;
/// One 态(动画中间态)的复核等待
const CONFIRM_DELAY_MS: u64 = 120;
const MAX_CAPTURE_FAILURES: usize = 3;
const MAX_CHECK_FAILURES: usize = 3;
const MAX_UNKNOWN_CHANGES: usize = 3;

// ---- 事件 payload ----

#[derive(Serialize, Clone)]
pub struct StatusPayload {
    /// locating | recording | stopped | error
    pub phase: String,
    pub message: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct PositionPayload {
    pub fen: String,
}

#[derive(Serialize, Clone)]
pub struct MovePayload {
    pub ply: u32,
    pub from: String,
    pub to: String,
    pub piece: String,
    pub captured: Option<String>,
    pub fen: String,
}

#[derive(Serialize, Clone)]
pub struct WarningPayload {
    pub message: String,
}

// ---- 全局录制状态 ----

#[derive(Default)]
struct Inner {
    thread: Option<JoinHandle<()>>,
    stop_flag: Option<Arc<AtomicBool>>,
    /// 会话代号, 后台线程退出时仅清理属于自己的会话, 防止误清新一轮录制
    generation: u64,
}

struct RecorderState {
    inner: Mutex<Inner>,
}

static STATE: OnceLock<RecorderState> = OnceLock::new();

fn state() -> &'static RecorderState {
    STATE.get_or_init(|| RecorderState { inner: Mutex::new(Inner::default()) })
}

// ---- 后台线程 ----

struct RecorderContext {
    app: AppHandle,
    window: CaptureWindow,
    stop: Arc<AtomicBool>,
    generation: u64,
    last_board: [[char; 9]; 10],
}

fn emit_status(app: &AppHandle, phase: &str, message: Option<&str>) {
    let _ = app.emit("recorder://status", StatusPayload { phase: phase.to_string(), message: message.map(Into::into) });
}

fn emit_warning(app: &AppHandle, message: &str) {
    let _ = app.emit("recorder://warning", WarningPayload { message: message.to_string() });
}

/// 起点 FEN 行棋方固定红先(识别已归一化为红下黑上), 第 n 手后按手数交替
fn turn_after_ply(ply: u32) -> char {
    if ply % 2 == 1 { 'b' } else { 'w' }
}

/// 单帧完整识别: 截图 → 推理 → 归一化为红下黑上; 任一步失败返回 None
fn recognize(window: &CaptureWindow) -> Option<(Camp, [[char; 9]; 10])> {
    let image = window.capture()?;
    let detections = yolo::predict(image).ok()?;
    let (camp, mut board) = detections_to_board(&detections).ok()?;
    board_fix(&camp, &mut board);
    Some((camp, board))
}

/// 包一层捕获 panic: 线程内任何未预期错误只终止本次录制, 不连锁拖垮调用方
fn record_loop_guarded(ctx: RecorderContext) {
    let RecorderContext { app, window, stop, generation, last_board } = ctx;
    // panic 分支也要能发事件, 在进入闭包前留一份轻量句柄
    let panic_app = app.clone();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        record_loop(app, window, stop, generation, last_board);
    }));
    if let Err(e) = result {
        let msg = e
            .downcast_ref::<String>()
            .map(|s| s.as_str())
            .or_else(|| e.downcast_ref::<&str>().copied())
            .unwrap_or("未知错误");
        emit_status(&panic_app, "error", Some(&format!("录制线程异常退出: {msg}")));
    }
    cleanup_session(generation);
}

fn record_loop(app: AppHandle, window: CaptureWindow, stop: Arc<AtomicBool>, _generation: u64, mut last_board: [[char; 9]; 10]) {
    let mut ply: u32 = 0;
    let mut capture_failures = 0usize;
    let mut check_failures = 0usize;
    let mut unknown_count = 0usize;
    let mut paused = false;

    loop {
        if stop.load(Ordering::Relaxed) {
            emit_status(&app, "stopped", None);
            break;
        }
        thread::sleep(Duration::from_millis(LOOP_INTERVAL_MS));

        // 截图连续失败多为目标窗口已关闭, 通知后结束录制
        let Some(image) = window.capture() else {
            capture_failures += 1;
            if capture_failures >= MAX_CAPTURE_FAILURES {
                emit_status(&app, "error", Some("窗口已关闭，录制停止"));
                emit_status(&app, "stopped", None);
                break;
            }
            continue;
        };
        capture_failures = 0;

        // 推理出当前盘面(已归一化红下黑上)
        let frame = match yolo::predict(image) {
            Ok(d) => d,
            Err(_) => {
                check_failures += 1;
                if check_failures >= MAX_CHECK_FAILURES {
                    emit_warning(&app, "棋盘识别失败，请确认棋盘完整可见");
                    check_failures = 0;
                }
                continue;
            }
        };
        let (camp, mut board) = match detections_to_board(&frame) {
            Ok(v) => v,
            Err(_) => {
                check_failures += 1;
                if check_failures >= MAX_CHECK_FAILURES {
                    emit_warning(&app, "棋盘识别失败，请确认棋盘完整可见");
                    check_failures = 0;
                }
                continue;
            }
        };
        board_fix(&camp, &mut board);

        // 暂停中不接受新盘面, 画面回到已知盘面才恢复识别
        if paused {
            if board == last_board {
                paused = false;
                unknown_count = 0;
            }
            continue;
        }

        if board == last_board {
            unknown_count = 0;
            continue;
        }

        if !board_check(board) {
            check_failures += 1;
            if check_failures >= MAX_CHECK_FAILURES {
                emit_warning(&app, "棋盘识别失败，请确认棋盘完整可见");
                check_failures = 0;
            }
            continue;
        }
        check_failures = 0;

        let (changed, change_state) = board_diff(last_board, board);
        match change_state {
            BoardChangeState::Move => {
                last_board = board;
                unknown_count = 0;
                ply += 1;
                let _ = app.emit(
                    "recorder://move",
                    MovePayload {
                        ply,
                        from: changed.from,
                        to: changed.to,
                        piece: changed.piece.to_string(),
                        captured: changed.captured.map(|c| c.to_string()),
                        fen: board_fen(turn_after_ply(ply), board),
                    },
                );
            }
            BoardChangeState::One => {
                // 单格变化多为走子动画, 稍候立即补截一帧确认是否为完整一步
                thread::sleep(Duration::from_millis(CONFIRM_DELAY_MS));
                if let Some((_camp2, board2)) = recognize(&window) {
                    if board2 != last_board && board_check(board2) {
                        let (changed2, state2) = board_diff(last_board, board2);
                        if let BoardChangeState::Move = state2 {
                            last_board = board2;
                            unknown_count = 0;
                            ply += 1;
                            let _ = app.emit(
                                "recorder://move",
                                MovePayload {
                                    ply,
                                    from: changed2.from,
                                    to: changed2.to,
                                    piece: changed2.piece.to_string(),
                                    captured: changed2.captured.map(|c| c.to_string()),
                                    fen: board_fen(turn_after_ply(ply), board2),
                                },
                            );
                        }
                    }
                }
            }
            BoardChangeState::Unknown => {
                unknown_count += 1;
                if unknown_count >= MAX_UNKNOWN_CHANGES {
                    emit_warning(&app, "画面变化异常，已暂停识别，请确认棋盘完整可见");
                    paused = true;
                    unknown_count = 0;
                }
            }
        }
    }
}

/// 后台线程退出后清理会话槽位(仅当仍是本会话)
fn cleanup_session(generation: u64) {
    if let Ok(mut inner) = state().inner.lock() {
        if inner.generation == generation {
            inner.thread = None;
            inner.stop_flag = None;
        }
    }
}

// ---- Tauri 命令 ----

/// 开始录制: 定位目标窗口中的棋盘并识别初始盘面, 返回起点 FEN
#[tauri::command]
pub async fn start_recording(app: AppHandle, window_id: u32) -> Result<String, String> {
    let fen = {
        // 先检查再占用, 整个过程持锁防止并发双开
        let mut inner = state().inner.lock().map_err(|_| "录制状态异常".to_string())?;
        if inner.thread.is_some() {
            return Err("已经在录制中".to_string());
        }

        emit_status(&app, "locating", Some("正在定位棋盘"));

        // 整窗截图识别棋盘位置, 缓存裁剪区
        let mut cap = find_window(window_id).map(CaptureWindow::new).ok_or("目标窗口不存在")?;
        let image = cap.capture().ok_or("无法截取目标窗口画面")?;
        let (w, h) = (image.width(), image.height());
        let detections = yolo::predict(image)?;
        let (x, y, cw, ch) = detections_bound(w, h, &detections)?;
        cap.set_bound(x, y, cw, ch);

        // 裁剪区内重新识别初始盘面
        let image = cap.capture().ok_or("无法截取目标窗口画面")?;
        let detections = yolo::predict(image)?;
        let (camp, mut board) = detections_to_board(&detections)?;
        board_fix(&camp, &mut board);
        if !board_check(board) {
            return Err("棋盘识别无效，请确认窗口内棋盘完整且清晰".to_string());
        }
        // 起点行棋方固定红先: 识别盘面已归一化为红下黑上, 无法从画面判断真实行棋方
        let fen = board_fen('w', board);

        // 启动后台识别线程
        let generation = inner.generation.wrapping_add(1);
        let stop = Arc::new(AtomicBool::new(false));
        let ctx = RecorderContext { app: app.clone(), window: cap, stop: stop.clone(), generation, last_board: board };
        inner.thread = Some(thread::spawn(move || record_loop_guarded(ctx)));
        inner.stop_flag = Some(stop);
        inner.generation = generation;
        fen
    };

    emit_status(&app, "recording", Some("开始录制"));
    let _ = app.emit("recorder://position", PositionPayload { fen: fen.clone() });
    Ok(fen)
}

/// 停止录制: 置停止标志并回收线程; join 移到独立线程保证命令立即返回
#[tauri::command]
pub fn stop_recording() -> Result<(), String> {
    let handle = {
        let mut inner = state().inner.lock().map_err(|_| "录制状态异常".to_string())?;
        inner.stop_flag.as_ref().map(|f| f.store(true, Ordering::Relaxed));
        inner.stop_flag = None;
        inner.thread.take()
    };
    match handle {
        Some(handle) => {
            thread::spawn(move || {
                let _ = handle.join();
            });
            Ok(())
        }
        None => Err("当前没有正在进行的录制".to_string()),
    }
}
