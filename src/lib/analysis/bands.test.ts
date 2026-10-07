import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampField, DEFAULT_BANDS, loadBands, saveBands, type BandPair } from "./bands";

// Vitest 默认 node 环境，无 localStorage，用内存版 stub
let store: Map<string, string>;

function mockLocalStorage(): void {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

beforeEach(() => mockLocalStorage());
afterEach(() => vi.unstubAllGlobals());

describe("loadBands", () => {
  it("无存档时返回默认值", () => {
    expect(loadBands()).toEqual(DEFAULT_BANDS);
  });

  it("保存后读回一致", () => {
    const bands: BandPair = {
      strong: { ev: 0.8, acpl: 40, stddev: 60, criticals: 5, criticalRate: 0.9 },
      weak: { ev: 0.7, acpl: 70, stddev: 100, criticals: 3, criticalRate: 0.8 },
    };
    saveBands(bands);
    expect(loadBands()).toEqual(bands);
  });

  it("JSON 损坏时回退默认值", () => {
    store.set("analysisBands", "{not json");
    expect(loadBands()).toEqual(DEFAULT_BANDS);
  });

  it("缺失字段逐项回退默认值", () => {
    store.set("analysisBands", JSON.stringify({ strong: { ev: 0.5 } }));
    const bands = loadBands();
    expect(bands.strong.ev).toBe(0.5);
    expect(bands.strong.acpl).toBe(DEFAULT_BANDS.strong.acpl);
    expect(bands.weak).toEqual(DEFAULT_BANDS.weak);
  });

  it("越界字段收敛到合法范围", () => {
    store.set(
      "analysisBands",
      JSON.stringify({ strong: { ev: 7, acpl: -5, stddev: 1e9, criticals: -1, criticalRate: 2 } }),
    );
    const { strong } = loadBands();
    expect(strong.ev).toBe(1);
    expect(strong.acpl).toBe(1);
    expect(strong.stddev).toBe(10_000);
    expect(strong.criticals).toBe(0);
    expect(strong.criticalRate).toBe(1);
  });
});

describe("clampField", () => {
  it("收敛到字段上下限", () => {
    expect(clampField("acpl", 0)).toBe(1);
    expect(clampField("criticals", 100_000)).toBe(9_999);
    expect(clampField("stddev", 42)).toBe(42);
  });
});
