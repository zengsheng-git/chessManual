import { useMemo } from "react";
import { parseFen } from "../../lib/board/fen";
import { pieceColor, pieceGlyph, type Pos } from "../../lib/board/types";

const CELL = 62;
const PAD = 46;
const WIDTH = PAD * 2 + CELL * 8;
const HEIGHT = PAD * 2 + CELL * 9;
const R = 26;

const RED_FILE_NUMS = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];

interface BoardProps {
  fen: string;
  flipped: boolean;
  lastMove: { from: Pos; to: Pos } | null;
}

function cornerPath(
  cx: number,
  cy: number,
  gap: number,
  len: number,
  sides: { left: boolean; right: boolean },
): string {
  const parts: string[] = [];
  if (sides.left) {
    parts.push(`M ${cx - gap - len} ${cy - gap} L ${cx - gap} ${cy - gap} L ${cx - gap} ${cy - gap + len}`);
    parts.push(`M ${cx - gap - len} ${cy + gap} L ${cx - gap} ${cy + gap} L ${cx - gap} ${cy + gap - len}`);
  }
  if (sides.right) {
    parts.push(`M ${cx + gap + len} ${cy - gap} L ${cx + gap} ${cy - gap} L ${cx + gap} ${cy - gap + len}`);
    parts.push(`M ${cx + gap + len} ${cy + gap} L ${cx + gap} ${cy + gap} L ${cx + gap} ${cy + gap - len}`);
  }
  return parts.join(" ");
}

