mod capture;
mod detect;
mod recorder;
mod yolo;

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

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
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase());
            let ext = match ext.as_deref() {
                Some(e) if e == "xqf" || e == "pgn" => e,
                _ => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(FileEntry {
                name,
                path: path.to_string_lossy().to_string(),
                ext: ext.to_string(),
                size,
            });
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

/// 计算棋谱库根目录: 调试构建指向源码目录(避免写入 target 构建副本);
/// 打包版指向用户数据目录(可写且卸载升级不丢), 首次启动时把内置棋谱复制过去作为初始内容
fn library_dir_impl(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("games"));
    }
    let user_games = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("解析用户数据目录失败：{}", e))?
        .join("games");
    if !user_games.is_dir() {
        // 首次使用(目录不存在): 用安装目录内的内置棋谱做种子拷贝
        let builtin = app
            .path()
            .resolve("resources/games", tauri::path::BaseDirectory::Resource)
            .map_err(|e| format!("解析内置棋谱目录失败：{}", e))?;
        if builtin.is_dir() {
            copy_dir_recursive(&builtin, &user_games)
                .map_err(|e| format!("初始化棋谱库失败：{}", e))?;
        } else {
            fs::create_dir_all(&user_games)
                .map_err(|e| format!("创建棋谱库目录失败：{}", e))?;
        }
    }
    Ok(user_games)
}

/// 递归复制目录内容(src 下所有条目复制到 dst, 单个文件失败不中断)
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)?.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            let _ = fs::copy(&from, &to);
        }
    }
    Ok(())
}

/// 校验路径位于棋谱库根目录之下, 防止操作库外的任意文件
fn ensure_in_library(app: &AppHandle, path: &Path) -> Result<(), String> {
    let root = library_dir_impl(app)?;
    // 两边都 canonicalize 以消除 Windows 的 \\?\ 前缀差异和 .. 等相对片段
    let target = path.canonicalize().map_err(|e| format!("路径无效：{}", e))?;
    let root = root
        .canonicalize()
        .unwrap_or(root);
    if !target.starts_with(&root) {
        return Err("不允许操作棋谱库之外的文件".to_string());
    }
    Ok(())
}

/// 在资源管理器中打开文件所在文件夹并选中该文件
#[tauri::command]
fn reveal_in_explorer(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("文件不存在：{}", path));
    }
    ensure_in_library(&app, &p)?;
    Command::new("explorer")
        .arg(format!("/select,{}", p.display()))
        .spawn()
        .map_err(|e| format!("打开文件夹失败：{}", e))?;
    Ok(())
}

/// 删除棋谱文件(移入系统回收站), 仅允许删除棋谱库内的 xqf/pgn 文件
#[tauri::command]
fn delete_game_file(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("文件不存在：{}", path));
    }
    ensure_in_library(&app, &p)?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("xqf") | Some("pgn") => {}
        _ => return Err("只允许删除棋谱文件（xqf/pgn）".to_string()),
    }
    trash::delete(&p).map_err(|e| format!("删除失败：{}", e))
}

/// 返回棋谱库根目录, 目录不存在时自动创建
#[tauri::command]
fn library_dir(app: AppHandle) -> Result<String, String> {
    let dir = library_dir_impl(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建棋谱库目录失败：{}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

/// 弹出系统另存为对话框保存 PGN 文本, 初始目录可定位到棋谱库, 返回实际写入路径
#[tauri::command]
async fn save_pgn(
    app: AppHandle,
    file_name: String,
    content: String,
    initial_dir: Option<String>,
) -> Result<String, String> {
    // 原生文件对话框会阻塞当前线程, 挪到阻塞线程池避免卡住异步运行时
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .add_filter("PGN 棋谱", &["pgn"])
            .set_file_name(&file_name);
        // 初始目录无效时回退到棋谱库根目录, 并确保目录存在, 保证对话框总能定位
        let dir = initial_dir
            .map(PathBuf::from)
            .filter(|d| d.is_dir())
            .or_else(|| library_dir_impl(&app).ok())
            .filter(|d| d.is_dir());
        if let Some(dir) = dir {
            let _ = fs::create_dir_all(&dir);
            dialog = dialog.set_directory(&dir);
        }
        let path = dialog
            .blocking_save_file()
            .ok_or_else(|| "已取消保存".to_string())?;
        let path = path
            .simplified()
            .into_path()
            .map_err(|e| format!("保存路径无效：{}", e))?;
        fs::write(&path, content.as_bytes()).map_err(|e| format!("写入失败：{}", e))?;
        Ok(path.to_string_lossy().to_string())
    })
        .await
        .map_err(|e| format!("保存任务执行失败：{}", e))?
}

