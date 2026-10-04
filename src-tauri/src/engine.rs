//! Pikafish UCI 引擎封装: 以独立子进程方式经标准输入输出收发 UCI 命令
//! 引擎以 GPL-3.0 独立进程运行, 通过进程边界与本应用通信

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::OnceLock;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 引擎可执行文件与 NNUE 权重路径, 应用启动时解析一次
static ENGINE_PATHS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();

/// 记录引擎资源路径(需确认文件存在), 重复调用以首次为准
pub fn init(exe_path: &Path, nnue_path: &Path) -> Result<(), String> {
    if !exe_path.is_file() {
        return Err(format!("引擎文件不存在：{}", exe_path.display()));
    }
    if !nnue_path.is_file() {
        return Err(format!("NNUE 权重文件不存在：{}", nnue_path.display()));
    }
    // 并发重复初始化时首次生效即可, 视为成功
    let _ = ENGINE_PATHS.set((exe_path.to_path_buf(), nnue_path.to_path_buf()));
    Ok(())
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct QueryResult {
    pub depth: usize,
    /// 得分(行棋方视角, 厘兵; 将杀分绝对值约 30000)
    pub score: isize,
    pub time: usize,
    /// 最优线完整着法(iccs), 首项即引擎首选
    pub pvs: Vec<String>,
    /// 引擎实际返回的候选线数量(受合法着法数限制)
    pub pv_count: usize,
    /// 与最优分差在 alt_score_gap 内的次优候选首着(iccs)
    pub alternatives: Vec<String>,
    /// 次优候选与最优的分差(厘兵)
    pub alt_scores: Vec<isize>,
    /// 行棋方胜率(千分比)
    pub winrate: Option<usize>,
    pub state: QueryState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub enum QueryState {
    /// 搜索正常完成
    Success,
    /// 行棋方无合法着法(被绝杀或困毙), 引擎返回 bestmove (none)
    #[default]
    NoMoves,
}

#[derive(Debug, Clone, Copy)]
pub struct EngineConfig {
    pub depth: usize,
    pub movetime_ms: u64,
    pub threads: usize,
    pub hash_mb: usize,
    pub multipv: usize,
    /// 次优候选纳入 alternatives 的最大分差(厘兵)
    pub alt_score_gap: isize,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self { depth: 18, movetime_ms: 500, threads: 4, hash_mb: 256, multipv: 3, alt_score_gap: 400 }
    }
}

// 引擎单行 info 解析结果
#[derive(Default)]
struct InfoLine {
    multipv: Option<usize>,
    pvs: Vec<String>,
    depth: usize,
    score: isize,
    time: usize,
    winrate: Option<usize>,
}

pub struct Engine {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Engine {
    /// 启动引擎子进程并加载 NNUE 权重与基础选项
    pub fn spawn(config: &EngineConfig) -> Result<Self, String> {
        let (exe, nnue) = ENGINE_PATHS
            .get()
            .ok_or("引擎未初始化（缺少 Pikafish 资源文件，应用启动日志有详情；dev 模式请重启 tauri dev 后重试）")?;
        let mut child = spawn_process(exe)?;
        let stdin = child.stdin.take().ok_or("无法获取引擎标准输入")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("无法获取引擎标准输出")?);
        let mut eng = Engine { child, stdin, stdout };
        eng.setoption("EvalFile", nnue.display().to_string())?;
        eng.setoption("Sixty Move Rule", false)?;
        eng.setoption("Threads", config.threads)?;
        eng.setoption("Hash", config.hash_mb)?;
        Ok(eng)
    }

    fn write_command<A: std::fmt::Display>(&mut self, args: A) -> Result<(), String> {
        writeln!(self.stdin, "{}", args).map_err(|e| format!("向引擎写入命令失败：{e}"))?;
        self.stdin.flush().map_err(|e| format!("向引擎写入命令失败：{e}"))
    }

    fn setoption<T: std::fmt::Display>(&mut self, name: &str, value: T) -> Result<(), String> {
        self.write_command(format!("setoption name {name} value {value}"))
    }

    fn read_line(&mut self) -> Result<String, String> {
        let mut line = String::new();
        let n = self
            .stdout
            .read_line(&mut line)
            .map_err(|e| format!("读取引擎输出失败：{e}"))?;
        // 读到 0 字节说明子进程已退出, 继续循环会死转
        if n == 0 {
            return Err("引擎进程已退出".to_string());
        }
        Ok(line.trim().to_string())
    }

    // 解析一行 info
    fn parse_info(&self, line: &str) -> InfoLine {
        let mut iter = line.split_whitespace();
        // 跳过 "info"
        iter.next();
        let mut info = InfoLine::default();
        loop {
            let Some(key) = iter.next() else { break };
            match key {
                "depth" => info.depth = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0),
                "time" => info.time = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0),
                "multipv" => info.multipv = iter.next().and_then(|v| v.parse().ok()),
                "wdl" => {
                    // wdl 为胜/和/负千分比, 取行棋方胜率
                    let win: usize = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                    let _draw: usize = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                    let _loss: usize = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                    info.winrate = Some(win);
                }
                "score" => match iter.next().unwrap_or("") {
                    "cp" => info.score = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0),
                    "mate" => {
                        let round: isize = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                        info.score = if round > 0 { 30000 - round } else { -(30000 + round) };
                    }
                    _ => {}
                },
                "pv" => {
                    // pv 是 info 行最后一个字段，收集剩余所有着法
                    info.pvs.extend(iter.by_ref().map(|s| s.to_string()));
                    break;
                }
                _ => {}
            }
        }
        info
    }

    // 读取搜索输出直到 bestmove, 汇总 MultiPV 候选
    fn parse_search_output(&mut self, alt_score_gap: isize) -> Result<QueryResult, String> {
        let mut result = QueryResult {
            state: QueryState::NoMoves,
            ..Default::default()
        };

        // multipv编号 -> 该候选的完整pv序列与分数
        let mut pvs_by_id: std::collections::BTreeMap<usize, (Vec<String>, isize)> =
            std::collections::BTreeMap::new();
        let mut last_pvs: Vec<String> = Vec::new();

        loop {
            let line = self.read_line()?;
            if line.starts_with("bestmove") {
                // 引擎对已绝杀局面返回 bestmove (none)
                if !line.contains("(none)") {
                    result.state = QueryState::Success;
                }
                break;
            }
            if !line.starts_with("info") {
                continue;
            }
            let info = self.parse_info(&line);
            if info.pvs.is_empty() {
                continue;
            }
            last_pvs = info.pvs.clone();
            match info.multipv {
                Some(id) => {
                    pvs_by_id.insert(id, (info.pvs, info.score));
                    if id == 1 {
                        result.depth = info.depth;
                        result.score = info.score;
                        result.time = info.time;
                        result.winrate = info.winrate;
                    }
                }
                None => {
                    result.depth = info.depth;
                    result.score = info.score;
                    result.time = info.time;
                    result.winrate = info.winrate;
                }
            }
        }

        // 最优线
        result.pv_count = pvs_by_id.len();
        if let Some((pv1, _)) = pvs_by_id.remove(&1) {
            result.pvs = pv1;
        } else if result.pvs.is_empty() {
            result.pvs = last_pvs;
        }
        // 次优候选首着（只保留分数接近最优的好招）
        for (pvs, sc) in pvs_by_id.values() {
            if let Some(first) = pvs.first() {
                if *sc >= result.score - alt_score_gap {
                    result.alternatives.push(first.clone());
                    result.alt_scores.push(result.score - sc);
                }
            }
        }
        Ok(result)
    }

    // 在指定局面搜索
    pub fn search(&mut self, fen: &str, config: &EngineConfig) -> Result<QueryResult, String> {
        self.setoption("MultiPV", config.multipv)?;
        self.write_command(format!("position fen {fen}"))?;
        // movetime_ms > 0 时叠加时间截断(会引入不确定性); 纯深度搜索单线程下完全可复现
        let mut go = format!("go depth {}", config.depth);
        if config.movetime_ms > 0 {
            go.push_str(&format!(" movetime {}", config.movetime_ms));
        }
        self.write_command(go)?;
        self.parse_search_output(config.alt_score_gap)
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = writeln!(self.stdin, "quit");
        let _ = self.stdin.flush();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(target_os = "windows")]
