import { create } from "zustand";
import {
  scanDir,
  scanDirs,
  createFolder as createFolderIpc,
  type FileEntry,
} from "../lib/ipc";

interface LibraryState {
  root: string | null;
  files: FileEntry[];
  dirs: string[];
  loading: boolean;
  error: string | null;
  expanded: Record<string, boolean>;
  selectedDir: string;
  query: string;
  currentPath: string | null;
  revealPath: string | null;
  setRoot: (root: string) => Promise<void>;
  rescan: () => Promise<void>;
  createFolder: (name: string, parentPath?: string) => Promise<void>;
  toggleDir: (dir: string) => void;
  selectDir: (dir: string) => void;
  setQuery: (q: string) => void;
  setCurrentPath: (p: string | null) => void;
  revealTo: (path: string) => Promise<void>;
  clearReveal: () => void;
}

export const useLibraryStore = create<LibraryState>()(
  (set, get) => ({
    root: null,
    files: [],
    dirs: [],
    loading: false,
    error: null,
    expanded: {},
    selectedDir: "",
    query: "",
    currentPath: null,
    revealPath: null,

    setRoot: async (root) => {
      set({ root, loading: true, error: null, selectedDir: "", expanded: {} });
      await get().rescan();
    },

    rescan: async () => {
      const root = get().root;
      if (!root) return;
      set({ loading: true, error: null });
      try {
        const [files, dirs] = await Promise.all([scanDir(root), scanDirs(root)]);
        files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
        dirs.sort((a, b) => a.localeCompare(b, "zh-CN"));
        set({ files, dirs, loading: false });
      } catch (e) {
        set({ error: String(e), loading: false, files: [], dirs: [] });
      }
    },

    // 在指定目录(缺省为当前选中目录, 未选中则为库根目录)下新建文件夹, 成功后选中新目录
    createFolder: async (name, parentPath) => {
      const root = get().root;
      if (!root) throw new Error("尚未打开棋谱库");
      const clean = name.trim();
      const parent =
        parentPath?.trim() || get().selectedDir || root.replace(/[\\/]+$/, "");
      await createFolderIpc(parent, clean);
      get().selectDir(`${parent}\\${clean}`);
      await get().rescan();
    },

    toggleDir: (dir) =>
      set((s) => ({ expanded: { ...s.expanded, [dir]: !s.expanded[dir] } })),

    selectDir: (dir) =>
      set((s) => {
        const expanded = { ...s.expanded };
        const normRoot = (s.root ?? "").replace(/[\\/]+$/, "");
        if (dir && normRoot && dir.startsWith(normRoot)) {
          const rel = dir.slice(normRoot.length).replace(/^[\\/]+/, "");
          const segs = rel.split(/[\\/]/).filter(Boolean);
          let acc = "";
          for (const seg of segs.slice(0, -1)) {
            acc = acc ? `${acc}\\${seg}` : seg;
            expanded[`${normRoot}\\${acc}`] = true;
          }
        }
        return { selectedDir: dir, expanded };
      }),
    setQuery: (query) => set({ query }),
    setCurrentPath: (currentPath) => set({ currentPath }),

    // 保存/导入后定位新棋谱: 切回全部棋谱并标记目标, 重扫后由列表滚动到该项
    revealTo: async (path) => {
      set({ revealPath: path });
      get().selectDir("");
      get().setCurrentPath(path);
      await get().rescan();
    },

    clearReveal: () => set({ revealPath: null }),
  }),
);
