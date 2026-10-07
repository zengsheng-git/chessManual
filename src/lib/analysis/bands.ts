/**
 * 软件检测分档阈值：判定"软件特征明显 / 有一定软件特征 / 未见明显特征"的条件。
 * 默认值为经验设定（未经数据校准），用户可在软件检测面板中调整，持久化到 localStorage。
 */

export interface Band {
  /** 等值吻合率下限（0-1） */
  ev: number;
  /** 平均损失上限（厘） */
  acpl: number;
  /** 损失波动（每步损失标准差）上限（厘） */
  stddev: number;
  /** 关键手数量下限 */
  criticals: number;
  /** 关键手命中率下限（0-1） */
  criticalRate: number;
}

export interface BandPair {
  strong: Band;
  weak: Band;
}

export const DEFAULT_BANDS: BandPair = {
  strong: { ev: 0.9, acpl: 30, stddev: 50, criticals: 6, criticalRate: 0.95 },
  weak: { ev: 0.75, acpl: 60, stddev: 90, criticals: 4, criticalRate: 0.85 },
};

const STORAGE_KEY = "analysisBands";

/** 各字段合法范围，越界或非法输入按此收敛 */
const LIMITS: Record<keyof Band, { min: number; max: number }> = {
  ev: { min: 0, max: 1 },
  acpl: { min: 1, max: 10_000 },
  stddev: { min: 0, max: 10_000 },
  criticals: { min: 0, max: 9_999 },
  criticalRate: { min: 0, max: 1 },
};

/** 把任意数值收敛到某字段的合法范围 */
export function clampField(field: keyof Band, value: number): number {
  const { min, max } = LIMITS[field];
  return Math.min(max, Math.max(min, value));
}

/** 非法字段逐项回退到 defaults，保证读出的 BandPair 总是完整可用 */
function sanitizeBand(raw: unknown, fallback: Band): Band {
  if (typeof raw !== "object" || raw === null) return fallback;
  const out = { ...fallback };
  const rec = raw as Record<string, unknown>;
  for (const key of Object.keys(LIMITS) as (keyof Band)[]) {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = clampField(key, v);
    }
  }
  return out;
}

/** 读取持久化的阈值；无存档 / JSON 损坏时返回默认值 */
export function loadBands(): BandPair {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return DEFAULT_BANDS;
    const raw = JSON.parse(text) as { strong?: unknown; weak?: unknown };
    return {
      strong: sanitizeBand(raw.strong, DEFAULT_BANDS.strong),
      weak: sanitizeBand(raw.weak, DEFAULT_BANDS.weak),
    };
  } catch {
    return DEFAULT_BANDS;
  }
}

/** 保存阈值到 localStorage；存储不可用时静默（仅本次会话生效） */
export function saveBands(bands: BandPair): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bands));
  } catch {
    // 忽略写入失败
  }
}
