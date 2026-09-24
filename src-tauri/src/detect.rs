//! 识别结果到棋盘结构的转换与棋局逻辑（移植自 chessboard 的 common.rs / chess.rs）
//! 坐标约定: row 0 为顶行(黑方底线), col 0 为左列; ICCS 坐标 file='a'+col, rank='0'+row

use crate::yolo::{self, Detection};

/// ICCS 坐标表, BOARD_MAP[row][col], 顶左角为 "a9"
pub const BOARD_MAP: [[&str; 9]; 10] = [
    ["a9", "b9", "c9", "d9", "e9", "f9", "g9", "h9", "i9"],
    ["a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8", "i8"],
    ["a7", "b7", "c7", "d7", "e7", "f7", "g7", "h7", "i7"],
    ["a6", "b6", "c6", "d6", "e6", "f6", "g6", "h6", "i6"],
    ["a5", "b5", "c5", "d5", "e5", "f5", "g5", "h5", "i5"],
    ["a4", "b4", "c4", "d4", "e4", "f4", "g4", "h4", "i4"],
    ["a3", "b3", "c3", "d3", "e3", "f3", "g3", "h3", "i3"],
    ["a2", "b2", "c2", "d2", "e2", "f2", "g2", "h2", "i2"],
    ["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1", "i1"],
    ["a0", "b0", "c0", "d0", "e0", "f0", "g0", "h0", "i0"],
];

/// 局面阵营(以屏幕下方为准): None 表示未能判定
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub enum Camp {
    #[default]
    None,
    Red,
    Black,
}

impl Camp {
    /// 棋子字符大写为红方, 小写为黑方
    pub fn from_piece(p: char) -> Self {
        if p > 'Z' {
            Self::Black
        } else {
            Self::Red
        }
    }
}

/// 一次棋盘变化
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct Changed {
    /// 移动的棋子(取自旧盘面 from 位置)
    pub piece: char,
    pub camp: Camp,
    pub from: String,
    pub to: String,
    /// 被吃的棋子(to 位置旧棋子), 无吃子为 None
    pub captured: Option<char>,
}

#[derive(Debug)]
pub enum BoardChangeState {
    /// 仅检测到一个格子变化(多为走子动画的中间态)
    One,
    /// 正常一步棋
    Move,
    /// 未知的多格变化
    Unknown,
}

/// 对比新旧棋盘, 返回变化描述与变化类型
pub fn board_diff(old_board: [[char; 9]; 10], board: [[char; 9]; 10]) -> (Changed, BoardChangeState) {
    let mut changed = Changed::default();
    let mut count = 0;
    for y in 0..10 {
        for x in 0..9 {
            if old_board[y][x] != board[y][x] {
                count += 1;
                match board[y][x] {
                    ' ' => {
                        changed.piece = old_board[y][x];
                        changed.from = BOARD_MAP[y][x].to_string();
                        changed.camp = Camp::from_piece(changed.piece);
                    }
                    _ => {
                        changed.to = BOARD_MAP[y][x].to_string();
                        changed.captured = if old_board[y][x] != ' ' { Some(old_board[y][x]) } else { None };
                    }
                }
            }
        }
    }

    match count {
        1 => (changed, BoardChangeState::One),
        2 => {
            if changed.from.is_empty() || changed.to.is_empty() {
                (changed, BoardChangeState::One)
            } else {
                (changed, BoardChangeState::Move)
            }
        }
        _ => (changed, BoardChangeState::Unknown),
    }
}

/// 棋盘转 FEN(首行为黑方底线), turn 为行棋方字符('w' 红 / 'b' 黑), 尾段补全为标准六段
pub fn board_fen(turn: char, board: [[char; 9]; 10]) -> String {
    let mut fen = String::new();
    for row in &board {
        let mut empty = 0;
        for &piece in row {
            if piece == ' ' {
                empty += 1;
            } else {
                if empty > 0 {
                    fen.push_str(&empty.to_string());
                    empty = 0;
                }
                fen.push(piece);
            }
        }
        if empty > 0 {
            fen.push_str(&empty.to_string());
        }
        fen.push('/');
    }
    fen.pop();
    fen.push(' ');
    fen.push(turn);
    fen.push_str(" - - 0 1");
    fen
}

