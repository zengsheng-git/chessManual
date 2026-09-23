import { useState } from "react";
import { useGameStore } from "../../stores/gameStore";

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="w-12 shrink-0 text-right text-xs text-ink-400">{label}</span>
      <span className="min-w-0 flex-1 truncate text-ink-200" title={value}>
        {value}
      </span>
    </div>
  );
}

export default function GameInfo() {
  const game = useGameStore((s) => s.game);
  const [showComment, setShowComment] = useState(false);

  if (!game) return null;

  const comment = game.info.comment;

  return (
    <div className="border-b border-ink-800 px-4 py-3">
      <h2
        className="mb-2.5 truncate text-base font-semibold text-gold-300"
        title={game.info.title ?? undefined}
      >
        {game.info.title ?? "未命名对局"}
      </h2>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-verm-400">{game.info.red ?? "红方"}</span>
          <span className="text-xs text-ink-400">对</span>
          <span className="font-medium text-ink-200">{game.info.black ?? "黑方"}</span>
          <span className="ml-auto rounded-full bg-ink-700/80 px-2 py-0.5 text-xs text-gold-300">
            {game.info.result}
          </span>
        </div>
        <InfoRow label="赛事" value={game.info.event} />
        <InfoRow label="日期" value={game.info.date} />
        <InfoRow label="地点" value={game.info.site} />
        <div className="flex items-center gap-2 text-sm">
          <span className="w-12 shrink-0 text-right text-xs text-ink-400">类型</span>
          <span className="rounded bg-ink-700/60 px-1.5 text-xs text-ink-200">{game.info.type}</span>
          <span className="ml-auto text-xs text-ink-400">
            XQF v{game.info.version} · {game.moveCount} 手
          </span>
        </div>
      </div>
      {comment && (
        <div className="mt-2">
          <button
            onClick={() => setShowComment((v) => !v)}
            className="text-xs text-gold-400/90 hover:text-gold-300"
          >
            {showComment ? "收起棋谱注解 ▲" : "查看棋谱注解 ▼"}
          </button>
          {showComment && (
            <div className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-ink-800/80 p-2.5 text-xs leading-relaxed text-ink-300">
              {comment}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
