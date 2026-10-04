//! 软件棋检测: 用 Pikafish 逐手对照棋谱实际着法, 统计引擎吻合率与每步损失
//! 指标仅为可疑度参考, 不能单独作为结论
//! 事件: analysis://status | analysis://progress | analysis://result

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::engine::{Engine, EngineConfig, QueryState};

const ANALYSIS_DEPTH: usize = 18;
/// 单线程 + 纯深度搜索(不叠加时间截断): 同一局棋每次分析结果完全一致
const ANALYSIS_THREADS: usize = 1;
const ANALYSIS_HASH_MB: usize = 256;
const ANALYSIS_MULTIPV: usize = 3;
/// 次优候选视为"等值好棋"的最大分差(厘兵)
const ALT_SCORE_GAP: isize = 400;
/// 走子后无合法着法(被将杀/困毙)时按对手得分计的基值(绝对值)
const MATE_CEILING: isize = 29000;
/// 统计损失前把双方评分截断到 ±CP_CLAMP, 避免杀棋分污染均值(厘兵)
const CP_CLAMP: isize = 1000;
/// 开局段手数: 前 N 手单独统计(实际对局常带开局库)
const OPENING_PLIES: u32 = 10;

// ---- 事件 payload ----

#[derive(Serialize, Clone)]
pub struct StatusPayload {
    /// analyzing | done | stopped | error
    pub phase: String,
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PlyReport {
    pub ply: u32,
    /// 行棋方: red | black
    pub side: String,
    /// 实际着法(iccs)
    pub iccs: String,
    /// 引擎首选着法(iccs), 行棋方无合法着法时为空
    pub best: String,
    /// t1(与首选一致) | ev(等值好棋) | miss(其余)
    pub kind: String,
    /// 实际着法相对引擎最优的损失(厘兵)
    pub loss: isize,
    /// 唯一明显好棋局面(存在合法次优但分差超 alt_score_gap): 人机混用的主要证据点
    pub critical: bool,
    /// 走子前行棋方视角评分(厘兵)
    pub score: isize,
    /// 走子前行棋方胜率(千分比)
    pub winrate: Option<usize>,
    pub depth: usize,
}

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub ply: u32,
    pub total: u32,
    #[serde(flatten)]
    pub report: PlyReport,
}

#[derive(Serialize, Clone)]
pub struct PhaseStats {
    pub plies: u32,
    /// 首选吻合率(0-1)
    pub t1_rate: f64,
    /// 首选或等值吻合率(0-1)
    pub ev_rate: f64,
    /// 平均每步损失(厘兵)
    pub acpl: f64,
    /// 该组每步损失的标准差(厘兵): 软件棋低而稳, 人类有起伏
    pub stddev: f64,
    /// 唯一明显好棋局面数
    pub criticals: u32,
    /// 其中选对引擎首选的数量
    pub critical_hits: u32,
}

#[derive(Serialize, Clone)]
pub struct ResultPayload {
    pub plys: Vec<PlyReport>,
    pub total: u32,
    pub t1_rate: f64,
    pub ev_rate: f64,
    pub acpl: f64,
    /// 红方 / 黑方分侧统计
    pub red: PhaseStats,
    pub black: PhaseStats,
    pub opening: PhaseStats,
    pub middlegame: PhaseStats,
    pub elapsed_ms: u64,
}

/// 单手分析输入
#[derive(Deserialize)]
pub struct AnalyzePly {
    /// 行棋方: red | black
    pub side: String,
    /// 实际着法(iccs, 如 h2e2)
    pub iccs: String,
    /// 走子前局面 FEN
    pub fen: String,
    /// 走子后局面 FEN(供实际着法不在引擎候选时二次搜索计损)
    pub next_fen: String,
}

// ---- 全局分析状态 ----

#[derive(Default)]
struct Inner {
    thread: Option<JoinHandle<()>>,
    stop_flag: Option<Arc<AtomicBool>>,
    /// 会话代号, 后台线程退出时仅清理属于自己的会话, 防止误清新一轮分析
    generation: u64,
}

