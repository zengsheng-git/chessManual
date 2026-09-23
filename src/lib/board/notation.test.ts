import { describe, expect, it } from "vitest";
import { START_FEN, parseFen } from "./fen";
import { chineseNotation, moveIccs, posToIccs } from "./notation";

describe("notation", () => {
  it("炮二平五", () => {
    const { board } = parseFen(START_FEN);
    expect(chineseNotation(board, { x: 7, y: 2 }, { x: 4, y: 2 })).toBe("炮二平五");
  });

  it("马八进七", () => {
    const { board } = parseFen(START_FEN);
    expect(chineseNotation(board, { x: 1, y: 0 }, { x: 2, y: 2 })).toBe("马八进七");
  });

  it("卒3进1（黑方数字记谱）", () => {
    const { board } = parseFen(START_FEN);
    expect(chineseNotation(board, { x: 2, y: 6 }, { x: 2, y: 5 })).toBe("卒3进1");
  });

  it("车九进一", () => {
    const { board } = parseFen(START_FEN);
    expect(chineseNotation(board, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe("车九进一");
  });

  it("ICCS 坐标", () => {
    expect(posToIccs({ x: 0, y: 0 })).toBe("a0");
    expect(moveIccs({ x: 7, y: 2 }, { x: 4, y: 2 })).toBe("h2e2");
  });
});
