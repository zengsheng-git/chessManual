import { boardToFen, emptyBoard } from "../board/fen";
import { isPseudoLegalMove } from "../board/rules";
import { chineseNotation, moveIccs } from "../board/notation";
import { pieceColor, type Board, type Color, idx, type Pos } from "../board/types";

export interface MoveNode {
  id: number;
  path: number[];
  from: Pos;
  to: Pos;
  iccs: string;
  notation: string;
  comment: string | null;
  fen: string;
  ply: number;
  children: MoveNode[];
}

export interface GameInfo {
  title: string | null;
  event: string | null;
  date: string | null;
  site: string | null;
  red: string | null;
  black: string | null;
  result: string;
  type: string | null;
  version: number;
  comment: string | null;
}

export interface ParsedGame {
  info: GameInfo;
  startFen: string;
  startTurn: Color;
  moves: MoveNode[];
  moveCount: number;
  branchCount: number;
}

const OFF_VERSION = 2;
const OFF_KEYS = 3;
const LEN_KEYS = 13;
const OFF_BOARD = 16;
const OFF_RES = 51;
const OFF_TYPE = 64;
const TITLE = { len: 80, str: 81, size: 63 };
const EVENT = { len: 208, str: 209, size: 63 };
const DATE = { len: 272, str: 273, size: 15 };
const SITE = { len: 288, str: 289, size: 15 };
const RED = { len: 304, str: 305, size: 15 };
const BLACK = { len: 320, str: 321, size: 15 };

const RESULT_MAP: Record<number, string> = {
  0: "未知",
  1: "红胜",
  2: "黑胜",
  3: "和棋",
  4: "和棋",
};
const TYPE_MAP: Record<number, string> = {
  1: "全局",
  2: "布局",
  3: "残局",
  4: "其它",
};

const GB_DECODER = new TextDecoder("gb18030");

function keyPoly(k: number, mul: number): number {
  return ((((((k * k) * 3 + 9) * 3 + 8) * 2 + 1) * 3 + 8) * mul) & 0xff;
}

interface CryptKeys {
  keyXY: number;
  keyXYf: number;
  keyXYt: number;
  keyRMKSize: number;
  f32Keys: number[];
}

function initDecryptKeys(data: Uint8Array): CryptKeys {
  const keyMask = data[0]!;
  const keyOrA = data[5]!;
  const keyOrB = data[6]!;
  const keyOrC = data[7]!;
  const keyOrD = data[8]!;
  const keysSum = data[9]!;
  const headKeyXY = data[10]!;
  const headKeyXYf = data[11]!;
  const headKeyXYt = data[12]!;

  const keyXY = keyPoly(headKeyXY, headKeyXY);
  const keyXYf = keyPoly(headKeyXYf, keyXY);
  const keyXYt = keyPoly(headKeyXYt, keyXYf);

  const wKey = keysSum * 256 + headKeyXY;
  const keyRMKSize = ((wKey % 32000) + 767) & 0xffff;

  const b1 = (keysSum & keyMask) | keyOrA;
  const b2 = (keyXY & keyMask) | keyOrB;
  const b3 = (keyXYf & keyMask) | keyOrC;
  const b4 = (keyXYt & keyMask) | keyOrD;

  const source = "[(C) Copyright Mr. Dong Shiwei.]";
  const f32Keys: number[] = [];
  const fKeyBytes = [b1, b2, b3, b4];
  for (let i = 0; i < 32; i++) {
    f32Keys.push(source.charCodeAt(i) & fKeyBytes[i % 4]!);
  }

  return { keyXY, keyXYf, keyXYt, keyRMKSize, f32Keys };
}

