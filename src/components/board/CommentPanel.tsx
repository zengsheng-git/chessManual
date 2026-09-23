import { selectNode, useGameStore } from "../../stores/gameStore";

export default function CommentPanel() {
  const game = useGameStore((s) => s.game);
  const path = useGameStore((s) => s.path);
  const node = selectNode(game, path);
  const comment = node?.comment;

  if (!comment) return null;

  return (
    <div className="max-h-44 shrink-0 overflow-y-auto border-t border-ink-800 bg-ink-900 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-widest text-ink-300">
        <span className="text-gold-400">📝</span>
        <span>
          着 法 注 解<span className="ml-1.5 font-normal normal-case tracking-normal text-gold-400/90">
            · 第 {node?.ply} 手 {node?.notation}
          </span>
        </span>
      </div>
      <div className="whitespace-pre-wrap rounded-md bg-ink-800/80 p-2.5 text-xs leading-relaxed text-ink-200">
        {comment}
      </div>
    </div>
  );
}
