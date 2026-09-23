use serde::Serialize;
use std::fs;
use std::path::Path;

const MAX_DEPTH: u32 = 8;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub ext: String,
    pub size: u64,
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<FileEntry>) -> std::io::Result<()> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, depth + 1, out)?;
        } else {
            let is_xqf = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("xqf"))
                .unwrap_or(false);
            if is_xqf {
                let name = entry.file_name().to_string_lossy().to_string();
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                out.push(FileEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    ext: "xqf".to_string(),
                    size,
                });
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn scan_dir(root: String) -> Result<Vec<FileEntry>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("目录不存在：{}", root));
    }
    let mut out = Vec::new();
    walk(root_path, 0, &mut out).map_err(|e| format!("扫描失败：{}", e))?;
    Ok(out)
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("读取失败：{}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_dir, read_file_bytes])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
