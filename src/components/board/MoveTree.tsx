import { useEffect, useMemo, useRef } from "react";
import { useGameStore } from "../../stores/gameStore";
import type { MoveNode } from "../../lib/xqf/parser";

interface Row {
  node: MoveNode;
  depth: number;
  variation: boolean;
}

function isOnPath(node: MoveNode, path: number[]): boolean {
  if (path.length < node.path.length) return false;
  return node.path.every((v, i) => path[i] === v);
}

export default function MoveTree() {
  const game = useGameStore((s) => s.game);
  const path = useGameStore((s) => s.path);
  const setPath = useGameStore((s) => s.setPath);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const walk = (list: MoveNode[], depth: number) => {
      if (list.length === 0) return;
      const main = list[0]!;
      out.push({ node: main, depth, variation: false });
      for (let i = 1; i < list.length; i++) {
        const v = list[i]!;
        out.push({ node: v, depth: depth + 1, variation: true });
        walk(v.children, depth + 1);
      }
      walk(main.children, depth);
    };
    walk(game?.moves ?? [], 0);
    return out;
  }, [game]);

  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [path]);

  if (!game) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        未打开棋谱
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
        <span className="text-xs font-semibold tracking-widest text-ink-300">着 法 树</span>
        <span className="text-xs text-ink-400">
          共 {game.moveCount} 手{game.branchCount > 0 ? ` · ${game.branchCount} 处变例` : ""}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
        {rows.map(({ node, depth, variation }) => {
          const active = isOnPath(node, path);
          const current = active && path.length === node.path.length;
          const red = node.ply % 2 === 1;
          return (
            <button
              key={node.id}
              ref={current ? activeRef : undefined}
              onClick={() => setPath(node.path)}
              className={[
                "group flex w-max min-w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                current
                  ? "bg-gold-400/15 text-gold-300"
                  : active
                    ? "text-ink-200"
                    : "text-ink-300 hover:bg-ink-800/70 hover:text-ink-200",
              ].join(" ")}
              style={{ paddingLeft: 10 + Math.min(depth, 7) * 14 }}
              title={node.comment ?? node.notation}
            >
              {variation && (
                <span className="shrink-0 text-[11px] leading-none text-gold-500/80" title="变例">
                  ↳
                </span>
              )}
              <span
                className={[
                  "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  red ? "bg-verm-400" : "bg-ink-400",
                ].join(" ")}
              />
              <span className="w-8 shrink-0 text-right text-xs text-ink-400">{node.ply}.</span>
              <span className={`shrink-0 ${current ? "font-semibold" : ""}`}>{node.notation}</span>
              {node.comment && (
                <span className="shrink-0 text-[10px] text-gold-400/90" title="含注解">
                  注
                </span>
              )}
              {node.children.length > 1 && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPath([...node.path, 1]);
                  }}
                  title={`${node.children.length - 1} 个变例，点击进入第 1 个（或用 ↑↓ 切换）`}
                  className="ml-1 shrink-0 cursor-pointer rounded bg-ink-700/70 px-1 text-[10px] text-ink-300 transition-colors hover:bg-gold-400/25 hover:text-gold-300"
                >
                  {node.children.length} 变
                </span>
              )}
            </button>
          );
        })}
        {rows.length === 0 && (
          <div className="p-4 text-center text-sm text-ink-400">该棋谱没有着法记录</div>
        )}
      </div>
    </div>
  );
}
