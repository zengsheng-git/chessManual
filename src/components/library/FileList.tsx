import { useEffect, useMemo, useRef } from "react";
import { useLibraryStore } from "../../stores/libraryStore";
import { useGameStore } from "../../stores/gameStore";

const RENDER_LIMIT = 500;

export default function FileList() {
  const root = useLibraryStore((s) => s.root);
  const files = useLibraryStore((s) => s.files);
  const selectedDir = useLibraryStore((s) => s.selectedDir);
  const query = useLibraryStore((s) => s.query);
  const setQuery = useLibraryStore((s) => s.setQuery);
  const currentPath = useLibraryStore((s) => s.currentPath);
  const setCurrentPath = useLibraryStore((s) => s.setCurrentPath);
  const loadGame = useGameStore((s) => s.loadGame);
  const filePath = useGameStore((s) => s.filePath);

  const normDir = selectedDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    return files.filter((f) => {
      const norm = f.path.replace(/\\/g, "/");
      if (normDir && !norm.startsWith(normDir + "/")) return false;
      if (q && !f.name.toLowerCase().includes(q) && !norm.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, normDir, q]);

  const open = (path: string, name: string) => {
    setCurrentPath(path);
    void loadGame(path, name);
  };

  const shown = visible.slice(0, RENDER_LIMIT);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [normDir, q]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-ink-800 px-2.5 pb-2 pt-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索棋谱名称…"
          className="w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-sm text-ink-200 placeholder:text-ink-400/70 focus:border-gold-500/70 focus:outline-none"
        />
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold tracking-widest text-ink-300">
            棋 谱 列 表
            {normDir ? (
              <span className="ml-1 font-normal normal-case tracking-normal text-gold-400/90">
                · {normDir.split("/").pop()}
              </span>
            ) : null}
          </span>
          <span className="text-ink-400">
            {visible.length} 个{visible.length > RENDER_LIMIT ? "（显示前 500）" : ""}
          </span>
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!root && (
          <div className="p-6 text-center text-sm text-ink-400">
            点击顶部「导入棋谱库」选择文件夹
          </div>
        )}
        {root && visible.length === 0 && (
          <div className="p-6 text-center text-sm text-ink-400">没有匹配的棋谱</div>
        )}
        {shown.map((f) => {
          const active = filePath === f.path;
          const recent = currentPath === f.path;
          return (
            <button
              key={f.path}
              onClick={() => open(f.path, f.name)}
              className={[
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                active
                  ? "bg-verm-500/20 font-medium text-gold-300 ring-1 ring-inset ring-gold-500/30"
                  : recent
                    ? "bg-ink-800 text-ink-200"
                    : "text-ink-200 hover:bg-ink-800/70",
              ].join(" ")}
              title={f.path}
            >
              <span className="text-sm leading-none">{active ? "📖" : "📄"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{f.name.replace(/\.xqf$/i, "")}</span>
                <span className="block truncate text-[11px] text-ink-400">
                  {f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