/// 删除棋谱文件夹(整个目录移入系统回收站), 仅允许删除棋谱库内的子目录
#[tauri::command]
fn delete_game_dir(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("文件夹不存在：{}", path));
    }
    let root = library_dir_impl(&app)?;
    let root = root.canonicalize().unwrap_or(root);
    let target = p.canonicalize().map_err(|e| format!("路径无效：{}", e))?;
    if target == root {
        return Err("不能删除棋谱库根目录".to_string());
    }
    if !target.starts_with(&root) {
        return Err("不允许操作棋谱库之外的文件夹".to_string());
    }
    trash::delete(&target).map_err(|e| format!("删除失败：{}", e))
}

/// 递归收集所有子目录(含空目录), 供侧栏目录树展示
fn walk_dirs(dir: &Path, depth: u32, out: &mut Vec<String>) -> std::io::Result<()> {
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
            out.push(path.to_string_lossy().to_string());
            walk_dirs(&path, depth + 1, out)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn scan_dirs(root: String) -> Result<Vec<String>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("目录不存在：{}", root));
    }
    let mut out = Vec::new();
    walk_dirs(root_path, 0, &mut out).map_err(|e| format!("扫描失败：{}", e))?;
    Ok(out)
}

/// 在棋谱库内新建文件夹, 返回新文件夹完整路径
#[tauri::command]
fn create_folder(
    app: AppHandle,
    parent_path: String,
    folder_name: String,
) -> Result<String, String> {
    let name = folder_name.trim();
    if name.is_empty() {
        return Err("文件夹名称不能为空".to_string());
    }
    if name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("文件夹名称不能包含 \\ / : * ? \" < > | 等字符".to_string());
    }
    let parent = PathBuf::from(&parent_path);
    if !parent.is_dir() {
        return Err(format!("目标文件夹不存在：{}", parent_path));
    }
    let root = library_dir_impl(&app)?;
    let root = root.canonicalize().unwrap_or(root);
    let parent = parent.canonicalize().map_err(|e| format!("路径无效：{}", e))?;
    if !parent.starts_with(&root) {
        return Err("不允许在棋谱库之外新建文件夹".to_string());
    }
    let target = parent.join(name);
    if target.symlink_metadata().is_ok() {
        return Err(format!("同名文件或文件夹已存在：{}", name));
    }
    fs::create_dir(&target).map_err(|e| format!("创建文件夹失败：{}", e))?;
    let created = target.to_string_lossy().to_string();
    Ok(match created.strip_prefix(r"\\?\") {
        Some(s) => s.to_string(),
        None => created,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 棋子检测模型与 onnxruntime 均按资源路径运行时加载, 仅 Windows 启用
            #[cfg(target_os = "windows")]
            {
                use tauri::path::BaseDirectory;
                use tauri::Manager;
                let dll = app.path().resolve("resources/libs/onnxruntime.dll", BaseDirectory::Resource);
                let model = app.path().resolve("resources/libs/large.onnx", BaseDirectory::Resource);
                match (dll, model) {
                    (Ok(dll), Ok(model)) => {
                        // 初始化失败不阻断启动, 后续录制命令会以"模型未初始化"报错提示
                        if let Err(e) = yolo::init(&dll, &model) {
                            eprintln!("[chessManual] 模型初始化失败：{e}");
                        }
                    }
                    (Err(e), _) | (_, Err(e)) => eprintln!("[chessManual] 资源路径解析失败：{e}"),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_dir,
            read_file_bytes,
            reveal_in_explorer,
            delete_game_file,
            delete_game_dir,
            scan_dirs,
            create_folder,
            capture::list_windows,
            recorder::start_recording,
            recorder::stop_recording,
            save_pgn,
            library_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
