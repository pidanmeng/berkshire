/**
 * 基本面定时批量更新调度器 — Bun 自托管模式（server/index.ts isMain 分支启动）
 * 每 6h 遍历全量已调研公司，对检测缓存过期（超过 intervalMs）的公司重新检测
 * 巨潮财报（只查年报/半年报/业绩报表，不含业绩预告等公告），并把结果写入 fundamental_checks 表。
 * 手动刷新不受影响（fundamentals 路由 ?refresh=1 绕过缓存）。
 */
import { loadCompanies } from "./research.ts";
import { checkFundamentalUpdate } from "./cninfo.ts";
import { getDb } from "./db.ts";

const DEFAULT_INTERVAL_MS = 6 * 3600_000; // 与 fundamentals 路由 CHECK_TTL_MS 对齐

export function startFundamentalScheduler(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  let running = false;

  const tick = async () => {
    if (running) return; // 防重入
    running = true;
    const startedAt = Date.now();
    console.log("[fundamental-scheduler] 开始批量基本面检测…");
    try {
      const notes = await loadCompanies();
      const store = await getDb();
      let checked = 0;
      let skipped = 0;
      for (const n of notes) {
        try {
          const existing = await store.getCheck(n.thscode);
          if (existing && Date.now() - new Date(existing.last_checked_at).getTime() < intervalMs) {
            skipped++;
            continue;
          }
          const result = await checkFundamentalUpdate(n.name, n.researchCutoff);
          await store.setCheck({
            thscode: n.thscode,
            last_checked_at: new Date().toISOString(),
            latest_report_title: result.latestTitle,
            latest_report_date: result.latestDate,
            needs_update: result.needsUpdate,
            detail: JSON.stringify(result.items),
          });
          checked++;
          console.log(
            `[fundamental-scheduler] ${n.thscode} ${n.name}: needsUpdate=${result.needsUpdate} latest=${result.latestDate || "-"}`,
          );
        } catch (e) {
          // 单家公司失败不阻断整体
          console.error(`[fundamental-scheduler] ${n.thscode} 检测失败：`, (e as Error).message);
        }
        // 错峰：每家公司间隔约 150ms，降低对巨潮/cninfo 的并发冲击（上游连接被重置的常见诱因）
        await new Promise((r) => setTimeout(r, 150));
      }
      console.log(
        `[fundamental-scheduler] 完成：${checked} 家检测 / ${skipped} 家跳过，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      );
    } catch (e) {
      console.error("[fundamental-scheduler] 批量检测失败：", (e as Error).message);
    } finally {
      running = false;
    }
  };

  // 启动后延迟 60s 首跑，之后按 intervalMs 周期执行
  const first = setTimeout(() => { void tick(); }, 60_000);
  const timer = setInterval(() => { void tick(); }, intervalMs);

  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
