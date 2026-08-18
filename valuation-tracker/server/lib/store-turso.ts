/**
 * Turso (libSQL) 存储实现 — 仅当后端以 Serverless（如 Vercel Function）部署、
 * 文件系统不可持久化时启用。通过环境变量 TURSO_URL + TURSO_AUTH_TOKEN 激活。
 * Turso 与 SQLite 完全同构，表结构与 store-sqlite.ts 一致。
 */
import { createClient } from "@libsql/client";
import type { Store, PriceSnapshot, FundamentalCheck, Message, MessageCreateInput } from "./store.ts";

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
      await client.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          tip_amount REAL,
          tip_marked_at TEXT,
          reply TEXT,
          replied_at TEXT,
          created_at TEXT NOT NULL
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
      return row ? mapFundamentalRow(row) : null;
    },
    async listChecks(): Promise<FundamentalCheck[]> {
      await ensure();
      const res = await client.execute({
        sql: `SELECT thscode, last_checked_at, latest_report_title, latest_report_date, needs_update, detail
              FROM fundamental_checks`,
        args: [],
      });
      return res.rows.map(mapFundamentalRow);
    },
    async listRepliedMessages(): Promise<Message[]> {
      await ensure();
      const res = await client.execute({
        sql: `SELECT id, type, content, tip_amount, tip_marked_at, reply, replied_at, created_at
              FROM messages WHERE replied_at IS NOT NULL
              ORDER BY created_at DESC, id DESC`,
        args: [],
      });
      return res.rows.map(mapTursoMessageRow);
    },
    async listAllMessages(): Promise<Message[]> {
      await ensure();
      const res = await client.execute({
        sql: `SELECT id, type, content, tip_amount, tip_marked_at, reply, replied_at, created_at
              FROM messages ORDER BY created_at DESC, id DESC`,
        args: [],
      });
      return res.rows.map(mapTursoMessageRow);
    },
    async createMessage(input: MessageCreateInput): Promise<Message> {
      await ensure();
      const now = new Date().toISOString();
      const res = await client.execute({
        sql: `INSERT INTO messages (type, content, tip_amount, tip_marked_at, reply, replied_at, created_at)
              VALUES (?, ?, NULL, NULL, NULL, NULL, ?)
              RETURNING id, type, content, tip_amount, tip_marked_at, reply, replied_at, created_at`,
        args: [input.type, input.content, now],
      });
      return mapTursoMessageRow(res.rows[0]);
    },
    async replyMessage(id: number, reply: string, tipAmount: number | null): Promise<Message | null> {
      await ensure();
      const now = new Date().toISOString();
      const res = await client.execute({
        sql: `UPDATE messages SET reply = ?, replied_at = ?, tip_amount = ?, tip_marked_at = ? WHERE id = ?`,
        args: [reply, now, tipAmount, tipAmount === null ? null : now, id],
      });
      if (Number(res.rowsAffected) === 0) return null;
      const row = await client.execute({
        sql: `SELECT id, type, content, tip_amount, tip_marked_at, reply, replied_at, created_at
              FROM messages WHERE id = ?`,
        args: [id],
      });
      return mapTursoMessageRow(row.rows[0]);
    },
    async deleteMessage(id: number): Promise<boolean> {
      await ensure();
      const res = await client.execute({
        sql: `DELETE FROM messages WHERE id = ?`,
        args: [id],
      });
      return Number(res.rowsAffected) > 0;
    },
  };
}

function mapFundamentalRow(row: Record<string, unknown>): FundamentalCheck {
  const nu = row.needs_update;
  return {
    thscode: String(row.thscode),
    last_checked_at: String(row.last_checked_at),
    latest_report_title: String(row.latest_report_title ?? ""),
    latest_report_date: String(row.latest_report_date ?? ""),
    needs_update: nu === null || nu === undefined ? null : nu === 1,
    detail: String(row.detail ?? ""),
  };
}

function mapTursoMessageRow(row: Record<string, unknown>): Message {
  return {
    id: Number(row.id),
    type: String(row.type),
    content: String(row.content),
    tip_amount: row.tip_amount === null || row.tip_amount === undefined ? null : Number(row.tip_amount),
    tip_marked_at: row.tip_marked_at === null ? null : String(row.tip_marked_at),
    reply: row.reply === null ? null : String(row.reply),
    replied_at: row.replied_at === null ? null : String(row.replied_at),
    created_at: String(row.created_at),
  };
}
