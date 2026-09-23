import { pieceColor, pieceGlyph, type Board, type Pos, idx } from "./types";

const RED_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

function fileNumStr(x: number, color: "red" | "black"): string {
  if (color === "red") return RED_NUMERALS[9 - x - 1]!;
  return String(x + 1);
}

function stepNumStr(n: number, color: "red" | "black"): string {
  if (color === "red") return RED_NUMERALS[n - 1]!;
  return String(n);
}

function sameFileSiblings(board: Board, piece: string, from: Pos): Pos[] {
  const out: Pos[] = [];
  for (let y = 0; y < 10; y++) {
    if (board[idx(from.x, y)] === piece) out.push({ x: from.x, y });
  }
  return out;
}

export function chineseNotation(
  board: Board,
  from: Pos,
  to: Pos,
): string {
  const piece = board[idx(from.x, from.y)]!;
  const color = pieceColor(piece);
  const glyph = pieceGlyph(piece);
  const kind = piece.toUpperCase();

  let prefix: string;
  const siblings = sameFileSiblings(board, piece, from);
  if (siblings.length > 1 && kind !== "K") {
    const sorted = [...siblings].sort((a, b) =>
      color === "red" ? b.y - a.y : a.y - b.y,
    );
    const posIndex = sorted.findIndex((p) => p.y === from.y && p.x === from.x);
    const total = sorted.length;
    if (posIndex === 0) {
      prefix = "前";
    } else if (posIndex === total - 1) {
      prefix = "后";
    } else if (total === 3) {
      prefix = "中";
    } else {
      prefix = RED_NUMERALS[posIndex] ?? "中";
    }
  } else {
    prefix = fileNumStr(from.x, color);
  }

  const head =
    siblings.length > 1 && kind !== "K"
      ? `${prefix}${glyph}`
      : `${glyph}${fileNumStr(from.x, color)}`;

  let action: string;
  let dest: string;
  if (to.y === from.y) {
    action = "平";
    dest = fileNumStr(to.x, color);
  } else {
    const forward = color === "red" ? to.y > from.y : to.y < from.y;
    action = forward ? "进" : "退";
    if (kind === "N" || kind === "B" || kind === "A") {
      dest = fileNumStr(to.x, color);
    } else {
      dest = stepNumStr(Math.abs(to.y - from.y), color);
    }
  }

  return `${head}${action}${dest}`;
}

export function posToIccs(p: Pos): string {
  return String.fromCharCode(97 + p.x) + String(p.y);
}

export function moveIccs(from: Pos, to: Pos): string {
  return posToIccs(from) + posToIccs(to);
}
