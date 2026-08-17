/**
 * 六维综合评分权重公式 — 单一事实源
 *
 * 被 evaluate.ts / backfill.ts / valuation-tracker（Elysia 数据层）共同引用。
 * 修改权重只需改 COMPOSITE_WEIGHTS，重跑相关脚本与追踪系统即全局生效。
 *
 * 六维对齐投研系统「四大师框架」：
 *   能力圈（巴菲特）/ 护城河（巴菲特）/ 生意模式（段永平）
 *   管理层诚信（段永平+本分）/ 反向检查清单（芒格）/ 历史类比与时间框架（李录）
 *
 * 综合分 = Σ(维度分数 × 权重)，缺失维度按剩余权重归一化，结果保留 1 位小数。
 */

export interface SixScores {
  capability?: number | null;      // 能力圈
  moat?: number | null;            // 护城河
  business_model?: number | null;  // 生意模式
  management?: number | null;      // 管理层诚信
  inversion?: number | null;       // 反向检查清单
  historical?: number | null;      // 历史类比与时间框架
}

export const SCORE_KEYS = [
  "capability",
  "moat",
  "business_model",
  "management",
  "inversion",
  "historical",
] as const;

/** 六维综合评分权重（默认均分，可随时修改；总和不必为 1，程序会归一化） */
export const COMPOSITE_WEIGHTS: Record<(typeof SCORE_KEYS)[number], number> = {
  capability: 1 / 6,
  moat: 1 / 6,
  business_model: 1 / 6,
  management: 1 / 6,
  inversion: 1 / 6,
  historical: 1 / 6,
};
// ← 修改上面的权重即可全局生效。例如加重护城河：moat: 0.3, 其余 0.14。

/**
 * 六维分数 → 综合分（0-10，1 位小数）
 * - 缺失维度按剩余权重归一化（避免缺维度导致综合分偏低）
 * - 全部缺失或全为 null 时返回 null
 * - 分数越界（<0 或 >10）时夹取到 [0,10]
 */
export function computeComposite(
  scores: SixScores,
  weights: Partial<Record<(typeof SCORE_KEYS)[number], number>> = COMPOSITE_WEIGHTS,
): number | null {
  let weightedSum = 0;
  let weightSum = 0;
  for (const key of SCORE_KEYS) {
    const w = weights[key];
    const s = scores[key];
    if (w == null || w <= 0) continue;          // 权重为 0 或缺失 → 该维不参与
    if (s == null || Number.isNaN(s)) continue; // 分数缺失 → 该维跳过（归一化）
    const clamped = Math.max(0, Math.min(10, s));
    weightedSum += clamped * w;
    weightSum += w;
  }
  if (weightSum <= 0) return null;
  const composite = weightedSum / weightSum;
  return Math.round(composite * 10) / 10;
}
