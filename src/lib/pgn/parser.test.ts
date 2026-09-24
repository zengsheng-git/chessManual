import { describe, expect, it } from "vitest";
import { START_FEN } from "../board/fen";
import type { MoveNode } from "../xqf/parser";
import { buildGame } from "../record/toGame";
import { toPgn } from "./writer";
import { parsePgn } from "./parser";

// 与 toGame.test 一致的合法序列，保证解析走子校验可过
const MOVES = [
  { from: "h2", to: "e2" }, // 炮二平五
  { from: "h9", to: "g7" }, // 马8进7
  { from: "a3", to: "a4" }, // 兵九进一
  { from: "a6", to: "a5" }, // 卒1进1
];

// 沿 children[0] 遍历主线（ParsedGame.moves 根层仅含首手）
function mainLine(game: { moves: MoveNode[] }): MoveNode[] {
  const out: MoveNode[] = [];
  let cur = game.moves[0];
  while (cur) {
    out.push(cur);
    cur = cur.children[0] ?? null;
  }
  return out;
}

describe("parsePgn", () => {
  it("解析自导出 PGN 并还原对局（round-trip）", () => {
    const text = toPgn(buildGame(START_FEN, MOVES), START_FEN);
    const game = parsePgn(text, "录制对局_2026-09-24.pgn");
    expect(game.moveCount).toBe(MOVES.length);
    expect(game.startFen).toBe(START_FEN);
    expect(game.startTurn).toBe("red");
    expect(game.branchCount).toBe(0);
    expect(game.moves[0]?.notation).toBe("炮二平五");
    expect(game.moves[0]?.iccs).toBe("h2e2");
    expect(game.info.title).toBe("录制对局_2026-09-24");
    expect(game.info.event).toBe("棋枰棋谱录制");
    expect(game.info.result).toBe("未知");
  });

  it("标签信息映射到对局信息", () => {
    const text = [
      '[Event "测试赛"]',
      '[Site "线上"]',
      '[Date "2026.09.24"]',
      '[White "红方选手"]',
      '[Black "黑方选手"]',
      '[Result "1-0"]',
      "",
      "1. h2e2 h9g7 *",
    ].join("\n");
    const game = parsePgn(text, "a.pgn");
    expect(game.info.event).toBe("测试赛");
    expect(game.info.site).toBe("线上");
    expect(game.info.date).toBe("2026-09-24");
    expect(game.info.red).toBe("红方选手");
    expect(game.info.black).toBe("黑方选手");
    expect(game.info.result).toBe("红胜");
    expect(game.moveCount).toBe(2);
  });

  it("支持 FEN 标签的非标准开局与黑先 movetext", () => {
    // 标准盘面 + 行棋方改为黑先
    const fen = START_FEN.replace(" w - - 0 1", " b - - 0 1");
    const text = `[SetUp "1"]\n[FEN "${fen}"]\n\n1... h9g7 2. h2e2 *`;
    const game = parsePgn(text, "让先.pgn");
    expect(game.startFen).toBe(fen);
    expect(game.startTurn).toBe("black");
    expect(game.moveCount).toBe(2);
  });

  it("忽略注释、变招括号与着法序号", () => {
    const text = [
      '[Event "x"]',
      "",
      "1. h2e2 {中炮} (1. b2e2 h9g7) ; 行注释 h0g2",
      "1... h9g7 2. a3a4 $10 a6a5 *",
    ].join("\n");
    const game = parsePgn(text, "x.pgn");
    expect(game.moveCount).toBe(4);
    expect(mainLine(game)[2]?.iccs).toBe("a3a4");
  });

  it("无着法或非法着法抛出中文错误", () => {
    expect(() => parsePgn('[Event "x"]\n\n1-0\n', "x.pgn")).toThrowError(/没有找到着法/);
    expect(() => parsePgn('[Event "x"]\n\n1. e3e6 *\n', "x.pgn")).toThrowError(/第 1 手/);
  });
});
