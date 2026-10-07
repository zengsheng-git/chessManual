# 棋枰棋谱（ChessManual）

中国象棋棋谱整理与复盘桌面应用，基于 Tauri 2 构建。

内置棋谱库收录九千余个经典棋谱文件，支持变例树复盘、分歧对比与注解管理；还可以通过屏幕识别录制对弈软件的着法，导出 PGN 与他人分享。

## 功能特性

### 棋谱库
- 内置棋谱库：首次启动自动释放到用户数据目录（`%APPDATA%\com.chessmanual.app\games`），含 XQF / QP / PGN 三种格式
- 左侧分类浏览 + 文件列表，支持滚动加载与定位
- 打开自定义棋谱文件夹；文件 / 文件夹可重命名；删除时移入系统回收站，误删可恢复
- 一键刷新重新扫描

### 复盘台
- 纯 SVG 绘制棋盘，无图片资源，支持翻转
- 着法树完整保留变例分支，树形展示当前局面的所有走法
- 多种导航方式：按钮、滚轮、快捷键逐手翻看，↑ / ↓ 在兄弟变例间切换
- 分歧选择：走到有多个变招的局面时，右侧信息栏弹出选择框，悬停选项可在棋盘上实时预览落子位置（青色虚线圈 + 半透明棋子），方便对比后再选择
- 步注气泡与注解面板
- 软件检测（仅 Windows）：用内置 Pikafish 引擎逐手对照主线着法，统计首选/等值吻合率、每步损失（ACPL）与波动，并分开局段/中残局段展示，评估对局是否存在软件生成特征（指标仅供参考）
- 日间 / 夜间主题切换

### 录制棋谱（仅 Windows）
- 框选对弈软件的棋盘窗口，定时截屏
- 使用内置 YOLO 模型（ONNX Runtime）识别棋盘上的棋子，自动还原为着法
- 录制完成后可导出 PGN，或直接导入复盘台继续分析

### 导入导出
- PGN 导入 / 导出（中文纵线记法）
- XQF 棋谱格式解析（含注解与变例）

## 技术栈

### 前端
| 技术 | 用途 |
|---|---|
| React 19 | UI 框架 |
| TypeScript 6 | 类型安全 |
| Vite 8 | 构建与开发服务器 |
| Tailwind CSS 4 | 样式（@tailwindcss/vite 插件） |
| Zustand 5 | 状态管理（棋局 / 棋谱库 / 录制） |
| Vitest 5 | 单元测试 |

### 后端（Rust / Tauri 2）
| Crate | 用途 |
|---|---|
| tauri 2 + tauri-plugin-dialog | 桌面应用壳、文件对话框 |
| serde / serde_json | IPC 数据序列化 |
| xcap | 屏幕截图 |
| image + ndarray | 截图图像预处理 |
| ort（ONNX Runtime） | YOLO 棋子识别推理，运行时动态加载 onnxruntime.dll |
| trash | 删除文件时移入系统回收站 |

## 项目结构

```
src/                      # 前端（React + TypeScript）
  components/
    board/                # 棋盘、着法树、注解面板、分歧选择框
    library/              # 分类、文件列表、棋局信息
    record/               # 录棋面板
    common/               # 通用确认对话框
  lib/
    board/                # FEN、中文纵线记法、走子规则
    xqf/                  # XQF 格式解析
    pgn/                  # PGN 解析与生成
    record/               # 录制数据转棋局
    ipc.ts                # Tauri IPC 封装
  stores/                 # Zustand 状态（game / library / recorder）
src-tauri/
  src/
    lib.rs                # 应用入口、棋谱库目录管理
    capture.rs            # 屏幕截图
    detect.rs             # 棋子检测图像处理
    yolo.rs               # ONNX Runtime 推理
    recorder.rs           # 录制会话管理
    engine.rs             # Pikafish UCI 引擎子进程封装
    analysis.rs           # 软件棋检测分析会话
  resources/
    games/                # 内置棋谱库（打包资源）
    libs/                 # onnxruntime.dll 与 YOLO 模型
    libs/pikafish/        # Pikafish 引擎与 NNUE 权重（随仓库分发，约 47MB）
```

## 快速开始

环境要求：Node.js 20+、Rust（Tauri 2 MSRV）、Windows 10/11（录棋与安装包制作仅在 Windows 下验证）。

```bash
npm install          # 安装前端依赖
npm run tauri dev    # 开发模式（首次需编译 Rust，耗时较长）
npm test             # 运行单元测试（Vitest）
npm run tauri build  # 打包，产出 MSI 安装包与 NSIS setup.exe
```

## 快捷键

| 按键 | 功能 |
|---|---|
| ← / → | 上一步 / 下一步 |
| ↑ / ↓ | 切换上一个 / 下一个变例 |
| Home / End | 回到开局 / 跳到终局 |
| F | 翻转棋盘 |
| 滚轮 | 前后翻看着法 |
| 1-9 | 分歧选择框中快速选择走法 |
| Esc | 关闭分歧选择框 |

## 数据目录

- 开发模式：直接读写源码树 `src-tauri/resources/games`，便于调试内置棋谱
- 正式版：`%APPDATA%\com.chessmanual.app\games`，首次启动从安装包内资源播种；用户自录与导入的棋谱也保存在这里，升级重装不会丢失

## Pikafish 引擎资源（软件检测）

软件检测以独立子进程方式运行 Pikafish（GPL-3.0，经 UCI 协议通信），引擎与 NNUE 权重直接随仓库分发（约 47MB），克隆后即可使用：

- `src-tauri/resources/libs/pikafish/pikafish-windows.exe`
- `src-tauri/resources/libs/pikafish/pikafish.nnue`

文件缺失时应用正常启动，仅"软件检测"不可用（点击后提示引擎未初始化）；此时可从 Pikafish 官方 GitHub Releases 下载对应平台的引擎与 NNUE 权重补齐。