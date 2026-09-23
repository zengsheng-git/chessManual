import { describe, expect, it } from "vitest";
import { START_FEN, boardToFen, parseFen } from "./fen";
import { idx } from "./types";

describe("fen", () => {
  it("解析标准开局 FEN", () => {
    const { board, turn } = parseFen(START_FEN);
    expect(turn).toBe("red");
    expect(board.filter(Boolean)).toHaveLength(32);
    expect(board[idx(4, 0)]).toBe("K");
    expect(board[idx(4, 9)]).toBe("k");
    expect(board[idx(0, 0)]).toBe("R");
    expect(board[idx(8, 9)]).toBe("r");
    expect(board[idx(1, 2)]).toBe("C");
    expect(board[idx(7, 7)]).toBe("c");
    expect(board[idx(4, 3)]).toBe("P");
  });

  it("boardToFen 与 parseFen 往返一致", () => {
    const { board, turn } = parseFen(START_FEN);
    expect(boardToFen(board, turn)).toBe(START_FEN);
  });

  it("空棋盘序列化", () => {
    const fen = boardToFen(new Array(90).fill(null), "black");
    expect(fen).toBe("9/9/9/9/9/9/9/9/9/9 b - - 0 1");
  });
});
