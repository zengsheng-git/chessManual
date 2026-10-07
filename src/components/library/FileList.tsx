import { useEffect, useMemo, useRef, useState } from "react";
import { useLibraryStore } from "../../stores/libraryStore";
import { useGameStore } from "../../stores/gameStore";
import { revealInExplorer, deleteGameFile, renameGameFile } from "../../lib/ipc";
import ConfirmDialog from "../common/ConfirmDialog";
import InputDialog from "../common/InputDialog";

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
  const closeGame = useGameStore((s) => s.closeGame);
  const rescan = useLibraryStore((s) => s.rescan);
  const createFolder = useLibraryStore((s) => s.createFolder);
  const revealPath = useLibraryStore((s) => s.revealPath);
  const clearReveal = useLibraryStore((s) => s.clearReveal);

  const [limit, setLimit] = useState(RENDER_LIMIT);
  const [confirmTarget, setConfirmTarget] = useState<{ path: string; name: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string; ext: string } | null>(null);

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

  const reveal = (path: string) => {
    void revealInExplorer(path).catch((e) => alert(`打开文件夹失败：${e}`));
  };

  const remove = (path: string, name: string) => {
    setConfirmTarget({ path, name });
  };

  const confirmRemove = async () => {
    if (!confirmTarget) return;
    const { path } = confirmTarget;
    setConfirmTarget(null);
    try {
      await deleteGameFile(path);
      if (filePath === path) closeGame();
      await rescan();
    } catch (e) {
      alert(`删除失败：${e}`);
    }
  };

  const confirmCreate = async (name: string) => {
    setCreateOpen(false);
    try {
      await createFolder(name);
    } catch (e) {
      alert(`新建文件夹失败：${e}`);
    }
  };

  // 重命名成功后同步打开中棋谱与"最近打开"路径, 再刷新列表
  const confirmRename = async (newName: string) => {
    const target = renameTarget;
    setRenameTarget(null);
    if (!target) return;
    try {
      const newPath = await renameGameFile(target.path, newName);
      const game = useGameStore.getState();
      if (game.filePath === target.path) {
        const base = newPath.split(/[\\/]/).pop();
        game.setFileInfo(newPath, base ?? target.name);
      }
      useLibraryStore.getState().migrateFile(target.path, newPath);
      await rescan();
    } catch (e) {
      alert(`重命名失败：${e}`);
    }
  };

  const shown = visible.slice(0, limit);

  // 目录或搜索词变化时重置渲染上限并回到顶部
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setLimit(RENDER_LIMIT);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [normDir, q]);

  // 滚动接近底部时增量渲染, 突破单次渲染上限
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || limit >= visible.length) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
      setLimit((l) => Math.min(l + RENDER_LIMIT, visible.length));
    }
  };

  // 保存/导入后定位新棋谱: 未渲染则扩大上限, 已渲染则滚动到该项并居中
  useEffect(() => {
    if (!revealPath) return;
    if (!visible.some((f) => f.path === revealPath)) return;
    const el = scrollRef.current?.querySelector(
      `[data-path="${CSS.escape(revealPath)}"]`,
    );
    if (!el) {
      setLimit((l) => Math.min(l + RENDER_LIMIT * 4, visible.length));
      return;
    }
    el.scrollIntoView({ block: "center" });
    clearReveal();
  }, [revealPath, visible, shown, limit, clearReveal]);

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
          <span className="flex items-center gap-1.5">
            <span className="text-ink-400">
              {visible.length} 个{shown.length < visible.length ? `（已显示 ${shown.length}）` : ""}
            </span>
            <button
              onClick={() => setCreateOpen(true)}
              title={
                normDir
                  ? `在「${normDir.split("/").pop()}」中新建文件夹`
                  : "在棋谱库根目录新建文件夹"
              }
              aria-label="新建文件夹"
              className="rounded p-0.5 text-[11px] leading-none text-ink-300 transition-colors hover:bg-ink-700 hover:text-gold-300"
            >
              ＋📁
            </button>
          </span>
        </div>
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto p-1.5">
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
            <div
              key={f.path}
              data-path={f.path}
              className={[
                "group flex w-full items-center gap-0.5 rounded-md pr-1 transition-colors",
                active
                  ? "bg-verm-500/20 ring-1 ring-inset ring-gold-500/30"
                  : recent
                    ? "bg-ink-800"
                    : "hover:bg-ink-800/70",
              ].join(" ")}
            >
              <button
                onClick={() => open(f.path, f.name)}
                className={[
                  "flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2.5 text-left transition-colors",
                  active
                    ? "font-medium text-gold-300"
                    : "text-ink-200",
                ].join(" ")}
                title={f.path}
              >
                <span className="text-sm leading-none">{active ? "📖" : "📄"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {f.name.replace(/\.xqf$/i, "")}
                  </span>
                  <span className="block truncate text-[11px] text-ink-400">
                    {f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  onClick={() => reveal(f.path)}
                  title="打开所在文件夹"
                  aria-label={`打开 ${f.name} 所在文件夹`}
                  className="rounded p-1 text-xs leading-none text-ink-300 transition-colors hover:bg-ink-700 hover:text-gold-300"
                >
                  📂
                </button>
                <button
                  onClick={() => setRenameTarget({ path: f.path, name: f.name, ext: f.ext })}
                  title="重命名"
                  aria-label={`重命名 ${f.name}`}
                  className="rounded p-1 text-xs leading-none text-ink-300 transition-colors hover:bg-ink-700 hover:text-gold-300"
                >
                  ✏️
                </button>
                <button
                  onClick={() => remove(f.path, f.name)}
                  title="删除（移入回收站）"
                  aria-label={`删除 ${f.name}`}
                  className="rounded p-1 text-xs leading-none text-ink-300 transition-colors hover:bg-verm-500/25 hover:text-verm-400"
                >
                  🗑
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {confirmTarget && (
        <ConfirmDialog
          title="删除确认"
          message={<span title={confirmTarget.path}>确定删除棋谱「{confirmTarget.name}」吗？</span>}
          hint="文件将移入系统回收站，误删可恢复。"
          confirmText="删除"
          onConfirm={() => void confirmRemove()}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
      {createOpen && (
        <InputDialog
          title="新建文件夹"
          message={<>将在「{normDir ? normDir.split("/").pop() : "全部棋谱"}」分类下创建。</>}
          placeholder="请输入文件夹名称"
          confirmText="创建"
          hint={'名称不能包含 \\ / : * ? " < > | 等字符。'}
          onConfirm={(v) => void confirmCreate(v)}
          onCancel={() => setCreateOpen(false)}
        />
      )}
      {renameTarget && (
        <InputDialog
          title="重命名棋谱"
          message={
            <span title={renameTarget.path}>
              将「{renameTarget.name}」改名为：
            </span>
          }
          defaultValue={renameTarget.name.replace(new RegExp(`\\.${renameTarget.ext}$`, "i"), "")}
          placeholder="请输入新名称"
          confirmText="重命名"
          hint={`将保留原扩展名（.${renameTarget.ext}）。名称不能包含 \\ / : * ? " < > | 等字符。`}
          onConfirm={(v) => void confirmRename(v)}
          onCancel={() => setRenameTarget(null)}
        />
      )}
    </div>
  );
}
