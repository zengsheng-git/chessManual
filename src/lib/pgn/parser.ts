import { START_FEN } from "../board/fen";
import { buildGame } from "../record/toGame";
import type { GameInfo, ParsedGame } from "../xqf/parser";

/** ICCS 着法 token（4 字符，如 "h2e2"） */
const MOVE_RE = /[a-i][0-9][a-i][0-9]/g;

/** PGN Result 标签 → GameInfo.result */
function tagResult(result: string | undefined): string {
  switch (result) {
    case "1-0":
      return "红胜";
    case "0-1":
      return "黑胜";
    case "1/2-1/2":
      return "和棋";
    default:
      return "未知";
  }
}

/** PGN Date 标签（yyyy.mm.dd）→ GameInfo.date（yyyy-mm-dd），无法识别返回 null */
function tagDate(date: string | undefined): string | null {
  const m = date?.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  return m ? `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` : null;
}

/** 拆分标签区与 movetext 正文，标签键统一大写 */
function splitTags(text: string): { tags: Record<string, string>; body: string } {
  const tags: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i]!.match(/^\[\s*(\w+)\s+"(.*)"\s*\]\s*$/);
    if (!m) break;
    tags[m[1]!.toUpperCase()] = m[2]!;
  }
  return { tags, body: lines.slice(i).join("\n") };
}

/** 去掉花括号/分号注释、NAG 与变招括号（递归剥层），只留主线着法 */
function stripAnnotations(body: string): string {
  let s = body.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ").replace(/\$\d+/g, " ");
  while (s.includes("(")) {
    s = s.replace(/\([^()]*\)/g, " ");
  }
  return s;
}

/** 解析 PGN 文本（ICCS 主线着法，即本应用导出的格式）为对局数据 */
export function parsePgn(content: string, fallbackTitle: string): ParsedGame {
  const { tags, body } = splitTags(content);
  const tokens = stripAnnotations(body).match(MOVE_RE) ?? [];
  if (tokens.length === 0) {
    throw new Error("PGN 中没有找到着法");
  }
  const moves = tokens.map((t) => ({ from: t.slice(0, 2), to: t.slice(2, 4) }));
  const game = buildGame(tags.FEN ?? START_FEN, moves);
  const info: GameInfo = {
    ...game.info,
    title: fallbackTitle.replace(/\.[^.]+$/, ""),
    event: tags.EVENT ?? null,
    date: tagDate(tags.DATE) ?? game.info.date,
    site: tags.SITE ?? null,
    red: tags.WHITE ?? game.info.red,
    black: tags.BLACK ?? game.info.black,
    result: tagResult(tags.RESULT),
  };
  return { ...game, info };
}
