import { describe, expect, it } from "vitest";
import { START_FEN } from "../board/fen";
import { buildGame } from "../record/toGame";
import { toPgn } from "./writer";

// 红黑交替的 8 步合法序列
const MOVES = [
  { from: "h2", to: "e2" },
  { from: "h9", to: "g7" },
  { from: "a3", to: "a4" },
  { from: "a6", to: "a5" },
  { from: "a4", to: "a5" },
  { from: "b7", to: "e7" },
  { from: "a0", to: "a1" },
  { from: "i6", to: "i5" },
];

const blackFirstFen = START_FEN.replace(" w ", " b ");

describe("toPgn", () => {
  it("输出七个标准标签行", () => {
    const pgn = toPgn(buildGame(START_FEN, MOVES));
    expect(pgn).toContain('[Event "棋枰棋谱录制"]');
    expect(pgn).toContain('[Site "本地"]');
    expect(pgn).toMatch(/\[Date "\d{4}\.\d{2}\.\d{2}"\]/);
    expect(pgn).toContain('[Round "-"]');
    expect(pgn).toContain('[White "红方"]');
    expect(pgn).toContain('[Black "黑方"]');
    expect(pgn).toContain('[Result "*"]');
    expect(pgn).not.toContain("[SetUp");
    expect(pgn).not.toContain("[FEN ");
  });

  it("movetext 按红黑一轮编号并以 * 收尾", () => {
    const pgn = toPgn(buildGame(START_FEN, MOVES));
    expect(pgn.split("\n\n")[1]).toBe(
      "1. h2e2 h9g7 2. a3a4 a6a5 3. a4a5 b7e7 4. a0a1 i6i5 *\n",
    );
  });

  it("非标准起点 FEN 追加 SetUp/FEN 标签", () => {
    const pgn = toPgn(buildGame(blackFirstFen, []), blackFirstFen);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${blackFirstFen}"]`);
    expect(pgn.split("\n\n")[1]).toBe("*\n");
  });

  it("黑先局面 movetext 用「N...」编号", () => {
    const pgn = toPgn(
      buildGame(blackFirstFen, [{ from: "a6", to: "a5" }]),
      blackFirstFen,
    );
    expect(pgn.split("\n\n")[1]).toBe("1... a6a5 *\n");
  });
});
