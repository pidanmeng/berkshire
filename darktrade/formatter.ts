// ========== 金额格式化 ==========

export function fmtMoney(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(2) + '元';
}

export function fmtMoneyShort(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return v.toFixed(0) + '元';
}

// ========== 百分比格式化 ==========

export function fmtPct(v: number) {
  return (v * 100).toFixed(2);
}

// ========== 价格格式化 ==========

export function fmtPrice(v: number) {
  return (v / 1000).toFixed(2);
}

// ========== 颜色工具 ==========

export function valColor(v: number) {
  return v > 0 ? 'text-red-500' : v < 0 ? 'text-emerald-500' : 'text-muted-foreground';
}
