import { useMemo } from "react";
import { useLibraryStore } from "../../stores/libraryStore";
import type { FileEntry } from "../../lib/ipc";

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

function buildTree(files: FileEntry[], root: string): DirNode[] {
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

function DirItem({ node, depth }: { node: DirNode; depth: number }) {
  const expanded = useLibraryStore((s) => !!s.expanded[node.path]);
  const selected = useLibraryStore((s) => s.selectedDir === node.path);
  const toggleDir = useLibraryStore((s) => s.toggleDir);
  const selectDir = useLibraryStore((s) => s.selectDir);

  return (
    <div>
      <div
        className={[
          "flex w-full items-center rounded-md pr-1 text-sm transition-colors",
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
      </div>
      {expanded && (
        <div>
          {node.children.map((c) => (
            <DirItem key={c.path} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const root = useLibraryStore((s) => s.root);
  const files = useLibraryStore((s) => s.files);
  const selectedDir = useLibraryStore((s) => s.selectedDir);
  const selectDir = useLibraryStore((s) => s.selectDir);

  const tree = useMemo(() => buildTree(files, root ?? ""), [files, root]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-ink-800 px-3 py-2.5">
        <span className="text-xs font-semibold tracking-widest text-ink-300">分 类</span>
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
          <DirItem key={n.path} node={n} depth={0} />
        ))}
      </div>
    </div>
  );
}
