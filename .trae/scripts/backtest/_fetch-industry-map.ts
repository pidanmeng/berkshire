#!/usr/bin/env bun
/**
 * 一次性拉取全市场行业映射 → JSON 缓存
 *
 * 独立进程跑：bun 在大进程内并发 fetch 东财会被拒（TLS 状态污染），
 * 用 Bun.spawn 子进程调用本脚本可隔离 TLS 状态。
 *
 * 用法：
 *   bun run .trae/scripts/backtest/_fetch-industry-map.ts <output-path>
 *
 * 输出：JSON 对象 { fetchedAt: number, items: { thscode: string, industry: string }[] }
 */
import { getIndustryMapFromClist } from "../hithink/hithink.ts";
import { writeFileSync } from "node:fs";

async function main() {
  const outPath = process.argv[2] ?? "Research/00-Workspace/08-Backtest/cache/industry-map.json";
  console.log(`[fetch-industry-map] 拉取全市场行业映射 → ${outPath}`);
  const map = await getIndustryMapFromClist();
  console.log(`[fetch-industry-map] 行业映射 ${map.size} 条`);
  const items = Array.from(map.entries()).map(([thscode, industry]) => ({ thscode, industry }));
  const payload = { fetchedAt: Date.now(), items };
  writeFileSync(outPath, JSON.stringify(payload), "utf-8");
  console.log(`[fetch-industry-map] 完成`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