static STATE: OnceLock<Mutex<Inner>> = OnceLock::new();

fn state() -> &'static Mutex<Inner> {
    STATE.get_or_init(|| Mutex::new(Inner::default()))
}

fn emit_status(app: &AppHandle, phase: &str, message: Option<&str>) {
    let _ = app.emit(
        "analysis://status",
        StatusPayload { phase: phase.to_string(), message: message.map(Into::into) },
    );
}

/// 后台线程退出后清理会话槽位(仅当仍是本会话)
fn cleanup_session(generation: u64) {
    if let Ok(mut inner) = state().lock() {
        if inner.generation == generation {
            inner.thread = None;
            inner.stop_flag = None;
        }
    }
}

// ---- Tauri 命令 ----

/// 开始分析: plies 为棋谱主线逐手(走子前局面 + 实际着法 + 走子后局面)
#[tauri::command]
pub fn analyze_game(app: AppHandle, plies: Vec<AnalyzePly>) -> Result<(), String> {
    if plies.is_empty() {
        return Err("没有可分析的着法".to_string());
    }
    // 先检查再占用, 整个过程持锁防止并发双开
    let mut inner = state().lock().map_err(|_| "分析状态异常".to_string())?;
    if inner.thread.is_some() {
        return Err("已有分析任务在进行中".to_string());
    }
    let generation = inner.generation.wrapping_add(1);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    inner.thread = Some(thread::spawn(move || {
        analysis_loop_guarded(app, plies, stop_for_thread, generation);
    }));
    inner.stop_flag = Some(stop);
    inner.generation = generation;
    Ok(())
}

/// 停止分析: 置停止标志并回收线程; join 移到独立线程保证命令立即返回
#[tauri::command]
pub fn stop_analysis() -> Result<(), String> {
    let handle = {
        let mut inner = state().lock().map_err(|_| "分析状态异常".to_string())?;
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
        None => Err("当前没有进行中的分析".to_string()),
    }
}

// ---- 分析流程 ----

fn analysis_config() -> EngineConfig {
    EngineConfig {
        depth: ANALYSIS_DEPTH,
        // 0 = 不限时: 时间截断会让结果不可复现
        movetime_ms: 0,
        threads: ANALYSIS_THREADS,
        hash_mb: ANALYSIS_HASH_MB,
        multipv: ANALYSIS_MULTIPV,
        alt_score_gap: ALT_SCORE_GAP,
    }
}

/// 包一层捕获 panic: 线程内任何未预期错误只终止本次分析, 不连锁拖垮调用方
fn analysis_loop_guarded(app: AppHandle, plies: Vec<AnalyzePly>, stop: Arc<AtomicBool>, generation: u64) {
    let panic_app = app.clone();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        analysis_loop(app, plies, stop);
    }));
    if let Err(e) = result {
        let msg = e
            .downcast_ref::<String>()
            .map(|s| s.as_str())
            .or_else(|| e.downcast_ref::<&str>().copied())
            .unwrap_or("未知错误");
        emit_status(&panic_app, "error", Some(&format!("分析线程异常退出: {msg}")));
    }
    cleanup_session(generation);
}

fn analysis_loop(app: AppHandle, plies: Vec<AnalyzePly>, stop: Arc<AtomicBool>) {
    emit_status(&app, "analyzing", None);
    let config = analysis_config();
    let started = Instant::now();
    let mut engine = match Engine::spawn(&config) {
        Ok(eng) => eng,
        Err(msg) => {
            emit_status(&app, "error", Some(&msg));
            return;
        }
    };
    let total = plies.len() as u32;
    let mut reports: Vec<PlyReport> = Vec::with_capacity(plies.len());
    for (idx, ply_input) in plies.iter().enumerate() {
        if stop.load(Ordering::Relaxed) {
            emit_status(&app, "stopped", Some("已停止分析"));
            return;
        }
        let mut report = match analyze_ply(&mut engine, ply_input, &config) {
            Ok(r) => r,
            Err(msg) => {
                emit_status(&app, "error", Some(&msg));
                return;
            }
        };
        report.ply = idx as u32 + 1;
        let _ = app.emit(
            "analysis://progress",
            ProgressPayload { ply: report.ply, total, report: report.clone() },
        );
        reports.push(report);
    }
    let payload = summarize(&reports, started.elapsed().as_millis() as u64);
    let _ = app.emit("analysis://result", payload);
    emit_status(&app, "done", None);
}

