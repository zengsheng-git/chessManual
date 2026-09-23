import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileEntry {
  name: string;
  path: string;
  ext: string;
  size: number;
}

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function pickFolder(): Promise<string | null> {
  const sel = await open({ directory: true, multiple: false, title: "选择棋谱文件夹" });
  return typeof sel === "string" ? sel : null;
}

export function scanDir(root: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("scan_dir", { root });
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  const arr = await invoke<number[]>("read_file_bytes", { path });
  return new Uint8Array(arr);
}
