import { START_FEN } from "../board/fen";
import type { MoveNode, ParsedGame } from "../xqf/parser";

/** GameInfo.result → PGN Result 标签 */
function resultTag(result: string): string {
  switch (result) {
    case "红胜":
      return "1-0";
    case "黑胜":
      return "0-1";
    case "和棋":
      return "1/2-1/2";
    default:
      return "*";
  }
}

function todayDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function pgnDate(date: string | null): string {
  return (date ?? todayDate()).replaceAll("-", ".");
}

/** 沿主线（每层第一个孩子）收集先序着法序列 */
function mainLine(nodes: MoveNode[]): MoveNode[] {
  const line: MoveNode[] = [];
  let cur: MoveNode | undefined = nodes.length > 0 ? nodes[0] : undefined;
  while (cur) {
    line.push(cur);
    cur = cur.children.length > 0 ? cur.children[0] : undefined;
  }
  return line;
}

/** ICCS 着法序列转 movetext，红黑各一步为一轮，起始手数由 startTurn 决定 */
function movetext(game: ParsedGame): string {
  const parts: string[] = [];
  let turn = game.startTurn;
  let round = 1;
  let roundOpen = false; // 本轮是否已输出红方着法
  for (const m of mainLine(game.moves)) {
    if (turn === "red") {
      parts.push(`${round}. ${m.iccs}`);
      roundOpen = true;
      turn = "black";
    } else {
      parts.push(roundOpen ? m.iccs : `${round}... ${m.iccs}`);
      round += 1;
      roundOpen = false;
      turn = "red";
    }
  }
  parts.push("*");
  return parts.join(" ");
}

/** 导出 PGN 文本（纯函数）；提供非标准 startFen 时附加 SetUp/FEN 标签 */
export function toPgn(game: ParsedGame, startFen?: string): string {
  const lines = [
    `[Event "棋枰棋谱录制"]`,
    `[Site "本地"]`,
    `[Date "${pgnDate(game.info.date)}"]`,
    `[Round "-"]`,
    `[White "${game.info.red ?? "红方"}"]`,
    `[Black "${game.info.black ?? "黑方"}"]`,
    `[Result "${resultTag(game.info.result)}"]`,
  ];
  if (startFen !== undefined && startFen !== START_FEN) {
    lines.push(`[SetUp "1"]`, `[FEN "${startFen}"]`);
  }
  return `${lines.join("\n")}\n\n${movetext(game)}\n`;
}
