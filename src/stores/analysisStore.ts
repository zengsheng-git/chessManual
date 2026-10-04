import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { analyzeGame, isTauriEnv, stopAnalysis } from "../lib/ipc";
import type { AnalyzePly } from "../lib/analysis/plies";

export type AnalysisPhase = "idle" | "analyzing" | "done" | "stopped" | "error";

// ---- Tauri 事件 payload（与后端约定一致）----
interface StatusPayload {
  phase: "analyzing" | "done" | "stopped" | "error";
  message: string | null;
}

export interface PlyReport {
  ply: number;
  /** red | black */
  side: "red" | "black";
  iccs: string;
  best: string;
  /** t1(与首选一致) | ev(等值好棋) | miss(其余) */
  kind: "t1" | "ev" | "miss";
  /** 实际着法相对引擎最优的损失（厘兵） */
  loss: number;
  /** 唯一明显好棋局面（人机混用的主要证据点） */
  critical: boolean;
  /** 走子前行棋方视角评分（厘兵） */
  score: number;
  winrate: number | null;
  depth: number;
}

// 后端 serde flatten：progress 事件即逐手报告 + total
type ProgressPayload = PlyReport & { total: number };

export interface PhaseStats {
  plies: number;
  t1_rate: number;
  ev_rate: number;
  acpl: number;
  /** 该组每步损失的标准差（厘兵） */
  stddev: number;
  /** 唯一明显好棋局面数 */
  criticals: number;
  /** 其中选对引擎首选的数量 */
  critical_hits: number;
}

export interface AnalysisResult {
  plys: PlyReport[];
  total: number;
  t1_rate: number;
  ev_rate: number;
  acpl: number;
  red: PhaseStats;
  black: PhaseStats;
  opening: PhaseStats;
  middlegame: PhaseStats;
  elapsed_ms: number;
}

interface AnalysisState {
  phase: AnalysisPhase;
  message: string | null;
  /** 分析对象（棋局标题），start 时记录，防止分析中切换棋局后混淆 */
  target: string | null;
  /** 发起分析的主线着法（含 notation），用于逐手展示中文记法 */
  plies: AnalyzePly[];
  progress: { ply: number; total: number } | null;
  /** 进行中逐手累积（stopped 时保留已完成部分） */
  plys: PlyReport[];
  result: AnalysisResult | null;
  start: (plies: AnalyzePly[], target: string) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useAnalysisStore = create<AnalysisState>()((set) => ({
  phase: "idle",
  message: null,
  target: null,
  plies: [],
  progress: null,
  plys: [],
  result: null,

  start: async (plies, target) => {
    if (!isTauriEnv()) {
      set({ phase: "error", message: "软件检测仅支持桌面端使用" });
      return;
    }
    set({ phase: "analyzing", message: null, target, plies, progress: null, plys: [], result: null });
    try {
      // 只发送后端约定的字段（snake_case），notation 仅为前端展示保留
      await analyzeGame(plies.map(({ side, iccs, fen, next_fen }) => ({ side, iccs, fen, next_fen })));
    } catch (e) {
      set({ phase: "error", message: errMsg(e) });
    }
  },

  stop: async () => {
    if (!isTauriEnv()) return;
    try {
      await stopAnalysis();
    } catch {
      // 重复停止时后端会报"当前没有进行中的分析"，静默即可
    }
  },

  reset: () => {
    set({ phase: "idle", message: null, target: null, plies: [], progress: null, plys: [], result: null });
  },
}));

// ---- 事件订阅：面板打开时注册，关闭时清理 ----
let active = false;
let gen = 0; // 代际号：解决异步注册与提前清理的竞态
let unlisteners: UnlistenFn[] = [];

function handleStatus(p: StatusPayload): void {
  useAnalysisStore.setState({ phase: p.phase, message: p.message });
}

function handleProgress(p: ProgressPayload): void {
  const prev = useAnalysisStore.getState();
  // 防御: 结果已就绪或事件顺序错乱时丢弃迟到的 progress
  if (prev.result) return;
  useAnalysisStore.setState({
    progress: { ply: p.ply, total: p.total },
    plys: [
      ...prev.plys,
      {
        ply: p.ply,
        side: p.side,
        iccs: p.iccs,
        best: p.best,
        kind: p.kind,
        loss: p.loss,
        critical: p.critical,
        score: p.score,
        winrate: p.winrate,
        depth: p.depth,
      },
    ],
  });
}

function handleResult(result: AnalysisResult): void {
  useAnalysisStore.setState({ result, plys: result.plys, progress: null });
}

function cleanupListeners(): void {
  if (!active) return;
  active = false;
  gen += 1;
  const fns = unlisteners;
  unlisteners = [];
  fns.forEach((f) => f());
}

/** 注册分析事件监听（幂等，StrictMode 重复挂载不会重复注册）；返回清理函数 */
export function initAnalysisListeners(): () => void {
  if (!isTauriEnv()) return () => {};
  if (active) return cleanupListeners;
  active = true;
  gen += 1;
  const myGen = gen;

  void Promise.all([
    listen<StatusPayload>("analysis://status", (e) => {
      if (myGen === gen) handleStatus(e.payload);
    }),
    listen<ProgressPayload>("analysis://progress", (e) => {
      if (myGen === gen) handleProgress(e.payload);
    }),
    listen<AnalysisResult>("analysis://result", (e) => {
      if (myGen === gen) handleResult(e.payload);
    }),
  ]).then((fns) => {
    if (myGen !== gen) {
      // 注册完成前已被清理，立即退订
      fns.forEach((f) => f());
      return;
    }
    unlisteners = fns;
  });

  return cleanupListeners;
}
