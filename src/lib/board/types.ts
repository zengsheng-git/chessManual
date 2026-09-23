export type Color = "red" | "black";

export type Piece = string;

export type Board = (Piece | null)[];

export interface Pos {
  x: number;
  y: number;
}

export const NUM_FILES = 9;
export const NUM_RANKS = 10;

export function idx(x: number, y: number): number {
  return y * NUM_FILES + x;
}

export function inBoard(x: number, y: number): boolean {
  return x >= 0 && x < NUM_FILES && y >= 0 && y < NUM_RANKS;
}

export function pieceColor(piece: Piece): Color {
  return piece === piece.toUpperCase() ? "red" : "black";
}

export function pieceGlyph(piece: Piece): string {
  const glyphs: Record<string, string> = {
    K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵",
    k: "将", a: "士", b: "象", n: "马", r: "车", c: "炮", p: "卒",
  };
  return glyphs[piece] ?? "?";
}
