import { create } from "zustand";
import { scanDir, type FileEntry } from "../lib/ipc";

interface LibraryState {
  root: string | null;
  files: FileEntry[];
  loading: boolean;
  error: string | null;
  expanded: Record<string, boolean>;
  selectedDir: string;
  query: string;
  currentPath: string | null;
  setRoot: (root: string) => Promise<void>;
  rescan: () => Promise<void>;
  toggleDir: (dir: string) => void;
  selectDir: (dir: string) => void;
  setQuery: (q: string) => void;
  setCurrentPath: (p: string | null) => void;
}

export const useLibraryStore = create<LibraryState>()(
  (set, get) => ({
    root: null,
    files: [],
    loading: false,
    error: null,
    expanded: {},
    selectedDir: "",
    query: "",
    currentPath: null,

    setRoot: async (root) => {
      set({ root, loading: true, error: null, selectedDir: "", expanded: {} });
      await get().rescan();
    },

    rescan: async () => {
      const root = get().root;
      if (!root) return;
      set({ loading: true, error: null });
      try {
        const files = await scanDir(root);
        files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
        set({ files, loading: false });
      } catch (e) {
        set({ error: String(e), loading: false, files: [] });
      }
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
  }),
);
