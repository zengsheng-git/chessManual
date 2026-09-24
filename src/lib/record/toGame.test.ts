import { describe, expect, it } from "vitest";
import { START_FEN } from "../board/fen";
import type { MoveNode } from "../xqf/parser";
import { buildGame, iccsToPos } from "./toGame";

// 红黑交替的 8 步合法序列，第 5 步红兵吃黑卒
const MOVES = [
  { from: "h2", to: "e2" }, // 炮二平五
  { from: "h9", to: "g7" }, // 马8进7
  { from: "a3", to: "a4" }, // 兵九进一
  { from: "a6", to: "a5" }, // 卒1进1
  { from: "a4", to: "a5" }, // 兵九进一（吃卒）
  { from: "b7", to: "e7" }, // 炮2平5
  { from: "a0", to: "a1" }, // 车九进一
  { from: "i6", to: "i5" }, // 卒9进1
];

// 沿 children[0] 遍历主线（与 toPgn/goToEnd 的树形导航一致）
function mainLine(game: { moves: MoveNode[] }): MoveNode[] {
  const out: MoveNode[] = [];
  let cur = game.moves[0];
  while (cur) {
    out.push(cur);
    cur = cur.children[0] ?? null;
  }
  return out;
}

describe("iccsToPos", () => {
  it("解析 ICCS 坐标为棋盘坐标", () => {
    expect(iccsToPos("h2")).toEqual({ x: 7, y: 2 });
    expect(iccsToPos("a0")).toEqual({ x: 0, y: 0 });
  });

  it("拒绝合法范围外的坐标", () => {
    expect(() => iccsToPos("j9")).toThrowError(/无效坐标/);
  });
});

describe("buildGame", () => {
  it("构建与 XQF 解析同构的单线主线树", () => {
    const game = buildGame(START_FEN, MOVES);
    expect(game.startFen).toBe(START_FEN);
    expect(game.startTurn).toBe("red");
    expect(game.moveCount).toBe(MOVES.length);
    expect(game.branchCount).toBe(0);
    expect(game.moves).toHaveLength(1);
    const line = mainLine(game);
    expect(line).toHaveLength(MOVES.length);
    expect(line[0].ply).toBe(1);
    expect(line[0].path).toEqual([0]);
    expect(line[1].path).toEqual([0, 0]);
    expect(line[0].iccs).toBe("h2e2");
    expect(line[0].from).toEqual({ x: 7, y: 2 });
    expect(line[0].notation).toBe("炮二平五");
    expect(line[4].notation).toBe("兵九进一");
    expect(game.info.red).toBe("红方");
    expect(game.info.black).toBe("黑方");
  });

  it("每步 fen 为走子后局面且行棋方交替", () => {
    const line = mainLine(buildGame(START_FEN, MOVES));
    expect(line[0].fen).toBe(
      "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1",
    );
    expect(line[4].fen).toBe(
      "rnbakab1r/9/1c4nc1/2p1p1p1p/P8/9/2P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1",
    );
    expect(line[1].fen.endsWith(" w - - 0 1")).toBe(true);
  });

  it("非法着法抛出带手数的中文错误", () => {
    expect(() => buildGame(START_FEN, [{ from: "e3", to: "f3" }])).toThrowError(
      /第 1 手/,
    );
    expect(() =>
      buildGame(START_FEN, [
        { from: "h2", to: "e2" },
        { from: "e2", to: "e3" },
      ]),
    ).toThrowError(/第 2 手/);
  });
});
