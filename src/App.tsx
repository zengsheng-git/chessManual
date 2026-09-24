import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Board from "./components/board/Board";
import MoveTree from "./components/board/MoveTree";
import Sidebar from "./components/library/Sidebar";
import FileList from "./components/library/FileList";
import GameInfo from "./components/library/GameInfo";
import CommentPanel from "./components/board/CommentPanel";
import VariationPicker, { type MovePreview } from "./components/board/VariationPicker";
import RecordPanel from "./components/record/RecordPanel";
import { isTauriEnv } from "./lib/ipc";
import { useLibraryStore } from "./stores/libraryStore";
import { currentFen, selectNode, useGameStore } from "./stores/gameStore";
import { useRecorderStore } from "./stores/recorderStore";

function ControlButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-gold-500/60 hover:bg-ink-700 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-ink-600 disabled:hover:bg-ink-800 disabled:hover:text-ink-200"
    >
      {children}
    </button>
  );
}

export default function App() {
  const libraryRoot = useLibraryStore((s) => s.root);
  const loading = useLibraryStore((s) => s.loading);
  const libraryError = useLibraryStore((s) => s.error);
  const rescan = useLibraryStore((s) => s.rescan);
  const totalFiles = useLibraryStore((s) => s.files.length);

  const game = useGameStore((s) => s.game);
  const path = useGameStore((s) => s.path);
  const loadingGame = useGameStore((s) => s.loading);
  const gameError = useGameStore((s) => s.error);
  const flipped = useGameStore((s) => s.flipped);
  const goNext = useGameStore((s) => s.goNext);
  const goPrev = useGameStore((s) => s.goPrev);
  const switchVariation = useGameStore((s) => s.switchVariation);
  const gotoBranch = useGameStore((s) => s.gotoBranch);
  const goToStart = useGameStore((s) => s.goToStart);
  const goToEnd = useGameStore((s) => s.goToEnd);
  const toggleFlip = useGameStore((s) => s.toggleFlip);
  const pickerOpen = useGameStore((s) => s.pickerOpen);
  const pickBranch = useGameStore((s) => s.pickBranch);
  const closePicker = useGameStore((s) => s.closePicker);

  const recorderActive = useRecorderStore(
    (s) => s.phase === "recording" || s.phase === "locating",
  );
  const [recordOpen, setRecordOpen] = useState(false);
  const [previewMove, setPreviewMove] = useState<MovePreview | null>(null);

  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === "light" ? "dark" : "light";
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem("theme", next);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (pickerOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          closePicker();
        } else if (/^[1-9]$/.test(e.key)) {
          e.preventDefault();
          pickBranch(Number(e.key) - 1);
        }
        return;
      }
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case "ArrowUp":
          e.preventDefault();
          switchVariation(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          switchVariation(1);
          break;
        case "Home":
          e.preventDefault();
          goToStart();
          break;
        case "End":
          e.preventDefault();
          goToEnd();
          break;
        case "f":
        case "F":
          toggleFlip();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, switchVariation, goToStart, goToEnd, toggleFlip, pickerOpen, pickBranch, closePicker]);

  useEffect(() => {
    if (!isTauriEnv()) return;
    void invoke<string>("library_dir")
      .then((dir) => useLibraryStore.getState().setRoot(dir))
      .catch((e) => console.error("获取棋谱库目录失败：", e));
  }, []);

  const boardAreaRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = boardAreaRef.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - last < 90) return;
      last = now;
      if (e.deltaY > 0) goNext();
      else if (e.deltaY < 0) goPrev();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [goNext, goPrev]);

  const node = selectNode(game, path);
  const fen = currentFen(game, path);
  const hasGame = !!game;
  const atStart = path.length === 0;
  const atEnd = !!node && node.children.length === 0;

  return (
    <div className="flex h-full flex-col bg-ink-950">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900 px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-gold-500/50 bg-ink-800 font-piece text-lg text-gold-400">
            棋
          </div>
          <span className="text-lg font-bold tracking-wide text-ink-200">棋枰棋谱</span>
          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">复盘台</span>
        </div>

        <div className="ml-6 flex items-center gap-2">
          {libraryRoot && (
            <button
              onClick={() => void rescan()}
              disabled={loading}
              title="重新扫描棋谱库"
              className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-300 transition-colors hover:border-gold-500/60 hover:text-gold-300 disabled:opacity-50"
            >
              {loading ? "扫描中…" : "刷新"}
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-ink-400">
          {libraryRoot && (
            <>
              <span className="max-w-[300px] truncate" title={libraryRoot}>
                {libraryRoot}
              </span>
              <span className="rounded-full bg-ink-800 px-2 py-0.5">共 {totalFiles} 盘</span>
            </>
          )}
          <ControlButton
            onClick={() => setRecordOpen(true)}
            title="录制对方棋软窗口的着法，可导出 PGN 或导入复盘台"
          >
            {recorderActive && (
              <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-verm-500 align-middle" />
            )}
            录制棋谱
          </ControlButton>
          <ControlButton onClick={toggleTheme} title="切换日间/夜间模式">
            {theme === "light" ? "🌙 夜间" : "☀️ 日间"}
          </ControlButton>
        </div>
      </header>

      {(libraryError || gameError) && (
        <div className="shrink-0 border-b border-verm-600/40 bg-verm-600/15 px-4 py-1.5 text-sm text-verm-400">
          {libraryError ?? gameError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[208px] shrink-0 flex-col border-r border-ink-800 bg-ink-900">
          <Sidebar />
        </aside>

        <aside className="flex w-[272px] shrink-0 flex-col border-r border-ink-800 bg-ink-900">
          <FileList />
        </aside>

        <main
          ref={boardAreaRef}
          className="relative flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-950 p-4"
          title="滚轮可前后翻看着法"
        >
          <div className="flex min-h-0 w-full flex-1 items-center justify-center">
            <Board
              fen={fen}
              flipped={flipped}
              lastMove={node ? { from: node.from, to: node.to } : null}
              previewMove={previewMove}
            />
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-3">
            <ControlButton onClick={goToStart} disabled={!hasGame || atStart} title="回到开始（Home）">
              ⏮ 开局
            </ControlButton>
            <ControlButton onClick={goPrev} disabled={!hasGame || atStart} title="上一步（←）">
              ◀ 上一手
            </ControlButton>
            <ControlButton onClick={goNext} disabled={!hasGame || atEnd} title="下一步（→）">
              下一手 ▶
            </ControlButton>
            <ControlButton onClick={goToEnd} disabled={!hasGame || atEnd} title="走到终局（End）">
              终局 ⏭
            </ControlButton>
            <ControlButton onClick={() => gotoBranch(-1)} disabled={!hasGame || atStart} title="跳到上一个有变招的局面，弹出选择框">
              ‹ 上一分歧
            </ControlButton>
            <ControlButton onClick={() => gotoBranch(1)} disabled={!hasGame} title="跳到下一个有变招的局面，弹出选择框">
              下一分歧 ›
            </ControlButton>
            <div className="mx-1 h-6 w-px bg-ink-700" />
            <ControlButton onClick={toggleFlip} title="翻转棋盘（F）">
              ⇅ 翻转
            </ControlButton>
          </div>

          <div className="h-7 shrink-0 pt-1.5 text-sm text-ink-300">
            {hasGame ? (
              node ? (
                <span>
                  第 <span className="text-gold-300">{node.ply}</span> 手 ·{" "}
                  <span className="font-medium text-ink-200">{node.notation}</span>
                  <span className="ml-2 text-xs text-ink-400">{node.iccs}</span>
                  {node.comment && (
                    <span
                      className="ml-2 cursor-help rounded bg-gold-400/10 px-1.5 py-0.5 text-xs text-gold-300"
                      title={node.comment}
                    >
                      📝 注解
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-ink-400">初始局面 · 按 → 开始复盘</span>
              )
            ) : (
              <span className="text-ink-400">从左侧选择一盘棋开始复盘</span>
            )}
          </div>

          {!hasGame && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl border border-ink-700 bg-ink-900/90 px-6 py-4 text-center shadow-xl">
                <p className="text-gold-300">从左侧选择一盘棋，即可开始复盘</p>
                <p className="mt-1 text-xs text-ink-400">
                  快捷键：← → 或滚轮前后翻着法 · ↑ ↓ 切换变例 · Home/End 首末 · F 翻转棋盘
                </p>
              </div>
            </div>
          )}

          {loadingGame && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink-950/60">
              <span className="animate-pulse text-sm text-gold-300">正在解析棋谱…</span>
            </div>
          )}

        </main>

        <aside className="relative flex w-[340px] shrink-0 flex-col border-l border-ink-800 bg-ink-900">
          {pickerOpen && <VariationPicker onPreview={setPreviewMove} />}
          {game && <GameInfo />}
          <div className="min-h-0 flex-1">
            <MoveTree />
          </div>
          {game && <CommentPanel />}
        </aside>
      </div>

      {recordOpen && <RecordPanel onClose={() => setRecordOpen(false)} />}
    </div>
  );
}
