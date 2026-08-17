/**
 * bun:sqlite 存储实现（本地 / 持久主机默认）
 * 依赖 Bun 内置 SQLite，无需任何第三方原生模块。
 * 注意：bun:sqlite 仅在 Bun 运行时存在；改为函数内动态 import，
 * 使 Node.js 运行环境（如 Vercel Serverless）加载本模块不报错，由 db.ts 降级到 Turso/内存。
 */
import type { Store, PriceSnapshot, FundamentalCheck } from "./store.ts";

export async function createSqliteStore(dbPath = "data/tracker.db"): Promise<Store> {
  // @ts-ignore bun:sqlite 仅 Bun 运行时存在；Node（Vercel）类型环境无此模块声明，由 db.ts 捕获后降级
  const { Database } = await import("bun:sqlite");
  const db = new Database(dbPath, { create: true });
  db.run(`
    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thscode TEXT NOT NULL,
      ts INTEGER NOT NULL,
      price REAL, market_cap REAL, pe_ttm REAL, pb_mrq REAL, change_pct REAL
    );
    CREATE INDEX IF NOT EXISTS idx_snap_thscode_ts ON price_snapshots(thscode, ts);
    CREATE TABLE IF NOT EXISTS fundamental_checks (
      thscode TEXT PRIMARY KEY,
      last_checked_at TEXT,
      latest_report_title TEXT,
      latest_report_date TEXT,
      needs_update INTEGER,
      detail TEXT
    );
  `);

  return {
    async saveSnapshot(snap: PriceSnapshot) {
      db.run(
        `INSERT INTO price_snapshots (thscode, ts, price, market_cap, pe_ttm, pb_mrq, change_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [snap.thscode, snap.ts, snap.price, snap.market_cap, snap.pe_ttm, snap.pb_mrq, snap.change_pct],
      );
      // 自动清理 90 天前的旧快照
      const cutoff = Date.now() - 90 * 86400000;
      db.run(`DELETE FROM price_snapshots WHERE ts < ?`, [cutoff]);
    },
    async getSnapshots(thscode: string, limit: number): Promise<PriceSnapshot[]> {
      const rows = db
        .query(
          `SELECT thscode, ts, price, market_cap, pe_ttm, pb_mrq, change_pct
           FROM price_snapshots WHERE thscode = ? ORDER BY ts ASC LIMIT ?`,
        )
        .all(thscode, limit) as unknown as PriceSnapshot[];
      return rows;
    },
    async setCheck(check: FundamentalCheck) {
      db.run(
        `INSERT INTO fundamental_checks (thscode, last_checked_at, latest_report_title, latest_report_date, needs_update, detail)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(thscode) DO UPDATE SET
           last_checked_at = excluded.last_checked_at,
           latest_report_title = excluded.latest_report_title,
           latest_report_date = excluded.latest_report_date,
           needs_update = excluded.needs_update,
           detail = excluded.detail`,
        [check.thscode, check.last_checked_at, check.latest_report_title, check.latest_report_date,
         check.needs_update === null ? null : (check.needs_update ? 1 : 0), check.detail],
      );
    },
    async getCheck(thscode: string): Promise<FundamentalCheck | null> {
      const row = db
        .query(
          `SELECT thscode, last_checked_at, latest_report_title, latest_report_date, needs_update, detail
           FROM fundamental_checks WHERE thscode = ?`,
        )
        .get(thscode) as
        | { thscode: string; last_checked_at: string; latest_report_title: string; latest_report_date: string; needs_update: number | null; detail: string }
        | null;
      if (!row) return null;
      return {
        thscode: row.thscode,
        last_checked_at: row.last_checked_at,
        latest_report_title: row.latest_report_title,
        latest_report_date: row.latest_report_date,
        needs_update: row.needs_update === null ? null : row.needs_update === 1,
        detail: row.detail,
      };
    },
  };
}
