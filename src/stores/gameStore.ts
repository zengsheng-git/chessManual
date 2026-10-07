import { create } from "zustand";
import { readFileBytes, isTauriEnv } from "../lib/ipc";
import { parseXqf, type MoveNode, type ParsedGame } from "../lib/xqf/parser";
import { parsePgn } from "../lib/pgn/parser";
import { START_FEN, parseFen } from "../lib/board/fen";

export function selectNode(game: ParsedGame | null, path: number[]): MoveNode | null {
  if (!game) return null;
  let list = game.moves;
  let node: MoveNode | null = null;
  for (const i of path) {
    node = list[i] ?? null;
    if (!node) return null;
    list = node.children;
  }
  return node;
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function walkOrder(game: ParsedGame): { paths: number[][]; branch: boolean[] } {
  const paths: number[][] = [];
  const branch: boolean[] = [];
  const walk = (list: MoveNode[], prefix: number[]) => {
    if (list.length === 0) return;
    const main = list[0]!;
    const mainPath = [...prefix, 0];
    paths.push(mainPath);
    branch.push(main.children.length > 1);
    for (let i = 1; i < list.length; i++) {
      const v = list[i]!;
      const vp = [...prefix, i];
      paths.push(vp);
      branch.push(v.children.length > 1);
      walk(v.children, vp);
    }
    walk(main.children, mainPath);
  };
  walk(game.moves, []);
  return { paths, branch };
}

interface GameState {
  game: ParsedGame | null;
  fileName: string | null;
  filePath: string | null;
  path: number[];
  loading: boolean;
  error: string | null;
  flipped: boolean;
  pickerOpen: boolean;
  loadGame: (filePath: string, fileName: string) => Promise<void>;
  closeGame: () => void;
  /** 打开中的棋谱文件（或其所在目录）被重命名后同步路径与文件名，棋局内容与复盘进度不变 */
  setFileInfo: (filePath: string, fileName: string) => void;
  setPath: (path: number[]) => void;
  goNext: () => void;
  pickBranch: (index: number) => void;
  openPicker: () => void;
  closePicker: () => void;
  goPrev: () => void;
  switchVariation: (delta: 1 | -1) => void;
  gotoBranch: (delta: 1 | -1) => void;
  goToStart: () => void;
  goToEnd: () => void;
  toggleFlip: () => void;
}

export const useGameStore = create<GameState>()((set, get) => ({
  game: null,
  fileName: null,
  filePath: null,
  path: [],
  loading: false,
  error: null,
  flipped: false,
  pickerOpen: false,

  loadGame: async (filePath, fileName) => {
    if (!isTauriEnv()) {
      set({ error: "请在桌面应用中打开棋谱" });
      return;
    }
    set({ loading: true, error: null });
    try {
      const bytes = await readFileBytes(filePath);
      // 按扩展名分流: PGN 为文本格式, XQF 为二进制格式
      const game = /\.pgn$/i.test(fileName)
        ? parsePgn(new TextDecoder().decode(bytes), fileName)
        : parseXqf(bytes, fileName);
      set({
        game,
        fileName,
        filePath,
        path: [],
        loading: false,
        error: null,
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  closeGame: () =>
    set({ game: null, fileName: null, filePath: null, path: [], error: null, pickerOpen: false }),

  setFileInfo: (filePath, fileName) => set({ filePath, fileName }),

  setPath: (path) => set({ path, pickerOpen: false }),

  goNext: () => {
    const { game, path } = get();
    if (!game) return;
    const options =
      path.length === 0 ? game.moves : (selectNode(game, path)?.children ?? []);
    if (options.length === 0) return;
    if (options.length > 1) {
      set({ pickerOpen: true });
      return;
    }
    set({ path: [...path, 0], pickerOpen: false });
  },

  pickBranch: (index) => {
    const { game, path } = get();
    if (!game) return;
    const options =
      path.length === 0 ? game.moves : (selectNode(game, path)?.children ?? []);
    if (index < 0 || index >= options.length) return;
    set({ path: [...path, index], pickerOpen: false });
  },

  openPicker: () => {
    const { game, path } = get();
    if (!game) return;
    const options =
      path.length === 0 ? game.moves : (selectNode(game, path)?.children ?? []);
    if (options.length > 1) set({ pickerOpen: true });
  },

  closePicker: () => set({ pickerOpen: false }),

  goPrev: () => {
    const { path } = get();
    if (path.length > 0) set({ path: path.slice(0, -1), pickerOpen: false });
  },

  switchVariation: (delta) => {
    const { game, path } = get();
    if (path.length === 0) return;
    const parentPath = path.slice(0, -1);
    const parent = selectNode(game, parentPath);
    const siblings = parent ? parent.children : (game?.moves ?? []);
    const idxCur = path[path.length - 1]!;
    const idxNew = Math.min(Math.max(idxCur + delta, 0), siblings.length - 1);
    if (idxNew !== idxCur) set({ path: [...parentPath, idxNew], pickerOpen: false });
  },

  gotoBranch: (delta) => {
    const { game, path } = get();
    if (!game) return;
    const { paths, branch } = walkOrder(game);
    const cur = paths.findIndex((p) => samePath(p, path));
    const scan = delta === 1 ? (i: number) => i < paths.length : (i: number) => i >= 0;
    for (let i = cur + delta; scan(i); i += delta) {
      if (branch[i]) {
        set({ path: paths[i]!, pickerOpen: true });
        return;
      }
    }
  },

  goToStart: () => set({ path: [], pickerOpen: false }),

  goToEnd: () => {
    const { game } = get();
    if (!game) return;
    const path: number[] = [];
    let list = game.moves;
    while (list.length > 0) {
      path.push(0);
      list = list[0]!.children;
    }
    set({ path, pickerOpen: false });
  },

  toggleFlip: () => set((s) => ({ flipped: !s.flipped })),
}));

export function currentFen(game: ParsedGame | null, path: number[]): string {
  const node = selectNode(game, path);
  return node ? node.fen : (game?.startFen ?? START_FEN);
}

export function boardIsEmpty(fen: string): boolean {
  return parseFen(fen).board.every((p) => p === null);
}
