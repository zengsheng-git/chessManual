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
  /** 棋谱文件重命名后，同步库内记录的"最近打开/定位"路径 */
  migrateFile: (oldPath: string, newPath: string) => void;
  /** 文件夹重命名后，迁移库内引用该目录的路径（选中目录/展开状态/最近打开/定位标记） */
  migrateDir: (oldDir: string, newDir: string) => void;
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

    migrateFile: (oldPath, newPath) => {
      const norm = (p: string | null) => p?.replace(/\\/g, "/") ?? null;
      const old = norm(oldPath);
      set((s) => ({
        currentPath: norm(s.currentPath) === old ? newPath : s.currentPath,
        revealPath: norm(s.revealPath) === old ? newPath : s.revealPath,
      }));
    },

    migrateDir: (oldDir, newDir) => {
      const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
      const old = norm(oldDir);
      const remap = (p: string): string => {
        const n = norm(p);
        if (n === old) return newDir;
        if (n.startsWith(old + "/")) return (newDir + n.slice(old.length)).replace(/\//g, "\\");
        return p;
      };
      set((s) => {
        const expanded: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(s.expanded)) expanded[remap(k)] = v;
        return {
          selectedDir: s.selectedDir ? remap(s.selectedDir) : s.selectedDir,
          expanded,
          currentPath: s.currentPath ? remap(s.currentPath) : s.currentPath,
          revealPath: s.revealPath ? remap(s.revealPath) : s.revealPath,
        };
      });
    },
  }),
);
