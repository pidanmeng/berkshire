/**
 * 暗盘页码持久化 — 每只股票对应的暗盘页码（东财当日列表中的页码）写入 SQLite。
 * 表：darktrade_pages（code PRIMARY KEY + page + updated_at）
 * 数据库文件沿用现有机制：data/tracker.db（与 store-sqlite.ts 同文件，新增独立表）。
 * 仅在 Bun 运行时可用；无 bun:sqlite（Node/Serverless）时降级为内存 Map（不持久化）。
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface DarkTradePageStore {
  /** 读取某只股票的页码（无记录返回 null） */
  getPage(code: string): Promise<number | null>;
  /** 写回页码；仅当页码变化时实际写入并返回 true（updated_at 同步刷新） */
  setPage(code: string, page: number): Promise<boolean>;
  /** 批量写回（全市场列表构建 stockPageMap 后一次提交）；返回实际变化条数 */
  setPages(map: Record<string, number>): Promise<number>;
  close(): void;
}

function resolveDbPath(): string {
  try {
    const dataDir = join(process.cwd(), "data");
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    return join(dataDir, "tracker.db");
  } catch {
    // 无文件系统（Serverless）→ 内存降级
    return "";
  }
}

/** bun:sqlite 实现（同一 tracker.db 新增 darktrade_pages 表） */
async function createSqlitePageStore(dbPath: string): Promise<DarkTradePageStore> {
  // @ts-ignore bun:sqlite 仅 Bun 运行时存在；Node 类型环境无此模块声明
  const { Database } = await import("bun:sqlite");
  const db = new Database(dbPath, { create: true });
  db.run(`
    CREATE TABLE IF NOT EXISTS darktrade_pages (
      code TEXT PRIMARY KEY,
      page INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const upsert = db.prepare(`
    INSERT INTO darktrade_pages (code, page, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      page = excluded.page,
      updated_at = excluded.updated_at
    WHERE excluded.page != darktrade_pages.page
  `);

  return {
    async getPage(code) {
      const row = db
        .query(`SELECT page FROM darktrade_pages WHERE code = ?`)
        .get(code) as { page: number } | null;
      return row ? row.page : null;
    },
    async setPage(code, page) {
      if (page < 1) return false;
      const now = Date.now();
      const res = upsert.run(code, page, now);
      return res.changes > 0;
    },
    async setPages(map) {
      const entries = Object.entries(map).filter(([, p]) => p >= 1);
      if (entries.length === 0) return 0;
      const now = Date.now();
      let changed = 0;
      db.transaction((rows: [string, number][]) => {
        for (const [code, page] of rows) {
          const res = upsert.run(code, page, now);
          if (res.changes > 0) changed++;
        }
      })(entries);
      return changed;
    },
    close() {
      db.close();
    },
  };
}

/** 内存降级实现（仅当前进程生命周期，不持久化） */
function createMemoryPageStore(): DarkTradePageStore {
  const pages = new Map<string, { page: number; updatedAt: number }>();
  return {
    async getPage(code) {
      return pages.get(code)?.page ?? null;
    },
    async setPage(code, page) {
      if (page < 1) return false;
      const cur = pages.get(code);
      if (cur && cur.page === page) return false;
      pages.set(code, { page, updatedAt: Date.now() });
      return true;
    },
    async setPages(map) {
      let changed = 0;
      for (const [code, page] of Object.entries(map)) {
        if (await this.setPage(code, page)) changed++;
      }
      return changed;
    },
    close() {
      pages.clear();
    },
  };
}

let storePromise: Promise<DarkTradePageStore> | null = null;

/** 获取页码存储单例（惰性初始化：bun:sqlite → 内存降级） */
export function getDarkTradePageStore(): Promise<DarkTradePageStore> {
  if (!storePromise) {
    const dbPath = resolveDbPath();
    if (dbPath) {
      storePromise = createSqlitePageStore(dbPath).catch(() => createMemoryPageStore());
    } else {
      storePromise = Promise.resolve(createMemoryPageStore());
    }
  }
  return storePromise;
}

/** 测试用：使用指定数据库文件构建独立实例（不进入单例） */
export function createDarkTradePageStoreForTest(dbPath: string): Promise<DarkTradePageStore> {
  return createSqlitePageStore(dbPath);
}
