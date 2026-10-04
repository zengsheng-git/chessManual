import type { MoveNode, ParsedGame } from "../xqf/parser";
import type { AnalyzePlyInput } from "../ipc";
import type { Color } from "../board/types";

/** 带中文记法的分析输入：notation 仅前端展示用，不发给后端 */
export type AnalyzePly = AnalyzePlyInput & { notation: string };

function otherSide(c: Color): Color {
  return c === "red" ? "black" : "red";
}

/** 沿 children[0] 收集主线逐手数据，供引擎逐手分析 */
export function collectMainlinePlies(game: ParsedGame): AnalyzePly[] {
  const nodes: MoveNode[] = [];
  let list = game.moves;
  while (list.length > 0) {
    const node = list[0]!;
    nodes.push(node);
    list = node.children;
  }
  return nodes.map((node, i) => ({
    side: i % 2 === 0 ? game.startTurn : otherSide(game.startTurn),
    iccs: node.iccs,
    // 每手"走子前"局面 = 上一手的走子后局面；首手用棋局起点 FEN
    fen: i === 0 ? game.startFen : nodes[i - 1]!.fen,
    next_fen: node.fen,
    notation: node.notation,
  }));
}