/// 校验棋盘合法性(将帅数量与位置、士象兵的位置约束、各类棋子数量上限)
pub fn board_check(board: [[char; 9]; 10]) -> bool {
    let mut bk = 0;
    let mut ba = 0;
    let mut bb = 0;
    let mut bc = 0;
    let mut bp = 0;
    let mut br = 0;
    let mut bn = 0;
    let mut rk = 0;
    let mut ra = 0;
    let mut rb = 0;
    let mut rc = 0;
    let mut rp = 0;
    let mut rr = 0;
    let mut rn = 0;

    for (y, row) in board.iter().enumerate() {
        for (x, &col) in row.iter().enumerate() {
            match col {
                'k' => {
                    bk += 1;
                    if y > 2 || !(3..=5).contains(&x) {
                        return false;
                    }
                }
                'a' => {
                    ba += 1;
                    if !(x == 3 && (y == 0 || y == 2)) && !(x == 4 && y == 1) && !(x == 5 && (y == 0 || y == 2)) {
                        return false;
                    }
                }
                'b' => {
                    bb += 1;
                    if !(y == 0 && (x == 2 || x == 6))
                        && !(y == 2 && (x == 0 || x == 4 || x == 8))
                        && !(y == 4 && (x == 2 || x == 6))
                    {
                        return false;
                    }
                }
                'c' => {
                    bc += 1;
                }
                'p' => {
                    bp += 1;
                    if y < 3 {
                        return false;
                    }
                    if y < 5 && x % 2 == 1 {
                        return false;
                    }
                }
                'r' => {
                    br += 1;
                }
                'n' => {
                    bn += 1;
                }
                'K' => {
                    rk += 1;
                    if y < 7 || !(3..=5).contains(&x) {
                        return false;
                    }
                }
                'A' => {
                    ra += 1;
                    if !(x == 3 && (y == 7 || y == 9)) && !(x == 4 && y == 8) && !(x == 5 && (y == 7 || y == 9)) {
                        return false;
                    }
                }
                'B' => {
                    rb += 1;
                    if !(y == 9 && (x == 2 || x == 6))
                        && !(y == 7 && (x == 0 || x == 4 || x == 8))
                        && !(y == 5 && (x == 2 || x == 6))
                    {
                        return false;
                    }
                }
                'C' => {
                    rc += 1;
                }
                'P' => {
                    rp += 1;
                    if y > 6 {
                        return false;
                    }
                    if y > 4 && x % 2 == 1 {
                        return false;
                    }
                }
                'R' => {
                    rr += 1;
                }
                'N' => {
                    rn += 1;
                }
                _ => {}
            }
        }
    }

    if bk != 1 || rk != 1 {
        return false;
    }
    if ba > 2 || ra > 2 {
        return false;
    }
    if bb > 2 || rb > 2 {
        return false;
    }
    if bc > 2 || rc > 2 {
        return false;
    }
    if br > 2 || rr > 2 {
        return false;
    }
    if bn > 2 || rn > 2 {
        return false;
    }
    if bp > 5 || rp > 5 {
        return false;
    }
    true
}

/// 归一化盘面为红下黑上: 屏幕下方是黑方时整体旋转 180 度
pub fn board_fix(camp: &Camp, board: &mut [[char; 9]; 10]) {
    if Camp::Black.eq(camp) {
        board.reverse();
        for i in board {
            i.reverse();
        }
    }
}

/// 根据整帧识别结果计算棋盘裁剪区(原图坐标), 裁剪框向外扩半格以容纳完整棋子
pub fn detections_bound(
    origin_width: u32,
    origin_height: u32,
    detections: &[Detection],
) -> Result<(u32, u32, u32, u32), String> {
    let board_det = detections.iter().find(|d| d.label == '0').ok_or("未识别到棋盘")?;

    // 模型 640x640 坐标 → 原图坐标
    let scale_x = origin_width as f32 / yolo::IMAGE_WIDTH as f32;
    let scale_y = origin_height as f32 / yolo::IMAGE_HEIGHT as f32;

    let bx0 = (board_det.x0 * scale_x).max(0.0);
    let by0 = (board_det.y0 * scale_y).max(0.0);
    let bx1 = (board_det.x1 * scale_x).min(origin_width as f32);
    let by1 = (board_det.y1 * scale_y).min(origin_height as f32);

    // 半格尺寸
    let board_w = bx1 - bx0;
    let board_h = by1 - by0;
    let half_cell_x = board_w / 9.0 / 2.0;
    let half_cell_y = board_h / 10.0 / 2.0;

    let crop_x = (bx0 - half_cell_x).max(0.0) as u32;
    let crop_y = (by0 - half_cell_y).max(0.0) as u32;

    let x1p = (bx1 + half_cell_x).min(origin_width as f32);
    let y1p = (by1 + half_cell_y).min(origin_height as f32);

    let width = (x1p - crop_x as f32) as u32;
    let height = (y1p - crop_y as f32) as u32;

    Ok((crop_x, crop_y, width, height))
}

const MODEL_CELL_W: f32 = yolo::IMAGE_WIDTH as f32 / 9.0;
const MODEL_CELL_H: f32 = yolo::IMAGE_HEIGHT as f32 / 10.0;

/// 裁剪帧识别结果转棋盘(9 列 x 10 行), 并依据将帅位置判定屏幕下方阵营
pub fn detections_to_board(detections: &[Detection]) -> Result<(Camp, [[char; 9]; 10]), String> {
    let mut camp = Camp::None;
    let mut board = [[' '; 9]; 10];

    if detections.iter().find(|d| d.label == '0').is_none() {
        return Err("未识别到棋盘".to_string());
    }

    for det in detections.iter().filter(|d| d.label != '0') {
        // 棋子框中心点落到 9x10 网格
        let cx = (det.x0 + det.x1) / 2.0;
        let cy = (det.y0 + det.y1) / 2.0;
        let col = (cx / MODEL_CELL_W).floor() as usize; // 0–8
        let row = (cy / MODEL_CELL_H).floor() as usize; // 0–9

        if !(0..=8).contains(&col) || !(0..=9).contains(&row) {
            continue;
        }

        board[row][col] = det.label;

        // 底部区域中央出现将/帅即可判定屏幕下方阵营
        if camp == Camp::None && (3..=5).contains(&col) && row >= 7 {
            match det.label {
                'k' => camp = Camp::Black,
                'K' => camp = Camp::Red,
                _ => {}
            }
        }
    }
    Ok((camp, board))
}
