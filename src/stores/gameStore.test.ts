import { beforeEach, describe, expect, it } from "vitest";
import { currentFen, selectNode, useGameStore } from "./gameStore";
import { START_FEN } from "../lib/board/fen";
import type { MoveNode, ParsedGame } from "../lib/xqf/parser";

function mkMove(id: number, fen: string, children: MoveNode[] = []): MoveNode {
  return {
    id,
    path: [],
    from: { x: 7, y: 9 },
    to: { x: 7, y: 8 },
    iccs: "h2e2",
    notation: "炮二平五",
    comment: null,
    fen,
    ply: id,
    children,
  };
}

const game: ParsedGame = {
  info: {
    title: null,
    event: null,
    date: null,
    site: null,
    red: null,
    black: null,
    result: "未知",
    type: null,
    version: 12,
    comment: null,
  },
  startFen: START_FEN,
  startTurn: "red",
  moves: [mkMove(1, "fen-A", [mkMove(2, "fen-B")])],
  moveCount: 2,
  branchCount: 0,
};

const branchGame: ParsedGame = {
  info: {
    title: null,
    event: null,
    date: null,
    site: null,
    red: null,
    black: null,
    result: "未知",
    type: null,
    version: 12,
    comment: null,
  },
  startFen: START_FEN,
  startTurn: "red",
  moves: [
    mkMove(1, "fen-1", [
      mkMove(2, "fen-2", [mkMove(3, "fen-3", [mkMove(4, "fen-4")]), mkMove(31, "fen-3v")]),
      mkMove(21, "fen-2v"),
    ]),
  ],
  moveCount: 5,
  branchCount: 2,
};

describe("gameStore 着法导航", () => {
  beforeEach(() => {
    useGameStore.setState({ game, path: [] });
  });

  it("初始局面点下一手应走出第一步（回归：曾因根节点为 null 而无操作）", () => {
    useGameStore.getState().goNext();
    expect(useGameStore.getState().path).toEqual([0]);
  });

  it("连续下一手走到终局后不再前进", () => {
    const s = useGameStore.getState();
    s.goNext();
    s.goNext();
    expect(useGameStore.getState().path).toEqual([0, 0]);
    s.goNext();
    expect(useGameStore.getState().path).toEqual([0, 0]);
  });

  it("上一手逐步回退，到初始局面后不再后退", () => {
    const s = useGameStore.getState();
    s.goNext();
    s.goNext();
    s.goPrev();
    expect(useGameStore.getState().path).toEqual([0]);
    s.goPrev();
    expect(useGameStore.getState().path).toEqual([]);
    s.goPrev();
    expect(useGameStore.getState().path).toEqual([]);
  });

  it("终局按钮直达最后一步", () => {
    useGameStore.getState().goToEnd();
    expect(useGameStore.getState().path).toEqual([0, 0]);
  });

  it("当前局面 FEN 取自所在节点", () => {
    useGameStore.getState().goNext();
    expect(currentFen(game, useGameStore.getState().path)).toBe("fen-A");
    expect(currentFen(game, [])).toBe(START_FEN);
  });

  it("selectNode 按 path 定位节点", () => {
    expect(selectNode(game, [0])?.fen).toBe("fen-A");
    expect(selectNode(game, [0, 0])?.fen).toBe("fen-B");
    expect(selectNode(game, [9])).toBe(null);
  });
});

describe("gameStore 分歧跳转", () => {
  beforeEach(() => {
    useGameStore.setState({ game: branchGame, path: [], pickerOpen: false });
  });

  it("从开局向后跳到第一个分歧点并弹出选择框", () => {
    useGameStore.getState().gotoBranch(1);
    expect(useGameStore.getState().path).toEqual([0]);
    expect(useGameStore.getState().pickerOpen).toBe(true);
  });

  it("连续向后跳依次经过各分歧点，最后一个分歧点后再跳无动作", () => {
    const s = useGameStore.getState();
    s.gotoBranch(1);
    s.gotoBranch(1);
    expect(useGameStore.getState().path).toEqual([0, 0]);
    s.gotoBranch(1);
    expect(useGameStore.getState().path).toEqual([0, 0]);
  });

  it("从分歧点向前跳回到上一个分歧点", () => {
    const s = useGameStore.getState();
    s.gotoBranch(1);
    s.gotoBranch(1);
    s.gotoBranch(-1);
    expect(useGameStore.getState().path).toEqual([0]);
  });

  it("开局位置向前跳无动作且不弹选择框", () => {
    useGameStore.getState().gotoBranch(-1);
    expect(useGameStore.getState().path).toEqual([]);
    expect(useGameStore.getState().pickerOpen).toBe(false);
  });
});
