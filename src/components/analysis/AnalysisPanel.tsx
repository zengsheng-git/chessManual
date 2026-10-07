import { useEffect, useMemo, useRef, useState } from "react";
import { collectMainlinePlies } from "../../lib/analysis/plies";
import {
  clampField,
  DEFAULT_BANDS,
  loadBands,
  saveBands,
  type Band,
  type BandPair,
} from "../../lib/analysis/bands";
import {
  initAnalysisListeners,
  useAnalysisStore,
  type PhaseStats,
  type PlyReport,
} from "../../stores/analysisStore";
import { useGameStore } from "../../stores/gameStore";

const BTN =
  "rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-gold-500/60 hover:bg-ink-700 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-ink-600 disabled:hover:bg-ink-800 disabled:hover:text-ink-200";

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function pctI(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function kindLabel(kind: PlyReport["kind"]): string {
  return kind === "t1" ? "首选" : kind === "ev" ? "等值" : "偏离";
}

function kindCls(kind: PlyReport["kind"]): string {
  return kind === "t1"
    ? "bg-gold-400/15 text-gold-300"
    : kind === "ev"
      ? "bg-ink-700 text-ink-300"
      : "bg-verm-500/15 text-verm-400";
}

// 分档阈值可由用户调整（默认值与 localStorage 持久化见 lib/analysis/bands.ts;
// 同档内条件须同时满足, 两条路径任一命中即升级）:
// 路径一(纯软件特征): 等值吻合率 / 平均损失(厘) / 损失波动(标准差,厘) —— 又准又稳;
//   波动是必要条件, 人类即使吻合率冲高也会有失误尖峰把波动抬起来
// 路径二(人机混用特征): 关键手(唯一明显好棋局面)几乎从不失手 —— 整体起伏大也不漏判

/** 阈值输入框: 本地文本态, 失焦/回车提交并收敛到合法范围, 非法输入还原 */
function BandInput({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v)) {
      onCommit(Math.min(max, Math.max(min, v)));
    } else {
      setText(String(value));
    }
  };
  return (
    <input
      value={text}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-12 rounded border border-ink-600 bg-ink-900 px-1 py-0.5 text-center text-[10px] text-ink-100 focus:border-gold-500/60 focus:outline-none"
    />
  );
}

