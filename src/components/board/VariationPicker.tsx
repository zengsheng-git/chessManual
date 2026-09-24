import { useEffect } from "react";
import { selectNode, useGameStore } from "../../stores/gameStore";
import type { Pos } from "../../lib/board/types";

export interface MovePreview {
  from: Pos;
  to: Pos;
}

interface VariationPickerProps {
  onPreview: (move: MovePreview | null) => void;
}

export default function VariationPicker({ onPreview }: VariationPickerProps) {
  const game = useGameStore((s) => s.game);
  const path = useGameStore((s) => s.path);
  const pickerOpen = useGameStore((s) => s.pickerOpen);
  const pickBranch = useGameStore((s) => s.pickBranch);
  const closePicker = useGameStore((s) => s.closePicker);

  useEffect(() => () => onPreview(null), [onPreview]);

  if (!pickerOpen || !game) return null;

  const options =
    path.length === 0 ? game.moves : (selectNode(game, path)?.children ?? []);
  if (options.length <= 1) return null;

  const enterOption = (opt: (typeof options)[number]) => {
    onPreview({ from: opt.from, to: opt.to });
  };
  const leaveOption = () => {
    onPreview(null);
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col border-b border-gold-500/40 bg-ink-900 p-3 shadow-2xl">
      <div className="mb-2.5 flex shrink-0 items-center justify-between">
        <span className="text-sm font-bold text-gold-300">
          此步有 {options.length} 种走法
        </span>
        <button
          onClick={closePicker}
          title="取消（Esc）"
          className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
        {options.map((opt, i) => (
          <button
            key={opt.id}
            onClick={() => pickBranch(i)}
            onMouseEnter={() => enterOption(opt)}
            onMouseLeave={leaveOption}
            className="flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-2 text-left transition-colors hover:border-gold-500/60 hover:bg-ink-700"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ink-700 text-xs text-ink-300">
              {i + 1}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                i === 0
                  ? "bg-gold-400/15 text-gold-300"
                  : "bg-ink-700 text-ink-400"
              }`}
            >
              {i === 0 ? "主线" : `变例 ${i}`}
            </span>
            <span className="font-piece text-base text-ink-100">
              {opt.notation}
            </span>
            {opt.comment && (
              <span
                className="shrink-0 rounded bg-gold-400/10 px-1 text-[10px] text-gold-300"
                title={opt.comment}
              >
                注
              </span>
            )}
            {opt.children.length > 1 && (
              <span className="shrink-0 text-[10px] text-ink-400">
                {opt.children.length} 变
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs text-ink-500">
              第 {opt.ply} 手
            </span>
          </button>
        ))}
      </div>

      <div className="mt-2.5 shrink-0 text-center text-[11px] text-ink-500">
        悬停可在棋盘预览落子 · 点击走法继续 · 数字键 1-
        {Math.min(options.length, 9)} 快速选择 · Esc 取消
      </div>
    </div>
  );
}