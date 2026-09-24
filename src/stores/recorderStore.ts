import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { parseFen } from "../lib/board/fen";
import type { Board } from "../lib/board/types";
import { toPgn } from "../lib/pgn/writer";
import { applyIccs, buildGame } from "../lib/record/toGame";
import { isTauriEnv } from "../lib/ipc";
import { useGameStore } from "./gameStore";
import { useLibraryStore } from "./libraryStore";

export interface WindowInfo {
  id: number;
  title: string;
  app_name: string;
  width: number;
  height: number;
}

export type RecorderPhase =
  | "idle"
  | "locating"
  | "recording"
  | "stopped"
  | "error";

// ---- Tauri 事件 payload（与后端约定一致）----
interface StatusPayload {
  phase: "locating" | "recording" | "stopped" | "error";
  message: string | null;
}
interface PositionPayload {
  fen: string;
}
interface MovePayload {
  ply: number;
  from: string;
  to: string;
  piece: string;
  captured: string | null;
  fen: string;
}
interface WarningPayload {
  message: string;
}

export interface RecordedMove {
  ply: number;
  from: string;
  to: string;
  piece: string;
  captured: string | null;
  fen: string;
  notation: string;
}

interface RecorderState {
  phase: RecorderPhase;
  message: string | null;
  windows: WindowInfo[];
  windowQuery: string;
  startFen: string | null;
  moves: RecordedMove[];
  warning: string | null;
  refreshWindows: () => Promise<void>;
  setWindowQuery: (q: string) => void;
  start: (windowId: number) => Promise<void>;
  stop: () => Promise<void>;
  importToGame: () => boolean;
  savePgn: () => Promise<string | null>;
  reset: () => void;
}

// 模块内部推演盘面：从起点 FEN 起，随 move 事件即时前进
let currentBoard: Board | null = null;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useRecorderStore = create<RecorderState>()((set, get) => ({
  phase: "idle",
  message: null,
  windows: [],
  windowQuery: "",
  startFen: null,
  moves: [],
  warning: null,

  refreshWindows: async () => {
    if (!isTauriEnv()) return;
    try {
      const wins = await invoke<WindowInfo[]>("list_windows");
      set({ windows: wins });
    } catch (e) {
      set({ warning: `获取窗口列表失败：${errMsg(e)}` });
    }
  },

  setWindowQuery: (q) => set({ windowQuery: q }),

  start: async (windowId) => {
    if (!isTauriEnv()) {
      set({ phase: "error", message: "录制功能仅支持桌面端使用" });
      return;
    }
    set({ phase: "locating", message: null, warning: null, startFen: null, moves: [] });
    currentBoard = null;
    try {
      const fen = await invoke<string>("start_recording", { windowId });
      currentBoard = parseFen(fen).board;
      set({ startFen: fen, phase: "recording" });
    } catch (e) {
      set({ phase: "error", message: errMsg(e) });
    }
  },

  stop: async () => {
    if (!isTauriEnv()) return;
    try {
      await invoke<void>("stop_recording");
      set((s) =>
        s.phase === "recording" || s.phase === "locating"
          ? { phase: "stopped" }
          : {},
      );
    } catch (e) {
      set({ phase: "error", message: errMsg(e) });
    }
  },

  importToGame: () => {
    const { startFen, moves } = get();
    if (!startFen || moves.length === 0) return false;
    try {
      const game = buildGame(startFen, moves);
      // gameStore 暂无内存导入 API，直接写入与 loadGame 成功分支等效的状态
      useGameStore.setState({
        game,
        fileName: game.info.title ?? "录制对局",
        filePath: null,
        path: [],
        loading: false,
        error: null,
        pickerOpen: false,
      });
      return true;
    } catch {
      return false;
    }
  },

  savePgn: async () => {
    const { startFen, moves } = get();
    if (!startFen || moves.length === 0 || !isTauriEnv()) return null;
    try {
      const game = buildGame(startFen, moves);
      const content = toPgn(game, startFen);
      // 文件名带时分避免同日多局重名（入库时后端还会再自动编号）
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const fileName = `录制对局_${game.info.date ?? "未命名"}_${hh}${mm}.pgn`;
      // 弹出另存为对话框, 初始定位到棋谱库目录, 可自由选择位置或新建文件夹
      const root = useLibraryStore.getState().root;
      const path = await invoke<string>("save_pgn", { fileName, content, initialDir: root });
      // 保存后刷新列表并滚动定位到新棋谱（revealTo 内部已兜错，不会中断保存流程）
      void useLibraryStore.getState().revealTo(path);
      return path;
    } catch {
      // 构建棋谱失败或用户取消保存，均不打断面板
      return null;
    }
  },

  reset: () => {
    currentBoard = null;
    set({
      phase: "idle",
      message: null,
      windows: [],
      windowQuery: "",
      startFen: null,
      moves: [],
      warning: null,
    });
  },
}));

// ---- 事件订阅：面板打开时注册，关闭时清理 ----
let active = false;
let gen = 0; // 代际号：解决异步注册与提前清理的竞态
let unlisteners: UnlistenFn[] = [];

function handleStatus(p: StatusPayload): void {
  useRecorderStore.setState({ phase: p.phase, message: p.message });
}

function handlePosition(p: PositionPayload): void {
  currentBoard = parseFen(p.fen).board;
  useRecorderStore.setState({ startFen: p.fen, moves: [] });
}

function handleMove(p: MovePayload): void {
  if (!currentBoard) return;
  try {
    // 用本地盘面即时推演，保证 notation/fen 与已录着法一致
    const applied = applyIccs(currentBoard, p.from, p.to, p.ply);
    const prev = useRecorderStore.getState().moves;
    useRecorderStore.setState({
      moves: [
        ...prev,
        {
          ply: p.ply,
          from: p.from,
          to: p.to,
          piece: p.piece,
          captured: applied.captured,
          fen: applied.fen,
          notation: applied.notation,
        },
      ],
    });
  } catch (e) {
    // 后端着法与本地推演不一致时提示，不中断录制
    useRecorderStore.setState({ warning: errMsg(e) });
  }
}

function handleWarning(p: WarningPayload): void {
  useRecorderStore.setState({ warning: p.message });
}

function cleanupListeners(): void {
  if (!active) return;
  active = false;
  gen += 1;
  const fns = unlisteners;
  unlisteners = [];
  fns.forEach((f) => f());
}

/** 注册录制事件监听（幂等，StrictMode 重复挂载不会重复注册）；返回清理函数 */
export function initRecorderListeners(): () => void {
  if (!isTauriEnv()) return () => {};
  if (active) return cleanupListeners;
  active = true;
  gen += 1;
  const myGen = gen;

  void Promise.all([
    listen<StatusPayload>("recorder://status", (e) => {
      if (myGen === gen) handleStatus(e.payload);
    }),
    listen<PositionPayload>("recorder://position", (e) => {
      if (myGen === gen) handlePosition(e.payload);
    }),
    listen<MovePayload>("recorder://move", (e) => {
      if (myGen === gen) handleMove(e.payload);
    }),
    listen<WarningPayload>("recorder://warning", (e) => {
      if (myGen === gen) handleWarning(e.payload);
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
