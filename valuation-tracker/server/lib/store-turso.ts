/**
 * Turso (libSQL) 存储实现 — 仅当后端以 Serverless（如 Vercel Function）部署、
 * 文件系统不可持久化时启用。通过环境变量 TURSO_URL + TURSO_AUTH_TOKEN 激活。
 * Turso 与 SQLite 完全同构，表结构与 store-sqlite.ts 一致。
 */
import { createClient } from "@libsql/client";
import type { Store, PriceSnapshot, FundamentalCheck } from "./store.ts";

export function createTursoStore(url: string, authToken?: string): Store {
  const client = createClient({ url, authToken });
  let ready: Promise<void> | null = null;
  const ensure = () =>
    (ready ??= (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS price_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thscode TEXT NOT NULL,
          ts INTEGER NOT NULL,
          price REAL, market_cap REAL, pe_ttm REAL, pb_mrq REAL, change_pct REAL
        );
      `);
      await client.execute(`CREATE INDEX IF NOT EXISTS idx_snap_thscode_ts ON price_snapshots(thscode, ts);`);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS fundamental_checks (
          thscode TEXT PRIMARY KEY,
          last_checked_at TEXT,
          latest_report_title TEXT,
          latest_report_date TEXT,
          needs_update INTEGER,
          detail TEXT
        );
      `);
    })());

  return {
    async saveSnapshot(snap: PriceSnapshot) {
      await ensure();
      await client.execute({
        sql: `INSERT INTO price_snapshots (thscode, ts, price, market_cap, pe_ttm, pb_mrq, change_pct)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [snap.thscode, snap.ts, snap.price, snap.market_cap, snap.pe_ttm, snap.pb_mrq, snap.change_pct],
      });
      const cutoff = Date.now() - 90 * 86400000;
      await client.execute({ sql: `DELETE FROM price_snapshots WHERE ts < ?`, args: [cutoff] });
    },
    async getSnapshots(thscode: string, limit: number): Promise<PriceSnapshot[]> {
      await ensure();
      const res = await client.execute({
        sql: `SELECT thscode, ts, price, market_cap, pe_ttm, pb_mrq, change_pct
              FROM price_snapshots WHERE thscode = ? ORDER BY ts ASC LIMIT ?`,
        args: [thscode, limit],
      });
      return res.rows.map((r) => ({
        thscode: String(r.thscode),
        ts: Number(r.ts),
        price: r.price === null ? null : Number(r.price),
        market_cap: r.market_cap === null ? null : Number(r.market_cap),
        pe_ttm: r.pe_ttm === null ? null : Number(r.pe_ttm),
        pb_mrq: r.pb_mrq === null ? null : Number(r.pb_mrq),
        change_pct: r.change_pct === null ? null : Number(r.change_pct),
      }));
    },
    async setCheck(check: FundamentalCheck) {
      await ensure();
      await client.execute({
        sql: `INSERT INTO fundamental_checks (thscode, last_checked_at, latest_report_title, latest_report_date, needs_update, detail)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(thscode) DO UPDATE SET
                last_checked_at = excluded.last_checked_at,
                latest_report_title = excluded.latest_report_title,
                latest_report_date = excluded.latest_report_date,
                needs_update = excluded.needs_update,
                detail = excluded.detail`,
        args: [check.thscode, check.last_checked_at, check.latest_report_title, check.latest_report_date,
               check.needs_update === null ? null : (check.needs_update ? 1 : 0), check.detail],
      });
    },
    async getCheck(thscode: string): Promise<FundamentalCheck | null> {
      await ensure();
      const res = await client.execute({
        sql: `SELECT thscode, last_checked_at, latest_report_title, latest_report_date, needs_update, detail
              FROM fundamental_checks WHERE thscode = ?`,
        args: [thscode],
      });
      const row = res.rows[0];
      if (!row) return null;
      const nu = row.needs_update;
      return {
        thscode: String(row.thscode),
        last_checked_at: String(row.last_checked_at),
        latest_report_title: String(row.latest_report_title ?? ""),
        latest_report_date: String(row.latest_report_date ?? ""),
        needs_update: nu === null ? null : nu === 1,
        detail: String(row.detail ?? ""),
      };
    },
  };
}
