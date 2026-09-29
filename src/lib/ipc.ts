import { invoke } from "@tauri-apps/api/core";

export interface FileEntry {
  name: string;
  path: string;
  ext: string;
  size: number;
}

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function scanDir(root: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("scan_dir", { root });
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  const arr = await invoke<number[]>("read_file_bytes", { path });
  return new Uint8Array(arr);
}

export function revealInExplorer(path: string): Promise<void> {
  return invoke("reveal_in_explorer", { path });
}

export function deleteGameFile(path: string): Promise<void> {
  return invoke("delete_game_file", { path });
}

export function deleteGameDir(path: string): Promise<void> {
  return invoke("delete_game_dir", { path });
}

export function scanDirs(root: string): Promise<string[]> {
  return invoke<string[]>("scan_dirs", { root });
}

export function createFolder(parentPath: string, folderName: string): Promise<string> {
  return invoke<string>("create_folder", { parentPath, folderName });
}
