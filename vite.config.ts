import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Windows 下 cargo 编译会锁 target 里的 exe, Vite 监视到会报 EBUSY 崩溃;
    // Rust 代码由 tauri CLI 自行监视重建, 前端模块全在 src/ 下, 无需监视 src-tauri
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2022",
  },
});
