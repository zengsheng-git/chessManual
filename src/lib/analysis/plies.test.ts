import { describe, expect, it } from "vitest";
import { START_FEN } from "../board/fen";
import { buildGame } from "../record/toGame";
import { collectMainlinePlies } from "./plies";

// 红黑交替的合法序列（与 toGame.test.ts 相同）
const MOVES = [
  { from: "h2", to: "e2" },
  { from: "h9", to: "g7" },
  { from: "a3", to: "a4" },
  { from: "a6", to: "a5" },
];

describe("collectMainlinePlies", () => {
  it("沿主线收集逐手分析输入", () => {
    const game = buildGame(START_FEN, MOVES);
    const plies = collectMainlinePlies(game);
    expect(plies).toHaveLength(MOVES.length);
    // 每手带 iccs 与中文记法
    expect(plies[0].iccs).toBe("h2e2");
    expect(plies[0].notation).toBe("炮二平五");
    // 红先棋局: 奇数手红方、偶数手黑方
    expect(plies[0].side).toBe("red");
    expect(plies[1].side).toBe("black");
    expect(plies[2].side).toBe("red");
    // 首手"走子前"局面为棋局起点 FEN
    expect(plies[0].fen).toBe(START_FEN);
    // 后续每手"走子前"局面 = 上一手的走子后局面；"走子后"局面 = 下一手的走子前局面
    expect(plies[0].next_fen).toBe(plies[1].fen);
    expect(plies[1].next_fen).toBe(plies[2].fen);
    expect(plies[2].next_fen).toBe(plies[3].fen);
  });

  it("空棋局返回空列表", () => {
    const game = buildGame(START_FEN, []);
    expect(collectMainlinePlies(game)).toHaveLength(0);
  });
});
