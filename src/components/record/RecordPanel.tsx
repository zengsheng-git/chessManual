import { useEffect, useRef, useState } from "react";
import { pieceColor, pieceGlyph } from "../../lib/board/types";
import {
  initRecorderListeners,
  useRecorderStore,
} from "../../stores/recorderStore";

const BTN =
  "rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-gold-500/60 hover:bg-ink-700 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-ink-600 disabled:hover:bg-ink-800 disabled:hover:text-ink-200";

export default function RecordPanel({ onClose }: { onClose: () => void }) {
  const phase = useRecorderStore((s) => s.phase);
  const message = useRecorderStore((s) => s.message);
  const windows = useRecorderStore((s) => s.windows);
  const windowQuery = useRecorderStore((s) => s.windowQuery);
  const setWindowQuery = useRecorderStore((s) => s.setWindowQuery);
  const refreshWindows = useRecorderStore((s) => s.refreshWindows);
  const start = useRecorderStore((s) => s.start);
  const stop = useRecorderStore((s) => s.stop);
  const importToGame = useRecorderStore((s) => s.importToGame);
  const savePgn = useRecorderStore((s) => s.savePgn);
  const reset = useRecorderStore((s) => s.reset);
  const startFen = useRecorderStore((s) => s.startFen);
  const moves = useRecorderStore((s) => s.moves);
  const warning = useRecorderStore((s) => s.warning);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  // 打开面板时注册事件订阅并加载窗口列表，关闭时清理
  useEffect(() => {
    const cleanup = initRecorderListeners();
    void refreshWindows();
    return cleanup;
  }, [refreshWindows]);

  const closable = phase === "idle" || phase === "stopped";
  const requestClose = () => {
    if (closable) onClose();
  };

  // Esc 关闭（仅 idle / stopped 状态）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closable, onClose]);

  // 着法列表自动滚到底
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [moves.length]);

  // 保存成功提示数秒后自动消失
  useEffect(() => {
    if (!savedPath) return;
    const t = window.setTimeout(() => setSavedPath(null), 5000);
    return () => window.clearTimeout(t);
  }, [savedPath]);

  const selected = windows.find((w) => w.id === selectedId) ?? null;
  const keyword = windowQuery.trim().toLowerCase();
  const filtered = windows.filter(
    (w) =>
      !keyword ||
      w.title.toLowerCase().includes(keyword) ||
      w.app_name.toLowerCase().includes(keyword),
  );

  const handleStart = () => {
    if (selected) void start(selected.id);
  };

  const handleImport = () => {
    if (importToGame()) {
      reset();
      onClose();
    }
  };

  const handleSave = () => {
    void savePgn().then((path) => {
      if (path) setSavedPath(path);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70"
      onClick={requestClose}
    >
      <div
        className="flex max-h-[80vh] w-[460px] flex-col rounded-xl border border-gold-500/40 bg-ink-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-gold-300">录制棋谱</span>
          <div className="flex items-center gap-2">
            {phase === "recording" && (
              <span className="flex items-center gap-1.5 text-xs text-verm-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-verm-500" />
                录制中
              </span>
            )}
            {phase === "locating" && (
              <span className="text-xs text-gold-400">正在定位棋盘…</span>
            )}
            {closable && (
              <button
                onClick={onClose}
                title="关闭（Esc）"
                className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {warning && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-gold-500/40 bg-gold-400/10 px-2.5 py-1.5 text-xs leading-relaxed text-gold-300">
            <span className="min-w-0 flex-1 break-all">{warning}</span>
            <button
              onClick={() => useRecorderStore.setState({ warning: null })}
              title="关闭提示"
              className="shrink-0 rounded px-1 transition-colors hover:bg-ink-800"
            >
              ✕
            </button>
          </div>
        )}

        {phase === "error" && (
          <>
            <div className="break-all rounded-md border border-verm-500/50 bg-verm-500/10 px-3 py-2.5 text-sm leading-relaxed text-verm-400">
              {message ?? "录制出错"}
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={reset} className={BTN} title="回到窗口选择">
                重置
              </button>
            </div>
          </>
        )}

        {(phase === "idle" || phase === "locating") && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <input
                value={windowQuery}
                onChange={(e) => setWindowQuery(e.target.value)}
                placeholder="搜索窗口标题或程序名…"
                className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-sm text-ink-200 outline-none placeholder:text-ink-400 focus:border-gold-500/60"
              />
              <button
                onClick={() => void refreshWindows()}
                className={BTN}
                title="重新列出窗口"
              >
                刷新
              </button>
            </div>

            <div className="flex max-h-[300px] min-h-[180px] flex-col gap-1.5 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="flex flex-1 items-center justify-center text-xs text-ink-400">
                  {windows.length === 0 ? "未发现窗口，请点击刷新" : "无匹配窗口"}
                </div>
              )}
              {filtered.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                    selectedId === w.id
                      ? "border-gold-500/60 bg-ink-700"
                      : "border-ink-700 bg-ink-800 hover:border-gold-500/60 hover:bg-ink-700"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-200" title={w.title}>
                      {w.title || "（无标题窗口）"}
                    </span>
                    <span className="block truncate text-xs text-ink-400">
                      {w.app_name} · {w.width}×{w.height}
                    </span>
                  </span>
                  {selectedId === w.id && (
                    <span className="shrink-0 rounded bg-gold-400/15 px-1.5 py-0.5 text-[10px] text-gold-300">
                      已选
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-ink-400">
                {selected
                  ? `将录制「${selected.title || selected.app_name}」`
                  : "请先选择对方棋软窗口"}
              </span>
              <button
                onClick={handleStart}
                disabled={!selected || phase === "locating"}
                className={`${BTN} border-gold-500/50 text-gold-300`}
                title="定位所选窗口中的棋盘并开始录制"
              >
                {phase === "locating" ? "正在定位棋盘…" : "● 开始录制"}
              </button>
            </div>
          </>
        )}

        {(phase === "recording" || phase === "stopped") && (
          <>
            <div className="truncate rounded-md bg-ink-800 px-2.5 py-1.5 text-xs text-ink-300" title={startFen ?? undefined}>
              起点 FEN：{startFen ?? "—"}
            </div>

            <div
              ref={listRef}
              className="mt-2 min-h-[200px] flex-1 overflow-y-auto rounded-lg border border-ink-700 bg-ink-800"
            >
              {moves.length === 0 ? (
                <div className="flex h-full items-center justify-center py-10 text-xs text-ink-400">
                  等待对方走棋…
                </div>
              ) : (
                moves.map((m) => {
                  const red = pieceColor(m.piece) === "red";
                  return (
                    <div
                      key={m.ply}
                      className="flex items-center gap-2 border-b border-ink-700/60 px-3 py-1.5 text-sm last:border-b-0"
                    >
                      <span className="w-7 shrink-0 text-right text-xs text-ink-400">
                        {m.ply}.
                      </span>
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${
                          red
                            ? "bg-verm-500/15 text-verm-400"
                            : "bg-ink-700 text-ink-300"
                        }`}
                      >
                        {red ? "红" : "黑"}
                      </span>
                      <span className="font-piece text-base text-ink-200">
                        {m.notation}
                      </span>
                      <span className="text-xs text-ink-400">{m.from + m.to}</span>
                      {m.captured && (
                        <span className="ml-auto shrink-0 text-xs text-gold-400">
                          吃 {pieceGlyph(m.captured)}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-gold-300" title={savedPath ?? undefined}>
                {savedPath ? `已保存到 ${savedPath}` : ""}
              </span>
              {phase === "recording" && (
                <button
                  onClick={() => void stop()}
                  className={`${BTN} border-verm-500/50 text-verm-400`}
                  title="结束录制，保留已录着法"
                >
                  ■ 停止录制
                </button>
              )}
              {phase === "stopped" && (
                <>
                  <button onClick={reset} className={BTN} title="返回窗口选择">
                    重新选择窗口
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={moves.length === 0}
                    className={BTN}
                    title="弹出另存为对话框，默认定位棋谱库目录，可选择位置或新建文件夹"
                  >
                    保存到棋谱库
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={moves.length === 0}
                    className={`${BTN} border-gold-500/50 text-gold-300`}
                    title="载入主界面复盘"
                  >
                    导入复盘台
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
