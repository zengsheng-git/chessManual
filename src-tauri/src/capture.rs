//! 窗口枚举、截图与裁剪区维护（移植自 chessboard 的 listen.rs）

use serde::{Deserialize, Serialize};
use xcap::image::{GenericImage, ImageBuffer, Rgba};

/// 可选录制窗口信息
#[derive(Serialize, Deserialize, Debug)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub width: u32,
    pub height: u32,
}

impl WindowInfo {
    fn new(win: &xcap::Window) -> Self {
        Self {
            id: win.id().unwrap_or(0),
            title: win.title().unwrap_or_default(),
            app_name: win.app_name().unwrap_or_default(),
            width: win.width().unwrap_or(0),
            height: win.height().unwrap_or(0),
        }
    }
}

/// 枚举当前所有可见窗口（前端列表展示用）
#[tauri::command]
pub async fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let windows = xcap::Window::all().map_err(|e| format!("枚举窗口失败: {e}"))?;
    if windows.is_empty() {
        return Err("未找到可用窗口".to_string());
    }
    Ok(windows.iter().map(WindowInfo::new).collect())
}

/// 按 id 查找窗口
pub fn find_window(window_id: u32) -> Option<xcap::Window> {
    let windows = xcap::Window::all().ok()?;
    windows.into_iter().find(|w| w.id().ok() == Some(window_id))
}

/// 录制目标：窗口句柄 + 裁剪区。定位成功后裁剪区生效，后续只截棋盘区域。
pub struct CaptureWindow {
    window: xcap::Window,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

// xcap::Window 内部持有原始窗口句柄(HWND), 编译器无法证明其可跨线程,
// 但仅在单个后台线程内使用, 与 chessboard 的做法一致
unsafe impl Send for CaptureWindow {}

impl CaptureWindow {
    pub fn new(window: xcap::Window) -> Self {
        Self { window, x: 0, y: 0, w: 0, h: 0 }
    }

    /// 设置裁剪区; w/h 均为 0 表示使用整窗
    pub fn set_bound(&mut self, x: u32, y: u32, w: u32, h: u32) {
        self.x = x;
        self.y = y;
        self.w = w;
        self.h = h;
    }

    /// 截图目标窗口(含裁剪); 窗口已关闭等异常时返回 None
    pub fn capture(&self) -> Option<ImageBuffer<Rgba<u8>, Vec<u8>>> {
        let mut pic = self.window.capture_image().ok()?;
        if self.w > 0 && self.h > 0 {
            Some(pic.sub_image(self.x, self.y, self.w, self.h).to_image())
        } else {
            Some(pic)
        }
    }
}
