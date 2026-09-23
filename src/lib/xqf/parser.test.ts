import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFen } from "../board/fen";
import { idx } from "../board/types";
import { parseXqf } from "./parser";
import { selectNode } from "../../stores/gameStore";
import type { MoveNode } from "./parser";

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
}

function countNodes(nodes: MoveNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countNodes(n.children), 0);
}

function flatten(nodes: MoveNode[]): MoveNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

describe("parseXqf", () => {
  it("解析残局棋谱（炮兵胜卒双士，仅初始局面）", () => {
    const game = parseXqf(loadFixture("endgame.xqf"), "endgame.xqf");
    const { board } = parseFen(game.startFen);
    const occupied = board.map((p, i) => ({ p, i })).filter((x) => x.p !== null);
    expect(occupied).toHaveLength(7);
    expect(board[idx(4, 0)]).toBe("K");
    expect(board[idx(2, 4)]).toBe("C");
    expect(board[idx(4, 5)]).toBe("P");
    expect(board[idx(4, 9)]).toBe("k");
    expect(board[idx(3, 9)]).toBe("a");
    expect(board[idx(5, 9)]).toBe("a");
    expect(board[idx(0, 6)]).toBe("p");
    expect(game.moves).toHaveLength(0);
    expect(game.moveCount).toBe(0);
  });

  it("解析全局棋谱（梅花变法谱 第1局）", () => {
    const game = parseXqf(loadFixture("fullgame.xqf"), "fullgame.xqf");
    expect(game.moveCount).toBeGreaterThan(20);
    expect(game.info.title).toBeTruthy();

    const { board } = parseFen(game.startFen);
    expect(board.filter(Boolean).length).toBeLessThanOrEqual(32);

    const flat = flatten(game.moves);
    const first = game.moves[0]!;
    expect(first.ply).toBe(1);
    expect(first.path).toEqual([0]);

    const deep = flat.reduce((a, b) => (b.path.length > a.path.length ? b : a));
    const node = selectNode(game, deep.path);
    expect(node).not.toBeNull();
    expect(node!.notation.length).toBeGreaterThan(0);
  });

  it("拒绝非 XQF 文件", () => {
    const fake = new Uint8Array(0x400);
    expect(() => parseXqf(fake, "fake")).toThrow(/文件头/);
    expect(() => parseXqf(new Uint8Array(10), "tiny")).toThrow(/文件太小/);
  });

  it("着法树路径与 countNodes 一致", () => {
    const game = parseXqf(loadFixture("fullgame.xqf"), "fullgame.xqf");
    expect(countNodes(game.moves)).toBe(game.moveCount);
  });
});
