import { type Board, idx, inBoard, pieceColor, type Pos } from "./types";

function inPalace(x: number, y: number, color: "red" | "black"): boolean {
  if (x < 3 || x > 5) return false;
  return color === "red" ? y >= 0 && y <= 2 : y >= 7 && y <= 9;
}

function crossedRiver(y: number, color: "red" | "black"): boolean {
  return color === "red" ? y >= 5 : y <= 4;
}

function clearPath(board: Board, from: Pos, to: Pos): boolean {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  while (x !== to.x || y !== to.y) {
    if (board[idx(x, y)]) return false;
    x += dx;
    y += dy;
  }
  return true;
}

function screenCount(board: Board, from: Pos, to: Pos): number {
  let count = 0;
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  while (x !== to.x || y !== to.y) {
    if (board[idx(x, y)]) count += 1;
    x += dx;
    y += dy;
  }
  return count;
}

export function isPseudoLegalMove(
  board: Board,
  from: Pos,
  to: Pos,
): boolean {
  if (!inBoard(from.x, from.y) || !inBoard(to.x, to.y)) return false;
  const piece = board[idx(from.x, from.y)];
  if (!piece) return false;
  const target = board[idx(to.x, to.y)];
  if (target && pieceColor(target) === pieceColor(piece)) return false;
  if (from.x === to.x && from.y === to.y) return false;

  const color = pieceColor(piece);
  const kind = piece.toUpperCase();
  const dxF = to.x - from.x;
  const dyF = to.y - from.y;
  const adx = Math.abs(dxF);
  const ady = Math.abs(dyF);

  switch (kind) {
    case "R":
      return dxF === 0 || dyF === 0 ? clearPath(board, from, to) : false;
    case "C": {
      if (dxF !== 0 && dyF !== 0) return false;
      const screens = screenCount(board, from, to);
      return target ? screens === 1 : screens === 0;
    }
    case "N":
      if (!((adx === 1 && ady === 2) || (adx === 2 && ady === 1))) return false;
      return !board[idx(from.x + Math.sign(dxF) * (adx > ady ? 1 : 0), from.y + Math.sign(dyF) * (ady > adx ? 1 : 0))];
    case "B": {
      if (adx !== 2 || ady !== 2) return false;
      if (crossedRiver(to.y, color) !== crossedRiver(from.y, color)) return false;
      return !board[idx(from.x + dxF / 2, from.y + dyF / 2)];
    }
    case "A":
      return adx === 1 && ady === 1 && inPalace(to.x, to.y, color);
    case "K":
      return adx + ady === 1 && inPalace(to.x, to.y, color);
    case "P": {
      if (adx + ady !== 1) return false;
      const forward = color === "red" ? 1 : -1;
      if (dyF === forward && adx === 0) return true;
      return adx === 1 && dyF === 0 && crossedRiver(from.y, color);
    }
    default:
      return false;
  }
}