/** 判定条件说明 + 可展开的阈值编辑区（改动立即按新标准重新分档并持久化） */
function VerdictRules({
  bands,
  onChange,
  onReset,
}: {
  bands: BandPair;
  onChange: (next: BandPair) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const setField = (side: "strong" | "weak", field: keyof Band, value: number) =>
    onChange({ ...bands, [side]: { ...bands[side], [field]: value } });

  return (
    <div className="mb-2 rounded-md border border-ink-700 bg-ink-800/60 px-2.5 py-2 text-[10px] leading-relaxed text-ink-400">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-ink-300">判定依据（同档各条件须同时满足，两条路径任一命中即达档；仅供参考）</div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="shrink-0 rounded border border-ink-600 px-1.5 py-0.5 text-[10px] text-ink-300 transition-colors hover:border-gold-500/60 hover:text-gold-300"
        >
          {editing ? "收起" : "调整标准"}
        </button>
      </div>
      <div className="mt-1 text-verm-400">软件特征明显</div>
      <div>
        ① 等值吻合率 ≥{pctI(bands.strong.ev)} 且 平均损失 ≤{bands.strong.acpl} 厘 且 损失波动 ≤{bands.strong.stddev}
        （又准又稳）
      </div>
      <div>
        ② 关键手 ≥{bands.strong.criticals} 手且命中率 ≥{pctI(bands.strong.criticalRate)}（唯一好棋局面从不失手，人机混用特征）
      </div>
      <div className="mt-1 text-orange-300">有一定软件特征</div>
      <div>
        ① 等值吻合率 ≥{pctI(bands.weak.ev)} 且 平均损失 ≤{bands.weak.acpl} 厘 且 损失波动 ≤{bands.weak.stddev}
      </div>
      <div>② 关键手 ≥{bands.weak.criticals} 手且命中率 ≥{pctI(bands.weak.criticalRate)}</div>
      <div className="mt-1">均未达到 → 未见明显特征。单局结论仅供参考，建议对同一对手多局对比。</div>

      {editing && (
        <div className="mt-2 space-y-1.5 border-t border-ink-700 pt-2">
          <table className="w-full">
            <thead>
              <tr className="text-ink-400">
                <th className="pr-1 text-left font-normal">档位</th>
                <th className="px-0.5 font-normal">等值吻合≥%</th>
                <th className="px-0.5 font-normal">损失≤厘</th>
                <th className="px-0.5 font-normal">波动≤厘</th>
                <th className="px-0.5 font-normal">关键手≥</th>
                <th className="px-0.5 font-normal">命中≥%</th>
              </tr>
            </thead>
            <tbody>
              {(["strong", "weak"] as const).map((side) => {
                const b = bands[side];
                return (
                  <tr key={side}>
                    <td className={`pr-1 ${side === "strong" ? "text-verm-400" : "text-orange-300"}`}>
                      {side === "strong" ? "明显" : "可疑"}
                    </td>
                    <td className="px-0.5 py-0.5">
                      <BandInput
                        value={Math.round(b.ev * 100)}
                        min={0}
                        max={100}
                        onCommit={(v) => setField(side, "ev", clampField("ev", v / 100))}
                      />
                    </td>
                    <td className="px-0.5 py-0.5">
                      <BandInput
                        value={b.acpl}
                        min={1}
                        max={10_000}
                        onCommit={(v) => setField(side, "acpl", clampField("acpl", v))}
                      />
                    </td>
                    <td className="px-0.5 py-0.5">
                      <BandInput
                        value={b.stddev}
                        min={0}
                        max={10_000}
                        onCommit={(v) => setField(side, "stddev", clampField("stddev", v))}
                      />
                    </td>
                    <td className="px-0.5 py-0.5">
                      <BandInput
                        value={b.criticals}
                        min={0}
                        max={9_999}
                        onCommit={(v) => setField(side, "criticals", clampField("criticals", Math.round(v)))}
                      />
                    </td>
                    <td className="px-0.5 py-0.5">
                      <BandInput
                        value={Math.round(b.criticalRate * 100)}
                        min={0}
                        max={100}
                        onCommit={(v) => setField(side, "criticalRate", clampField("criticalRate", v / 100))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-2">
            <span>改完立即重新分档（无需重跑引擎），保存在本机。</span>
            <button
              onClick={onReset}
              className="shrink-0 rounded border border-ink-600 px-1.5 py-0.5 text-ink-300 transition-colors hover:border-gold-500/60 hover:text-gold-300"
            >
              恢复默认
            </button>
          </div>
        </div>
      )}

      <div className="mt-1">
        卡片数值颜色：<span className="text-verm-400">红</span> = 达到"明显"档阈值，<span className="text-orange-300">橙</span> = 达到"可疑"档阈值；单项达标不代表结论，仍按上述组合判定。
      </div>
    </div>
  );
}

/** 分侧指标的分档（仅供参考，不能单独作为结论） */
function statsVerdict(stats: PhaseStats, bands: BandPair): { label: string; cls: string } {
  if (stats.plies === 0) return { label: "—", cls: "text-ink-400" };
  const criticalRate = stats.criticals > 0 ? stats.critical_hits / stats.criticals : 0;
  const pureEngine =
    stats.ev_rate >= bands.strong.ev && stats.acpl <= bands.strong.acpl && stats.stddev <= bands.strong.stddev;
  const criticalPerfect = stats.criticals >= bands.strong.criticals && criticalRate >= bands.strong.criticalRate;
  if (pureEngine || criticalPerfect) {
    return { label: "软件特征明显", cls: "text-verm-400" };
  }
  const somewhatEngine =
    stats.ev_rate >= bands.weak.ev && stats.acpl <= bands.weak.acpl && stats.stddev <= bands.weak.stddev;
  const criticalMostly = stats.criticals >= bands.weak.criticals && criticalRate >= bands.weak.criticalRate;
  if (somewhatEngine || criticalMostly) {
    return { label: "有一定软件特征", cls: "text-orange-300" };
  }
  return { label: "未见明显特征", cls: "text-ink-300" };
}

/** 单项指标行: 数值颜色标示异常程度(红=明显档阈值, 金=可疑档阈值, 白=正常) */
function StatRow({
  label,
  value,
  cls = "text-ink-100",
  title,
}: {
  label: string;
  value: string;
  cls?: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-ink-400" title={title}>
        {label}
      </span>
      <span className={`text-sm font-medium ${cls}`}>{value}</span>
    </div>
  );
}

/** 单项指标异常着色: 达到明显档阈值为红, 仅达到可疑档为橙, 否则正常 */
function levelCls(strong: boolean, weak: boolean): string {
  return strong ? "text-verm-400" : weak ? "text-orange-300" : "text-ink-100";
}

/** 单侧统计卡片: 结论置顶, 指标对齐排列 */
function SideCard({
  label,
  labelCls,
  stats,
  bands,
}: {
  label: string;
  labelCls: string;
  stats: PhaseStats;
  bands: BandPair;
}) {
  const verdict = statsVerdict(stats, bands);
  const criticalRate = stats.criticals > 0 ? stats.critical_hits / stats.criticals : 0;
  const evCls = levelCls(stats.ev_rate >= bands.strong.ev, stats.ev_rate >= bands.weak.ev);
  const acplCls = levelCls(stats.acpl <= bands.strong.acpl, stats.acpl <= bands.weak.acpl);
  const stdCls = levelCls(stats.stddev <= bands.strong.stddev, stats.stddev <= bands.weak.stddev);
  const critCls = levelCls(
    stats.criticals >= bands.strong.criticals && criticalRate >= bands.strong.criticalRate,
    stats.criticals >= bands.weak.criticals && criticalRate >= bands.weak.criticalRate,
  );
  return (
    <div className="rounded-md border border-ink-700 bg-ink-800 px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className={`text-sm font-bold ${labelCls}`}>{label}</span>
        <span className="text-[10px] text-ink-400">{stats.plies} 手</span>
      </div>
      <div className={`mt-1 text-base font-semibold ${verdict.cls}`}>{verdict.label}</div>
      <div className="mt-2 space-y-1 text-xs">
        <StatRow label="首选吻合率" value={pct(stats.t1_rate)} />
        <StatRow label="等值吻合率" value={pct(stats.ev_rate)} cls={evCls} />
        <StatRow label="平均损失" value={`${stats.acpl.toFixed(1)} 厘`} cls={acplCls} />
        <StatRow
          label="损失波动"
          value={stats.stddev.toFixed(1)}
          cls={stdCls}
          title="每步损失标准差：软件棋低而稳，人类发挥有起伏"
        />
        <StatRow
          label="关键手命中"
          value={stats.criticals > 0 ? `${stats.critical_hits} / ${stats.criticals}` : "—"}
          cls={critCls}
          title="唯一明显好棋的局面（次优着法分差超 400 厘）中选对引擎首选的比例，人机混用的主要破绽"
        />
      </div>
    </div>
  );
}

export default function AnalysisPanel({ onClose }: { onClose: () => void }) {
  const phase = useAnalysisStore((s) => s.phase);
  const message = useAnalysisStore((s) => s.message);
  const target = useAnalysisStore((s) => s.target);
  const analysisPlies = useAnalysisStore((s) => s.plies);
  const progress = useAnalysisStore((s) => s.progress);
  const plys = useAnalysisStore((s) => s.plys);
  const result = useAnalysisStore((s) => s.result);
  const start = useAnalysisStore((s) => s.start);
  const stop = useAnalysisStore((s) => s.stop);
  const reset = useAnalysisStore((s) => s.reset);

  const game = useGameStore((s) => s.game);
  const fileName = useGameStore((s) => s.fileName);

  // 分档阈值: localStorage 初值, 改动立即生效并持久化(对已有结果重新分档, 无需重跑引擎)
  const [bands, setBands] = useState<BandPair>(loadBands);
  const updateBands = (next: BandPair) => {
    setBands(next);
    saveBands(next);
  };

  // 打开面板时注册事件订阅，关闭时清理
  useEffect(() => initAnalysisListeners(), []);

  // Esc 关闭（分析中关闭不中断后台分析，重开面板可见进度）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 逐手列表自动滚到底
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [plys.length]);

  const mainlinePlies = useMemo(() => (game ? collectMainlinePlies(game) : []), [game]);
  const shown = result?.plys ?? plys;
  const gameTitle = fileName ?? game?.info.title ?? "当前棋局";
  const analyzing = phase === "analyzing";

  const handleStart = () => {
    if (mainlinePlies.length > 0) void start(mainlinePlies, gameTitle);
  };

  const renderRow = (r: PlyReport) => {
    const notation = analysisPlies[r.ply - 1]?.notation ?? r.iccs;
    return (
      <div
        key={r.ply}
        className="flex items-center gap-2 border-b border-ink-700/60 px-3 py-1.5 text-sm last:border-b-0"
      >
        <span className="w-8 shrink-0 text-right text-xs text-ink-400">{r.ply}.</span>
        <span
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${
            r.side === "red" ? "bg-verm-500/15 text-verm-400" : "bg-ink-700 text-ink-300"
          }`}
        >
          {r.side === "red" ? "红" : "黑"}
        </span>
        <span className="w-16 shrink-0 font-piece text-base text-ink-200">{notation}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${kindCls(r.kind)}`}>
          {kindLabel(r.kind)}
        </span>
        {r.critical && (
          <span
            className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${
              r.kind === "miss" ? "bg-verm-500/15 text-verm-400" : "bg-orange-400/10 text-orange-300"
            }`}
            title="唯一明显好棋的局面（次优着法分差超 400 厘）"
          >
            关键
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-ink-400" title={r.best ? `引擎首选 ${r.best}` : undefined}>
          {r.kind === "t1" || !r.best ? "" : `引擎首选 ${r.best}`}
        </span>
        <span
          className={`shrink-0 text-xs ${
            r.kind === "miss" && r.loss > 100
              ? "text-verm-400"
              : r.kind === "miss"
                ? "text-gold-400"
                : "text-ink-400"
          }`}
        >
          {r.kind === "t1" ? "—" : `+${r.loss} 厘`}
        </span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70">
      <div className="flex max-h-[82vh] w-[500px] flex-col rounded-xl border border-gold-500/40 bg-ink-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-gold-300">软件检测</span>
          <div className="flex items-center gap-2">
            {analyzing && (
              <span className="flex items-center gap-1.5 text-xs text-verm-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-verm-500" />
                {progress ? `分析中 ${progress.ply} / ${progress.total}` : "正在启动引擎…"}
              </span>
            )}
            {phase === "done" && <span className="text-xs text-gold-400">分析完成</span>}
            <button
              onClick={onClose}
              title="关闭（Esc）"
              className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
            >
              ✕
            </button>
          </div>
        </div>

        {phase === "error" && (
          <>
            <div className="break-all rounded-md border border-verm-500/50 bg-verm-500/10 px-3 py-2.5 text-sm leading-relaxed text-verm-400">
              {message ?? "分析出错"}
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={reset} className={BTN} title="回到开始分析">
                重置
              </button>
            </div>
          </>
        )}

        {phase === "idle" && (
          <>
            <p className="text-sm leading-relaxed text-ink-300">
              用 Pikafish 引擎（单线程、固定深度 18，单手约 2 秒，一盘约两三分钟）逐手对照当前棋局的主线着法，
              统计吻合率与每步损失，评估对局是否存在软件生成特征。同一局每次分析结果完全一致。
            </p>
            <div className="mt-2 rounded-md bg-ink-800 px-2.5 py-2 text-xs text-ink-400">
              分析对象：<span className="text-ink-200">{gameTitle}</span>
              <span className="ml-2">主线 {mainlinePlies.length} 手</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-ink-400">
                {mainlinePlies.length === 0 ? "当前棋局没有可分析的着法" : "棋局越长结论越可靠，建议 30 手以上"}
              </span>
              <button
                onClick={handleStart}
                disabled={mainlinePlies.length === 0}
                className={`${BTN} border-gold-500/50 text-gold-300`}
                title="开始逐手引擎分析"
              >
                ▶ 开始分析
              </button>
            </div>
          </>
        )}

        {(analyzing || phase === "stopped" || phase === "done") && (
          <>
            <div className="mb-2 truncate rounded-md bg-ink-800 px-2.5 py-1.5 text-xs text-ink-400">
              分析对象：<span className="text-ink-200">{target ?? gameTitle}</span>
            </div>

            {phase === "stopped" && (
              <div className="mb-2 rounded-md border border-gold-500/40 bg-gold-400/10 px-2.5 py-1.5 text-xs text-gold-300">
                已停止，以下为已完成部分（{shown.length} 手）
              </div>
            )}

            {result && (
              <>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <SideCard label="红方" labelCls="text-verm-400" stats={result.red} bands={bands} />
                  <SideCard label="黑方" labelCls="text-ink-100" stats={result.black} bands={bands} />
                </div>
                <VerdictRules bands={bands} onChange={updateBands} onReset={() => updateBands(DEFAULT_BANDS)} />
                <p className="mb-2 text-[10px] leading-relaxed text-ink-400">
                  耗时 {(result.elapsed_ms / 1000).toFixed(1)} 秒
                </p>
              </>
            )}

            <div
              ref={listRef}
              className="min-h-[180px] flex-1 overflow-y-auto rounded-lg border border-ink-700 bg-ink-800"
            >
              {shown.length === 0 ? (
                <div className="flex h-full items-center justify-center py-10 text-xs text-ink-400">
                  {analyzing ? "正在分析第一手…" : "没有结果"}
                </div>
              ) : (
                shown.map(renderRow)
              )}
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              {analyzing ? (
                <button
                  onClick={() => void stop()}
                  className={`${BTN} border-verm-500/50 text-verm-400`}
                  title="停止分析，保留已完成部分"
                >
                  ■ 停止分析
                </button>
              ) : (
                <>
                  <button onClick={reset} className={BTN} title="清空结果">
                    重置
                  </button>
                  <button
                    onClick={handleStart}
                    className={`${BTN} border-gold-500/50 text-gold-300`}
                    title="重新逐手分析"
                  >
                    ▶ 重新分析
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
