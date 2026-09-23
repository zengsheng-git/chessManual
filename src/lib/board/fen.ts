import { NUM_FILES, NUM_RANKS, type Board, type Color, idx, inBoard } from "./types";

export const START_FEN =
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

export function emptyBoard(): Board {
  return new Array(NUM_FILES * NUM_RANKS).fill(null);
}

export function parseFen(fen: string): { board: Board; turn: Color } {
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0]!.split("/");
  const board = emptyBoard();
  rows.forEach((row, i) => {
    const y = NUM_RANKS - 1 - i;
    let x = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "9") {
        x += Number(ch);
      } else {
        board[idx(x, y)] = ch;
        x += 1;
      }
    }
  });
  return { board, turn: parts[1] === "b" ? "black" : "red" };
}

export function boardToFen(board: Board, turn: Color): string {
  const rows: string[] = [];
  for (let y = NUM_RANKS - 1; y >= 0; y--) {
    let row = "";
    let empty = 0;
    for (let x = 0; x < NUM_FILES; x++) {
      const piece = board[idx(x, y)];
      if (piece) {
        if (empty > 0) {
          row += String(empty);
          empty = 0;
        }
        row += piece;
      } else {
        empty += 1;
      }
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  return `${rows.join("/")} ${turn === "red" ? "w" : "b"} - - 0 1`;
}

export function isSameBoardFen(fenA: string, fenB: string): boolean {
  const a = fenA.split(/\s+/)[0];
  const b = fenB.split(/\s+/)[0];
  return a === b;
}

export { inBoard };
