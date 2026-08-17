/**
 * 安全边际分档计算 — 核心监控逻辑
 * 以「当前市值 vs 目标市值（悲观/合理/乐观）」判断低估/合理/高估区间。
 */

export type CapZone = "deep_undervalued" | "undervalued" | "fair" | "overvalued" | "no_anchor";

export interface CapTarget {
  pessimistic?: number;  // 亿元
  neutral?: number;
  optimistic?: number;
}

export interface ZoneResult {
  zone: CapZone;
  label: string;
  /** 相对悲观目标的偏离：(悲观−当前)/悲观；>0 表示已低于悲观目标 */
  marginVsPess: number | null;
  /** 相对合理目标的偏离 */
  distanceToNeutral: number | null;
  /** 相对乐观目标的偏离 */
  distanceToOpt: number | null;
}

const LABELS: Record<CapZone, string> = {
  deep_undervalued: "深度低估",
  undervalued: "低估区间",
  fair: "合理区间",
  overvalued: "高估区间",
  no_anchor: "无估值锚点",
};

/** 当前市值（亿元）相对目标市值分档 */
export function classifyCapZone(currentCapYi: number | null, target: CapTarget | null): ZoneResult {
  const base: ZoneResult = {
    zone: "no_anchor", label: LABELS.no_anchor,
    marginVsPess: null, distanceToNeutral: null, distanceToOpt: null,
  };
  if (currentCapYi === null || currentCapYi <= 0 || !target) return base;
  const { pessimistic, neutral, optimistic } = target;
  if (pessimistic === undefined && neutral === undefined && optimistic === undefined) return base;

  const rel = (t?: number) => (t === undefined || t <= 0 ? null : (t - currentCapYi) / t);

  let zone: CapZone;
  if (pessimistic !== undefined && currentCapYi <= pessimistic) zone = "deep_undervalued";
  else if (neutral !== undefined && currentCapYi <= neutral) zone = "undervalued";
  else if (optimistic !== undefined && currentCapYi <= optimistic) zone = "fair";
  else zone = "overvalued";

  return {
    zone,
    label: LABELS[zone],
    marginVsPess: rel(pessimistic),
    distanceToNeutral: rel(neutral),
    distanceToOpt: rel(optimistic),
  };
}
