import { boardToFen, parseFen } from "../board/fen";
import { isPseudoLegalMove } from "../board/rules";
import { chineseNotation } from "../board/notation";
import {
  idx,
  pieceColor,
  type Board,
  type Color,
  type Piece,
  type Pos,
} from "../board/types";
import type { GameInfo, MoveNode, ParsedGame } from "../xqf/parser";

/** ICCS 坐标（如 "h2"）转棋盘坐标：文件 a-i→x 0-8，行 0-9→y 0-9 */
export function iccsToPos(iccs: string): Pos {
  if (!/^[a-i][0-9]$/.test(iccs)) {
    throw new Error(`无效坐标「${iccs}」`);
  }
  return { x: iccs.charCodeAt(0) - 97, y: iccs.charCodeAt(1) - 48 };
}

export interface AppliedMove {
  notation: string;
  captured: Piece | null;
  /** 走子后的局面 */
  fen: string;
  turnAfter: Color;
}

/** 在盘面上应用一步 ICCS 着法（就地修改 board），供 buildGame 与录制推演共用 */
export function applyIccs(
  board: Board,
  fromIccs: string,
  toIccs: string,
  ply: number,
): AppliedMove {
  const from = iccsToPos(fromIccs);
  const to = iccsToPos(toIccs);
  const piece = board[idx(from.x, from.y)];
  if (!piece || !isPseudoLegalMove(board, from, to)) {
    throw new Error(`第 ${ply} 手着法非法（${fromIccs}${toIccs}）`);
  }
  const notation = chineseNotation(board, from, to);
  const captured = board[idx(to.x, to.y)];
  board[idx(to.x, to.y)] = piece;
  board[idx(from.x, from.y)] = null;
  const turnAfter: Color = pieceColor(piece) === "red" ? "black" : "red";
  return { notation, captured, fen: boardToFen(board, turnAfter), turnAfter };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 将录制得到的着法流构建为与 XQF 解析同构的对局数据（单线主线） */
export function buildGame(
  startFen: string,
  moves: { from: string; to: string }[],
): ParsedGame {
  const { board, turn } = parseFen(startFen);
  const work = board.slice();

  const nodes: MoveNode[] = moves.map((m, i) => {
    const ply = i + 1;
    const applied = applyIccs(work, m.from, m.to, ply);
    return {
      id: i,
      path: new Array<number>(i + 1).fill(0),
      from: iccsToPos(m.from),
      to: iccsToPos(m.to),
      iccs: m.from + m.to,
      notation: applied.notation,
      comment: null,
      fen: applied.fen,
      ply,
      children: [],
    };
  });
  // 单线主线：根层仅首手，后续沿 children[0] 链接（与 XQF 解析结构同构）
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i]!.children = [nodes[i + 1]!];
  }

  const now = new Date();
  const info: GameInfo = {
    title: `录制对局 ${formatDateTime(now)}`,
    event: null,
    date: formatDate(now),
    site: null,
    red: "红方",
    black: "黑方",
    result: "未知",
    type: "其它",
    version: 0,
    comment: null,
  };

  return {
    info,
    startFen,
    startTurn: turn,
    moves: nodes.length > 0 ? [nodes[0]!] : [],
    moveCount: moves.length,
    branchCount: 0,
  };
}