fn spawn_process(exe: &Path) -> Result<Child, String> {
    Command::new(exe)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("启动 Pikafish 失败：{e}"))
}

#[cfg(not(target_os = "windows"))]
fn spawn_process(_exe: &Path) -> Result<Child, String> {
    Err("引擎分析仅支持 Windows 平台".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 集成测试: 依赖本地引擎资源(不入库), `cargo test --lib -- --ignored` 运行
    fn engine_for_test() -> Engine {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/libs/pikafish");
        init(&dir.join("pikafish-windows.exe"), &dir.join("pikafish.nnue")).expect("引擎资源缺失");
        Engine::spawn(&EngineConfig::default()).expect("启动引擎失败")
    }

    #[test]
    #[ignore]
    fn test_engine_accepts_app_fen() {
        let mut eng = engine_for_test();
        // 应用使用的起始局面 FEN, 确认 Pikafish 能正常接收并搜索
        let fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";
        let result = eng.search(fen, &EngineConfig::default()).expect("搜索失败");
        assert_eq!(result.state, QueryState::Success);
        assert!(!result.pvs.is_empty(), "首选着法不应为空");
        assert!(!result.alternatives.is_empty(), "MultiPV 次优候选不应为空");
    }

    #[test]
    #[ignore]
    fn test_engine_mate_position() {
        let mut eng = engine_for_test();
        // 单车对孤将必胜
        let fen = "4k4/9/9/9/9/9/9/9/4R4/4K4 w";
        let result = eng.search(fen, &EngineConfig::default()).expect("搜索失败");
        assert!(!result.pvs.is_empty());
    }

    #[test]
    #[ignore]
    fn test_engine_consecutive_search() {
        let mut eng = engine_for_test();
        let cfg = EngineConfig::default();
        let fen = "3k5/9/9/9/9/9/9/9/4C4/4KR3 w";
        let r1 = eng.search(fen, &cfg).expect("第一次搜索失败");
        let r2 = eng.search(fen, &cfg).expect("第二次搜索失败");
        assert!(!r1.pvs.is_empty() && !r2.pvs.is_empty());
    }
}
