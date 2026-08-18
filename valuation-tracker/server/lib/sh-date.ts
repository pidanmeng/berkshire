/**
 * 东八区（Asia/Shanghai）日期格式化工具
 * A 股数据时间均为北京时间；用 toISOString()（UTC）会导致日期偏移一天，
 * 统一改用本函数按 Asia/Shanghai 时区格式化为 YYYY-MM-DD。
 */

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 毫秒时间戳 → 北京时间 YYYY-MM-DD */
export function shDate(ms: number): string {
  return fmt.format(new Date(ms));
}