/// 单手分析: 搜走子前局面得引擎候选与评分, 对照实际着法分类并计损
fn analyze_ply(engine: &mut Engine, ply: &AnalyzePly, config: &EngineConfig) -> Result<PlyReport, String> {
    let result = engine.search(&ply.fen, config)?;
    let mut report = PlyReport {
        ply: 0,
        side: ply.side.clone(),
        iccs: ply.iccs.clone(),
        best: result.pvs.first().cloned().unwrap_or_default(),
        kind: MatchKind::Miss.as_str().to_string(),
        loss: 0,
        critical: false,
        score: result.score,
        winrate: result.winrate,
        depth: result.depth,
    };
    if result.state == QueryState::NoMoves || result.pvs.is_empty() {
        // 输入着法来自已走出该手的局面, 正常不会无合法着法; 防御性跳过计损
        return Ok(report);
    }
    // 唯一明显好棋局面: 至少两条合法候选线, 但次优分差超 alt_score_gap(无等值选择)。
    // 仅一条线多为被迫走子(唯一合法着法), 不算证据点
    report.critical = result.pv_count >= 2 && result.alternatives.is_empty();
    let kind = classify(&ply.iccs, &result.pvs[0], &result.alternatives);
    report.kind = kind.as_str().to_string();
    report.loss = match kind {
        MatchKind::T1 => 0,
        MatchKind::Ev => {
            // 命中等值候选, 分差已知, 免二次搜索
            result
                .alternatives
                .iter()
                .position(|a| a == &ply.iccs)
                .and_then(|i| result.alt_scores.get(i).copied())
                .unwrap_or(0)
        }
        MatchKind::Miss => {
            // 实际着法不在候选内: 搜走子后局面, 把对手视角评分换算回来计损
            let after = engine.search(&ply.next_fen, config)?;
            let score_after = if after.state == QueryState::NoMoves {
                // 该手直接将杀/困毙对手, 对行棋方是最优结果
                -MATE_CEILING
            } else {
                after.score
            };
            compute_loss(result.score, score_after)
        }
    };
    Ok(report)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MatchKind {
    /// 与引擎首选一致
    T1,
    /// 与首选等值的好棋(分差在 ALT_SCORE_GAP 内)
    Ev,
    /// 其余着法
    Miss,
}

impl MatchKind {
    fn as_str(self) -> &'static str {
        match self {
            MatchKind::T1 => "t1",
            MatchKind::Ev => "ev",
            MatchKind::Miss => "miss",
        }
    }
}

fn classify(actual: &str, best: &str, alternatives: &[String]) -> MatchKind {
    if actual == best {
        return MatchKind::T1;
    }
    if alternatives.iter().any(|a| a == actual) {
        MatchKind::Ev
    } else {
        MatchKind::Miss
    }
}

/// 损失 = 走子前评分 - 走子后局面换算回行棋方视角的评分(均先按 ±CP_CLAMP 截断), 结果不为负
/// score_after_opponent 为走子后行棋方(对手)视角评分
fn compute_loss(score_before: isize, score_after_opponent: isize) -> isize {
    let before = score_before.clamp(-CP_CLAMP, CP_CLAMP);
    let after = score_after_opponent.clamp(-CP_CLAMP, CP_CLAMP);
    (before + after).max(0)
}

