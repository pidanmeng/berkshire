/**
 * composite.ts 单测 — bun test
 *   bun test .trae/scripts/valuation/__tests__/composite.test.ts
 */

import { describe, expect, test } from "bun:test";
import { computeComposite, COMPOSITE_WEIGHTS, SCORE_KEYS } from "../composite.ts";

describe("computeComposite", () => {
  test("六维均分 6.0 → 综合 6.0", () => {
    const scores = {
      capability: 6, moat: 6, business_model: 6,
      management: 6, inversion: 6, historical: 6,
    };
    expect(computeComposite(scores)).toBe(6);
  });

  test("六维均分权重下综合 = 算术平均，保留 1 位小数", () => {
    const scores = {
      capability: 6.5, moat: 7.0, business_model: 5.5,
      management: 6.0, inversion: 6.5, historical: 6.0,
    };
    // (6.5+7+5.5+6+6.5+6)/6 = 37.5/6 = 6.25 → 6.3
    expect(computeComposite(scores)).toBe(6.3);
  });

  test("自定义权重生效：moat 权重放大后综合更高", () => {
    const scores = {
      capability: 5, moat: 10, business_model: 5,
      management: 5, inversion: 5, historical: 5,
    };
    const equal = computeComposite(scores);
    const moatHeavy = computeComposite(scores, { ...COMPOSITE_WEIGHTS, moat: 0.5 });
    // 均分权重：(5+10+5+5+5+5)/6 = 5.83；moat 0.5 时：(5*0.5+10*0.5+5*5*0.1)/1 = 略高
    expect(moatHeavy).toBeGreaterThan(equal!);
  });

  test("缺维度时按剩余权重归一化（不因缺失而偏低）", () => {
    const full = {
      capability: 8, moat: 8, business_model: 8,
      management: 8, inversion: 8, historical: 8,
    };
    const missing = {
      capability: 8, moat: 8, business_model: 8,
      management: 8, inversion: 8, // historical 缺失
    };
    // 归一化后仍应为 8
    expect(computeComposite(missing)).toBe(8);
    expect(computeComposite(full)).toBe(8);
  });

  test("全部缺失 → null", () => {
    expect(computeComposite({})).toBeNull();
    expect(computeComposite({ capability: null, moat: null })).toBeNull();
  });

  test("越界分数夹取到 [0,10]", () => {
    const scores = {
      capability: 99, moat: -5, business_model: 6,
      management: 6, inversion: 6, historical: 6,
    };
    const result = computeComposite(scores)!;
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(10);
  });

  test("权重总和不必为 1（自动归一化）", () => {
    const scores = {
      capability: 6, moat: 6, business_model: 6,
      management: 6, inversion: 6, historical: 6,
    };
    expect(computeComposite(scores, { capability: 1, moat: 1 })).toBe(6);
  });

  test("SCORE_KEYS 与 COMPOSITE_WEIGHTS 键一致", () => {
    for (const key of SCORE_KEYS) {
      expect(COMPOSITE_WEIGHTS[key]).toBeDefined();
    }
  });
});