function initChessBoard(
  manBuff: Uint8Array,
  version: number,
  keys: CryptKeys | null,
): number[] {
  const tmp = new Array<number>(32).fill(0);
  if (!keys) {
    for (let i = 0; i < 32; i++) tmp[i] = manBuff[i]!;
    return tmp;
  }
  for (let i = 0; i < 32; i++) {
    if (version >= 12) {
      tmp[(keys.keyXY + i + 1) & 0x1f] = manBuff[i]!;
    } else {
      tmp[i] = manBuff[i]!;
    }
  }
  for (let i = 0; i < 32; i++) {
    tmp[i] = (tmp[i]! - keys.keyXY) & 0xff;
    if (tmp[i]! > 89) tmp[i] = 0xff;
  }
  return tmp;
}

function decodeBuff(f32Keys: number[], buff: Uint8Array): Uint8Array {
  const out = new Uint8Array(buff.length);
  const nPos = 0x400;
  for (let i = 0; i < buff.length; i++) {
    out[i] = (buff[i]! - f32Keys[(nPos + i) % 32]!) & 0xff;
  }
  return out;
}

class BuffReader {
  private buf: Uint8Array;
  private pos = 0;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  readBytes(n: number): Uint8Array {
    const start = this.pos;
    const stop = Math.min(start + n, this.buf.length);
    this.pos = stop;
    return this.buf.subarray(start, stop);
  }

  readInt(): number {
    const b = this.readBytes(4);
    return (b[0] ?? 0) + ((b[1] ?? 0) << 8) + ((b[2] ?? 0) << 16) + ((b[3] ?? 0) << 24);
  }

  readText(n: number): string | null {
    if (n <= 0) return null;
    const bytes = this.readBytes(n);
    if (bytes.length === 0) return null;
    const raw = GB_DECODER.decode(bytes);
    const nul = raw.indexOf("\0");
    const text = nul >= 0 ? raw.slice(0, nul) : raw;
    return text.trim() || null;
  }
}

const CHESSMAN_KINDS = "RNBAKABNRCCPPPPP";

function readHeaderStr(
  data: Uint8Array,
  field: { len: number; str: number; size: number },
): string | null {
  const len = data[field.len]!;
  if (len <= 0) return null;
  const slice = data.subarray(field.str, field.str + Math.min(len, field.size));
  const raw = GB_DECODER.decode(slice);
  const nul = raw.indexOf("\0");
  const text = nul >= 0 ? raw.slice(0, nul) : raw;
  return text.trim() || null;
}

function buildBoard(data: Uint8Array, version: number, keys: CryptKeys | null): { board: Board; errors: number } {
  const board = emptyBoard();
  const mans = initChessBoard(data.subarray(OFF_BOARD, OFF_BOARD + 32), version, keys);
  let errors = 0;
  for (let side = 0; side < 2; side++) {
    for (let manIndex = 0; manIndex < 16; manIndex++) {
      const manPos = mans[side * 16 + manIndex]!;
      if (manPos === 0xff) continue;
      const x = Math.floor(manPos / 10);
      const y = manPos % 10;
      if (x < 0 || x > 8 || y < 0 || y > 9) {
        errors++;
        continue;
      }
      const kind = CHESSMAN_KINDS[manIndex]!;
      const ch = side === 0 ? kind : String.fromCharCode(kind.charCodeAt(0) + 32);
      board[idx(x, y)] = ch;
    }
  }
  return { board, errors };
}

