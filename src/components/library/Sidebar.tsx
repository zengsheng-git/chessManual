import { useMemo, useState } from "react";
import { useLibraryStore } from "../../stores/libraryStore";
import { useGameStore } from "../../stores/gameStore";
import { deleteGameDir, type FileEntry } from "../../lib/ipc";
import ConfirmDialog from "../common/ConfirmDialog";
import InputDialog from "../common/InputDialog";

interface DirNode {
  name: string;
  path: string;
  children: DirNode[];
  count: number;
}

function relPath(file: string, root: string): string {
  const normFile = file.replace(/\\/g, "/");
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  return normFile.startsWith(normRoot) ? normFile.slice(normRoot.length) : normFile;
}

function buildTree(files: FileEntry[], dirs: string[], root: string): DirNode[] {
  const top = new Map<string, DirNode>();
  const getOrCreate = (map: Map<string, DirNode>, name: string, path: string): DirNode => {
    let n = map.get(path);
    if (!n) {
      n = { name, path, children: [], count: 0 };
      map.set(path, n);
    }
    return n;
  };
  const childMaps = new Map<string, Map<string, DirNode>>();

  // 先按目录列表建节点, 保证空文件夹也出现在树中
  for (const d of dirs) {
    const segs = relPath(d, root).split("/").filter(Boolean);
    if (segs.length === 0) continue;
    let map = top;
    let acc = "";
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      const fullDir = `${root.replace(/[\\/]+$/, "")}\\${acc.replace(/\//g, "\\")}`;
      getOrCreate(map, seg, fullDir);
      if (!childMaps.has(fullDir)) childMaps.set(fullDir, new Map());
      map = childMaps.get(fullDir)!;
    }
  }

  for (const f of files) {
    const segs = relPath(f.path, root).split("/").slice(0, -1);
    let map = top;
    let acc = "";
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      const fullDir = `${root.replace(/[\\/]+$/, "")}\\${acc.replace(/\//g, "\\")}`;
      const node = getOrCreate(map, seg, fullDir);
      if (!childMaps.has(fullDir)) childMaps.set(fullDir, new Map());
      node.count++;
      map = childMaps.get(fullDir)!;
    }
  }

  const attach = (nodes: DirNode[]): DirNode[] => {
    for (const n of nodes) {
      const m = childMaps.get(n.path);
      n.children = m ? attach(Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) : [];
    }
    return nodes;
  };
  return attach(Array.from(top.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
}

function DirItem({ node, depth, onDelete }: { node: DirNode; depth: number; onDelete: (node: DirNode) => void }) {
  const expanded = useLibraryStore((s) => !!s.expanded[node.path]);
  const selected = useLibraryStore((s) => s.selectedDir === node.path);
  const toggleDir = useLibraryStore((s) => s.toggleDir);
  const selectDir = useLibraryStore((s) => s.selectDir);

  return (
    <div>
      <div
        className={[
          "group flex w-full items-center rounded-md pr-1 text-sm transition-colors",
          selected ? "bg-gold-400/15" : "hover:bg-ink-800/70",
        ].join(" ")}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <button
          onClick={() => toggleDir(node.path)}
          aria-label={expanded ? `收起 ${node.name}` : `展开 ${node.name}`}
          className="flex h-7 w-6 shrink-0 items-center justify-center text-ink-400 transition-transform hover:text-gold-300"
          style={{ transform: expanded ? "rotate(90deg)" : "none" }}
        >
          <span className="text-[10px]">▶</span>
        </button>
        <button
          onClick={() => selectDir(node.path)}
          className={[
            "flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 text-left",
            selected ? "text-gold-300" : "text-ink-200",
          ].join(" ")}
        >
          <span className="truncate">{node.name}</span>
          <span className="ml-auto shrink-0 rounded-full bg-ink-700/80 px-1.5 py-0.5 text-[10px] text-ink-300">
            {node.count}
          </span>
        </button>
        <button
          onClick={() => onDelete(node)}
          title="删除文件夹（移入回收站）"
          aria-label={`删除文件夹 ${node.name}`}
          className="ml-0.5 shrink-0 rounded p-1 text-xs leading-none text-ink-400 opacity-0 transition-opacity hover:bg-verm-500/25 hover:text-verm-400 focus-visible:opacity-100 group-hover:opacity-100"
        >
          🗑
        </button>
      </div>
      {expanded && (
        <div>
          {node.children.map((c) => (
            <DirItem key={c.path} node={c} depth={depth + 1} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const root = useLibraryStore((s) => s.root);
  const files = useLibraryStore((s) => s.files);
  const dirs = useLibraryStore((s) => s.dirs);
  const selectedDir = useLibraryStore((s) => s.selectedDir);
  const selectDir = useLibraryStore((s) => s.selectDir);
  const createFolder = useLibraryStore((s) => s.createFolder);

  const [confirmTarget, setConfirmTarget] = useState<DirNode | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const tree = useMemo(() => buildTree(files, dirs, root ?? ""), [files, dirs, root]);

  const confirmRemoveDir = async () => {
    if (!confirmTarget) return;
    const { path } = confirmTarget;
    setConfirmTarget(null);
    try {
      await deleteGameDir(path);
      const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
      const lib = useLibraryStore.getState();
      const sel = lib.selectedDir.replace(/\\/g, "/");
      if (sel === norm || sel.startsWith(norm + "/")) lib.selectDir("");
      const openPath = useGameStore.getState().filePath;
      if (openPath && openPath.replace(/\\/g, "/").startsWith(norm + "/")) {
        useGameStore.getState().closeGame();
      }
      await lib.rescan();
    } catch (e) {
      alert(`删除失败：${e}`);
    }
  };

  const confirmCreateRoot = async (name: string) => {
    setCreateOpen(false);
    try {
      await createFolder(name, root ?? undefined);
    } catch (e) {
      alert(`新建文件夹失败：${e}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-ink-800 py-2.5 pl-3 pr-2">
        <span className="text-xs font-semibold tracking-widest text-ink-300">分 类</span>
        <button
          onClick={() => setCreateOpen(true)}
          disabled={!root}
          title="在棋谱库根目录新建分类文件夹"
          aria-label="新建根目录文件夹"
          className="rounded p-0.5 text-xs leading-none text-ink-300 transition-colors hover:bg-ink-700 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ＋
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        <button
          onClick={() => selectDir("")}
          className={[
            "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
            selectedDir === ""
              ? "bg-gold-400/15 text-gold-300"
              : "text-ink-200 hover:bg-ink-800/70",
          ].join(" ")}
        >
          <span className="text-xs">📚</span>
          <span>全部棋谱</span>
          <span className="ml-auto rounded-full bg-ink-700/80 px-1.5 py-0.5 text-[10px] text-ink-300">
            {files.length}
          </span>
        </button>
        {tree.map((n) => (
          <DirItem key={n.path} node={n} depth={0} onDelete={setConfirmTarget} />
        ))}
      </div>
      {confirmTarget && (
        <ConfirmDialog
          title="删除确认"
          message={
            <span title={confirmTarget.path}>
              确定删除文件夹「{confirmTarget.name}」（含 {confirmTarget.count} 盘棋谱）吗？
            </span>
          }
          hint="文件夹将连同其中棋谱一并移入系统回收站，误删可恢复。"
          confirmText="删除"
          onConfirm={() => void confirmRemoveDir()}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
      {createOpen && (
        <InputDialog
          title="新建文件夹"
          message="将在棋谱库根目录创建顶级分类。"
          placeholder="请输入文件夹名称"
          confirmText="创建"
          hint={'名称不能包含 \\ / : * ? " < > | 等字符。'}
          onConfirm={(v) => void confirmCreateRoot(v)}
          onCancel={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}
