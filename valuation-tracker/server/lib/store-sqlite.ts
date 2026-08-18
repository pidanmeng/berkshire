/**
 * bun:sqlite 存储实现（本地 / 持久主机默认）
 * 依赖 Bun 内置 SQLite，无需任何第三方原生模块。
 * 注意：bun:sqlite 仅在 Bun 运行时存在；改为函数内动态 import，
 * 使 Node.js 运行环境（如 Vercel Serverless）加载本模块不报错，由 db.ts 降级到 Turso/内存。
 */
import type { Store, PriceSnapshot, FundamentalCheck, Message, MessageCreateInput } from "./store.ts";

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
        | FundamentalRow
        | null;
      return row ? mapFundamentalRow(row) : null;
    },
    async listChecks(): Promise<FundamentalCheck[]> {
      const rows = db
        .query(
          `SELECT thscode, last_checked_at, latest_report_title, latest_report_date, needs_update, detail
           FROM fundamental_checks`,
        )
        .all() as unknown as FundamentalRow[];
      return rows.map(mapFundamentalRow);
    },
    async listRepliedMessages(): Promise<Message[]> {
      const rows = db
        .query(
          `SELECT id, type, content, tip_amount, tip_marked_at, reply, replied_at, created_at
           FROM messages WHERE replied_at IS NOT NULL
           ORDER BY created_at DESC, id DESC`,
        )
        .all() as unknown as MessageRow[];
      return rows.map(mapMessageRow);
    },
    async listAllMessages(): Promise<Message[]> {
      const rows = db
        .query(
          `SELECT id, type, content, tip_amount, tip_marked_at, reply, replied_at, created_at
           FROM messages ORDER BY created_at DESC, id DESC`,
        )
        .all() as unknown as MessageRow[];
      return rows.map(mapMessageRow);
    },
    async createMessage(input: MessageCreateInput): Promise<Message> {
      const row = db
        .query(
          `INSERT INTO messages (type, content, tip_amount, tip_marked_at, reply, replied_at, created_at)
           VALUES (?, ?, NULL, NULL, NULL, NULL, ?)
           RETURNING id, type, content, tip_amount, tip_marked_at, reply, replied_at, created_at`,
        )
        .get(input.type, input.content, new Date().toISOString()) as unknown as MessageRow;
      return mapMessageRow(row);
    },
    async replyMessage(id: number, reply: string, tipAmount: number | null): Promise<Message | null> {
      const now = new Date().toISOString();
      const res = db.run(
        `UPDATE messages SET reply = ?, replied_at = ?, tip_amount = ?, tip_marked_at = ? WHERE id = ?`,
        [reply, now, tipAmount, tipAmount === null ? null : now, id],
      );
      if (res.changes === 0) return null;
      const row = db
        .query(
          `SELECT id, type, content, tip_amount, tip_marked_at, reply, replied_at, created_at
           FROM messages WHERE id = ?`,
        )
        .get(id) as unknown as MessageRow;
      return mapMessageRow(row);
    },
    async deleteMessage(id: number): Promise<boolean> {
      const res = db.run(`DELETE FROM messages WHERE id = ?`, [id]);
      return res.changes > 0;
    },
  };
}

type FundamentalRow = {
  thscode: string;
  last_checked_at: string;
  latest_report_title: string;
  latest_report_date: string;
  needs_update: number | null;
  detail: string;
};

function mapFundamentalRow(row: FundamentalRow): FundamentalCheck {
  return {
    thscode: row.thscode,
    last_checked_at: row.last_checked_at,
    latest_report_title: row.latest_report_title,
    latest_report_date: row.latest_report_date,
    needs_update: row.needs_update === null ? null : row.needs_update === 1,
    detail: row.detail,
  };
}

type MessageRow = {
  id: number;
  type: string;
  content: string;
  tip_amount: number | null;
  tip_marked_at: string | null;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
};

function mapMessageRow(r: MessageRow): Message {
  return {
    id: r.id,
    type: r.type,
    content: r.content,
    tip_amount: r.tip_amount === null ? null : Number(r.tip_amount),
    tip_marked_at: r.tip_marked_at,
    reply: r.reply,
    replied_at: r.replied_at,
    created_at: r.created_at,
  };
}