export function parseXqf(data: Uint8Array, fallbackTitle: string): ParsedGame {
  if (data.length < 0x400) {
    throw new Error("文件太小，不是有效的 XQF 棋谱");
  }
  if (data[0] !== 0x58 || data[1] !== 0x51) {
    throw new Error("文件头不正确（需要 XQ 格式）");
  }

  const version = data[OFF_VERSION]!;
  const keys = version > 10 ? initDecryptKeys(data.subarray(OFF_KEYS, OFF_KEYS + LEN_KEYS)) : null;

  const resByte = data[OFF_RES]!;
  const typeByte = data[OFF_TYPE]! + 1;

  const info: GameInfo = {
    title: readHeaderStr(data, TITLE) ?? fallbackTitle,
    event: readHeaderStr(data, EVENT),
    date: readHeaderStr(data, DATE),
    site: readHeaderStr(data, SITE),
    red: readHeaderStr(data, RED),
    black: readHeaderStr(data, BLACK),
    result: RESULT_MAP[resByte] ?? "未知",
    type: TYPE_MAP[typeByte] ?? "其它",
    version,
    comment: null,
  };

  const { board } = buildBoard(data, version, keys);
  const startFen = boardToFen(board, "red");

  let body = data.subarray(0x400);
  if (keys) {
    body = decodeBuff(keys.f32Keys, body);
  }
  const reader = new BuffReader(body);

  let gameComment: string | null = null;
  {
    const si = reader.readBytes(4);
    let annoteLen = 0;
    if (si.length >= 4) {
      if (version <= 10) {
        annoteLen = reader.readInt();
      } else {
        if (si[2]! & 0x20) {
          annoteLen = reader.readInt() - keys!.keyRMKSize;
        }
      }
      if (annoteLen > 0) gameComment = reader.readText(annoteLen);
    }
  }
  info.comment = gameComment;

  const moves: MoveNode[] = [];
  let nodeCount = 0;
  let branchCount = 0;
  let firstMoveColor: Color | null = null;

  const readSteps = (target: MoveNode[], board: Board, parentPath: number[]): void => {
    const si = reader.readBytes(4);
    if (si.length < 4) return;

    let hasNext = false;
    let hasVar = false;
    let annoteLen = 0;

    if (version <= 10) {
      hasNext = (si[2]! & 0xf0) !== 0;
      hasVar = (si[2]! & 0x0f) !== 0;
      annoteLen = reader.readInt();
    } else {
      const flags = si[2]! & 0xe0;
      hasNext = (flags & 0x80) !== 0;
      hasVar = (flags & 0x40) !== 0;
      if (flags & 0x20) annoteLen = reader.readInt() - keys!.keyRMKSize;
    }

    const offF = version > 10 ? keys!.keyXYf : 0;
    const offT = version > 10 ? keys!.keyXYt : 0;
    const fromRaw = (si[0]! - 0x18 - offF) & 0xff;
    const toRaw = (si[1]! - 0x20 - offT) & 0xff;
    const from: Pos = { x: Math.floor(fromRaw / 10), y: fromRaw % 10 };
    const to: Pos = { x: Math.floor(toRaw / 10), y: toRaw % 10 };

    const annote = annoteLen > 0 ? reader.readText(annoteLen) : null;

    const boardBak = hasVar ? board.slice() : null;

    const piece =
      from.x >= 0 && from.x < 9 && from.y >= 0 && from.y < 10 && to.x >= 0 && to.x < 9 && to.y >= 0 && to.y < 10
        ? board[idx(from.x, from.y)]
        : null;

    let goodTarget = target;
    let boardForNext = board;
    let pathForNext = parentPath;

    if (piece && isPseudoLegalMove(board, from, to)) {
      const notation = chineseNotation(board, from, to);
      board[idx(to.x, to.y)] = piece;
      board[idx(from.x, from.y)] = null;
      const turnAfter: Color = pieceColor(piece) === "red" ? "black" : "red";
      const node: MoveNode = {
        id: nodeCount++,
        path: [],
        from,
        to,
        iccs: moveIccs(from, to),
        notation,
        comment: annote,
        fen: boardToFen(board, turnAfter),
        ply: parentPath.length + 1,
        children: [],
      };
      target.push(node);
      node.path = [...parentPath, target.length - 1];
      if (parentPath.length === 0 && firstMoveColor === null) {
        firstMoveColor = pieceColor(piece);
      }
      goodTarget = node.children;
      pathForNext = node.path;
    }

    if (hasNext) {
      readSteps(goodTarget, boardForNext, pathForNext);
    }
    if (hasVar) {
      branchCount++;
      readSteps(target, boardBak!, parentPath);
    }
  };

  readSteps(moves, board, []);

  const startTurn: Color =
    firstMoveColor === null ? "red" : firstMoveColor === "red" ? "black" : "red";

  return {
    info,
    startFen,
    startTurn,
    moves,
    moveCount: nodeCount,
    branchCount,
  };
}