export default function Board({ fen, flipped, lastMove }: BoardProps) {
  const { board } = useMemo(() => parseFen(fen), [fen]);

  const px = (x: number) => PAD + (flipped ? 8 - x : x) * CELL;
  const py = (y: number) => PAD + (flipped ? y : 9 - y) * CELL;

  let arrow: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (lastMove) {
    const dx = px(lastMove.to.x) - px(lastMove.from.x);
    const dy = py(lastMove.to.y) - py(lastMove.from.y);
    const dist = Math.hypot(dx, dy);
    if (dist >= 1) {
      arrow = {
        x1: px(lastMove.from.x),
        y1: py(lastMove.from.y),
        x2: px(lastMove.to.x) - (dx / dist) * 6,
        y2: py(lastMove.to.y) - (dy / dist) * 6,
      };
    }
  }

  const marks: { x: number; y: number }[] = [];
  for (const [mx, my] of [
    [1, 2], [7, 2], [1, 7], [7, 7],
    [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
    [0, 6], [2, 6], [4, 6], [6, 6], [8, 6],
  ]) {
    marks.push({ x: mx, y: my });
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="max-h-full max-w-full drop-shadow-2xl"
      role="img"
      aria-label="象棋棋盘"
    >
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0d8a8" />
          <stop offset="55%" stopColor="#e6c68c" />
          <stop offset="100%" stopColor="#dcb877" />
        </linearGradient>
        <radialGradient id="pieceFace" cx="0.38" cy="0.32" r="0.85">
          <stop offset="0%" stopColor="#faf0d8" />
          <stop offset="70%" stopColor="#f1e2bd" />
          <stop offset="100%" stopColor="#e2cb98" />
        </radialGradient>
        <filter id="pieceShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" floodColor="#3a2a12" floodOpacity="0.38" />
        </filter>
        <marker
          id="arrowHead"
          markerUnits="userSpaceOnUse"
          markerWidth="30"
          markerHeight="30"
          refX="23"
          refY="15"
          orient="auto"
        >
          <path d="M 2 4 L 27 15 L 2 26 Z" fill="var(--color-verm-500)" fillOpacity="0.85" />
        </marker>
      </defs>

      <rect x="10" y="10" width={WIDTH - 20} height={HEIGHT - 20} rx="14" fill="url(#wood)" />
      <rect
        x={PAD - 7}
        y={PAD - 7}
        width={8 * CELL + 14}
        height={9 * CELL + 14}
        fill="none"
        stroke="#8a5a20"
        strokeWidth="3"
        rx="3"
      />

      {Array.from({ length: 10 }, (_, r) => (
        <line
          key={`h${r}`}
          x1={PAD}
          y1={PAD + r * CELL}
          x2={PAD + 8 * CELL}
          y2={PAD + r * CELL}
          stroke="#7a5426"
          strokeWidth="1.4"
        />
      ))}
      {Array.from({ length: 9 }, (_, c) =>
        c === 0 || c === 8 ? (
          <line
            key={`v${c}`}
            x1={PAD + c * CELL}
            y1={PAD}
            x2={PAD + c * CELL}
            y2={PAD + 9 * CELL}
            stroke="#7a5426"
            strokeWidth="1.4"
          />
        ) : (
          <g key={`v${c}`}>
            <line x1={PAD + c * CELL} y1={PAD} x2={PAD + c * CELL} y2={PAD + 4 * CELL} stroke="#7a5426" strokeWidth="1.4" />
            <line x1={PAD + c * CELL} y1={PAD + 5 * CELL} x2={PAD + c * CELL} y2={PAD + 9 * CELL} stroke="#7a5426" strokeWidth="1.4" />
          </g>
        ),
      )}

      <g stroke="#7a5426" strokeWidth="1.2">
        <line x1={px(3)} y1={py(0)} x2={px(5)} y2={py(2)} />
        <line x1={px(5)} y1={py(0)} x2={px(3)} y2={py(2)} />
        <line x1={px(3)} y1={py(7)} x2={px(5)} y2={py(9)} />
        <line x1={px(5)} y1={py(7)} x2={px(3)} y2={py(9)} />
      </g>

      {marks.map((m) => (
        <path
          key={`m${m.x}-${m.y}`}
          d={cornerPath(px(m.x), py(m.y), 5, 7, { left: m.x > 0, right: m.x < 8 })}
          fill="none"
          stroke="#7a5426"
          strokeWidth="1.2"
        />
      ))}

      <text
        x={PAD + 2 * CELL}
        y={PAD + 4.5 * CELL}
        fontSize="30"
        fill="#9a7434"
        opacity="0.75"
        textAnchor="middle"
        dominantBaseline="central"
        letterSpacing="14"
        style={{ fontFamily: "var(--font-piece)" }}
      >
        楚 河
      </text>
      <text
        x={PAD + 6 * CELL}
        y={PAD + 4.5 * CELL}
        fontSize="30"
        fill="#9a7434"
        opacity="0.75"
        textAnchor="middle"
        dominantBaseline="central"
        letterSpacing="14"
        style={{ fontFamily: "var(--font-piece)" }}
      >
        汉 界
      </text>

      {Array.from({ length: 9 }, (_, d) => {
        const x = flipped ? 8 - d : d;
        return (
          <text
            key={`bt${d}`}
            x={px(x)}
            y={PAD - 20}
            fontSize="15"
            fill="#6b4a1e"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {flipped ? RED_FILE_NUMS[x] : x + 1}
          </text>
        );
      })}
      {Array.from({ length: 9 }, (_, d) => {
        const x = flipped ? 8 - d : d;
        return (
          <text
            key={`bb${d}`}
            x={px(x)}
            y={PAD + 9 * CELL + 22}
            fontSize="15"
            fill="#6b4a1e"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: "var(--font-piece)" }}
          >
            {flipped ? x + 1 : RED_FILE_NUMS[x]}
          </text>
        );
      })}

      {lastMove && (
        <>
          <circle
            cx={px(lastMove.from.x)}
            cy={py(lastMove.from.y)}
            r={R + 4}
            fill="var(--color-gold-300)"
            opacity="0.55"
          />
          <path
            d={cornerPath(px(lastMove.from.x), py(lastMove.from.y), R + 7, 9, { left: true, right: true })}
            fill="none"
            stroke="var(--color-gold-400)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      )}

      {board.map((piece, i) => {
        if (!piece) return null;
        const x = i % 9;
        const y = Math.floor(i / 9);
        const red = pieceColor(piece) === "red";
        const isTo = lastMove && lastMove.to.x === x && lastMove.to.y === y;
        return (
          <g key={i} transform={`translate(${px(x)},${py(y)})`}>
            {isTo && (
              <>
                <circle r={R + 10} fill="none" stroke="var(--color-gold-400)" strokeWidth="2" opacity="0.5" />
                <circle r={R + 5} fill="none" stroke="var(--color-gold-400)" strokeWidth="3.5" opacity="0.95" />
              </>
            )}
            <circle r={R} fill="url(#pieceFace)" stroke={red ? "#a03020" : "#3a3a3a"} strokeWidth="1.6" filter="url(#pieceShadow)" />
            <circle r={R - 5} fill="none" stroke={red ? "#c2402a" : "#4a4a4a"} strokeWidth="1.2" opacity="0.7" />
            <text
              y="1"
              fontSize="30"
              fontWeight="700"
              fill={red ? "#b02818" : "#26221c"}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fontFamily: "var(--font-piece)" }}
            >
              {pieceGlyph(piece)}
            </text>
          </g>
        );
      })}

      {arrow && (
        <line
          x1={arrow.x1}
          y1={arrow.y1}
          x2={arrow.x2}
          y2={arrow.y2}
          stroke="var(--color-verm-500)"
          strokeWidth="10"
          strokeLinecap="round"
          opacity="0.5"
          markerEnd="url(#arrowHead)"
        />
      )}
    </svg>
  );
}