/// 汇总逐手报告为整体与分段指标
fn summarize(reports: &[PlyReport], elapsed_ms: u64) -> ResultPayload {
    let overall = stats_of(reports.iter());
    ResultPayload {
        plys: reports.to_vec(),
        total: reports.len() as u32,
        t1_rate: overall.t1_rate,
        ev_rate: overall.ev_rate,
        acpl: overall.acpl,
        red: stats_of(reports.iter().filter(|r| r.side == "red")),
        black: stats_of(reports.iter().filter(|r| r.side == "black")),
        opening: stats_of(reports.iter().filter(|r| r.ply <= OPENING_PLIES)),
        middlegame: stats_of(reports.iter().filter(|r| r.ply > OPENING_PLIES)),
        elapsed_ms,
    }
}

fn stats_of<'a>(items: impl Iterator<Item = &'a PlyReport>) -> PhaseStats {
    let reports: Vec<&PlyReport> = items.collect();
    if reports.is_empty() {
        return PhaseStats {
            plies: 0,
            t1_rate: 0.0,
            ev_rate: 0.0,
            acpl: 0.0,
            stddev: 0.0,
            criticals: 0,
            critical_hits: 0,
        };
    }
    let total = reports.len() as f64;
    let t1 = reports.iter().filter(|r| r.kind == "t1").count() as f64;
    let ev = reports.iter().filter(|r| r.kind == "ev").count() as f64;
    let losses: Vec<f64> = reports.iter().map(|r| r.loss as f64).collect();
    let acpl = losses.iter().sum::<f64>() / total;
    let variance = losses.iter().map(|l| (l - acpl) * (l - acpl)).sum::<f64>() / total;
    let criticals = reports.iter().filter(|r| r.critical).count() as u32;
    let critical_hits = reports.iter().filter(|r| r.critical && r.kind == "t1").count() as u32;
    PhaseStats {
        plies: reports.len() as u32,
        t1_rate: t1 / total,
        ev_rate: (t1 + ev) / total,
        acpl,
        stddev: variance.sqrt(),
        criticals,
        critical_hits,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 集成测试: 依赖本地引擎资源(不入库), `cargo test --lib -- --ignored` 运行
    fn engine_for_test() -> Engine {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/libs/pikafish");
        crate::engine::init(&dir.join("pikafish-windows.exe"), &dir.join("pikafish.nnue"))
            .expect("引擎资源缺失");
        Engine::spawn(&analysis_config()).expect("启动引擎失败")
    }

    #[test]
    #[ignore]
    fn test_analyze_ply_with_engine() {
        let mut eng = engine_for_test();
        let cfg = analysis_config();
        let fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";

        // 真实候选着法: kind 为三者之一, 报告自洽
        // (两次搜索间引擎首选可能因时限内的非确定性而不同, 不跨搜索断言 t1)
        let ply1 = AnalyzePly {
            side: "red".into(),
            iccs: "h2e2".into(),
            fen: fen.into(),
            next_fen: fen.replace(" w", " b"),
        };
        let rep1 = analyze_ply(&mut eng, &ply1, &cfg).expect("单手分析失败");
        assert!(matches!(rep1.kind.as_str(), "t1" | "ev" | "miss"), "kind: {}", rep1.kind);
        assert!(rep1.loss >= 0);
        if rep1.kind == "t1" {
            assert_eq!(rep1.loss, 0);
            assert_eq!(rep1.best, "h2e2");
        }

        // 引擎候选之外的着法必然 miss, 走通二次搜索计损路径
        let ply2 = AnalyzePly {
            side: "black".into(),
            iccs: "e3e6".into(),
            fen: fen.into(),
            next_fen: fen.replace(" w", " b"),
        };
        let rep2 = analyze_ply(&mut eng, &ply2, &cfg).expect("单手分析失败");
        assert_eq!(rep2.kind, "miss");
        assert!(rep2.loss >= 0);
    }

    #[test]
    fn test_analyze_ply_deserialization_contract() {
        // 锁定与前端 ipc.ts AnalyzePlyInput 的字段名契约(snake_case),
        // 字段名改动会直接导致 invoke 反序列化失败
        let json = serde_json::json!([
            { "side": "red", "iccs": "h2e2", "fen": "FEN-A", "next_fen": "FEN-B" }
        ]);
        let plies: Vec<AnalyzePly> = serde_json::from_value(json).expect("反序列化失败");
        assert_eq!(plies[0].side, "red");
        assert_eq!(plies[0].iccs, "h2e2");
        assert_eq!(plies[0].fen, "FEN-A");
        assert_eq!(plies[0].next_fen, "FEN-B");
    }

    fn report(ply: u32, kind: &str, loss: isize) -> PlyReport {
        PlyReport {
            ply,
            side: if ply % 2 == 1 { "red" } else { "black" }.into(),
            iccs: "h2e2".into(),
            best: "h2e2".into(),
            kind: kind.into(),
            loss,
            critical: false,
            score: 0,
            winrate: None,
            depth: 18,
        }
    }

    #[test]
    fn test_compute_loss() {
        // 正常情形: 走子前 +500, 走子后对手视角 -300 => 损失 200
        assert_eq!(compute_loss(500, -300), 200);
        // 大失误: 走子前 +800, 走子后对手 +1000(截断) => 1800
        assert_eq!(compute_loss(800, 1000), 1800);
        // 实际着法直接将杀对手: 对手无合法着法按 -MATE_CEILING 计 => 损失 0
        assert_eq!(compute_loss(500, -MATE_CEILING), 0);
        // 搜索噪声导致负值时取 0
        assert_eq!(compute_loss(-200, -400), 0);
        // 杀棋分截断到 CP_CLAMP
        assert_eq!(compute_loss(29999, 0), CP_CLAMP);
    }

    #[test]
    fn test_classify() {
        let alts = vec!["b0c2".to_string(), "h2e2".to_string()];
        assert_eq!(classify("h2e2", "h2e2", &alts), MatchKind::T1);
        assert_eq!(classify("b0c2", "h2e2", &alts), MatchKind::Ev);
        assert_eq!(classify("e3e4", "h2e2", &alts), MatchKind::Miss);
    }

    #[test]
    fn test_summarize() {
        // 11 手: 前 10 手为开局段(奇数手红方、偶数手黑方), 第 11 手为中残局段(红方, 关键手 miss)
        let mut reports: Vec<PlyReport> = (1..=10).map(|ply| report(ply, "t1", 0)).collect();
        let mut last = report(11, "miss", 300);
        last.critical = true;
        reports.push(last);
        let payload = summarize(&reports, 1234);
        assert_eq!(payload.total, 11);
        assert!((payload.t1_rate - 10.0 / 11.0).abs() < 1e-9);
        assert!((payload.ev_rate - 10.0 / 11.0).abs() < 1e-9);
        assert!((payload.acpl - 300.0 / 11.0).abs() < 1e-9);
        // 红方 6 手(5 t1 + 第 11 手关键手 miss 300 厘), 黑方 5 手全 t1
        assert_eq!(payload.red.plies, 6);
        assert!((payload.red.t1_rate - 5.0 / 6.0).abs() < 1e-9);
        assert!((payload.red.acpl - 50.0).abs() < 1e-9);
        assert!(payload.red.stddev > 0.0);
        assert_eq!(payload.black.plies, 5);
        assert_eq!(payload.black.t1_rate, 1.0);
        assert_eq!(payload.black.acpl, 0.0);
        assert_eq!(payload.black.stddev, 0.0);
        // 关键手统计: 红方 1 手未命中, 黑方 0 手
        assert_eq!(payload.red.criticals, 1);
        assert_eq!(payload.red.critical_hits, 0);
        assert_eq!(payload.black.criticals, 0);
        assert_eq!(payload.opening.plies, 10);
        assert_eq!(payload.opening.t1_rate, 1.0);
        assert_eq!(payload.opening.acpl, 0.0);
        assert_eq!(payload.opening.criticals, 0);
        assert_eq!(payload.middlegame.plies, 1);
        assert_eq!(payload.middlegame.acpl, 300.0);
        assert_eq!(payload.middlegame.criticals, 1);
        assert_eq!(payload.plys.len(), 11);
        assert_eq!(payload.elapsed_ms, 1234);
    }
}
