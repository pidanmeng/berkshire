/**
 * 存储单例 — 根据环境选择实现（惰性异步初始化）：
 *   TURSO_URL 存在 → Turso（Serverless 部署）
 *   否则 → bun:sqlite（本地 / 持久主机）
 *   SQLite 初始化失败（Node 运行环境无 bun:sqlite / 纯 Serverless 无文件系统）→ 内存降级
 * 使用：const db = await getDb(); 然后调用 db.saveSnapshot(...) 等。
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import { createMemoryStore } from "./store.ts";
import { createTursoStore } from "./store-turso.ts";

function resolveDbPath(): string | null {
  try {
    const dataDir = join(process.cwd(), "data");
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    return join(dataDir, "tracker.db");
  } catch {
    return null; // 无文件系统（Serverless）
  }
}

async function createStore(): Promise<Store> {
  const tursoUrl = process.env.TURSO_URL;
  if (tursoUrl) {
    try {
      return createTursoStore(tursoUrl, process.env.TURSO_AUTH_TOKEN);
    } catch {
      // fallthrough → sqlite/memory
    }
  }
  const dbPath = resolveDbPath();
  if (dbPath) {
    try {
      const { createSqliteStore } = await import("./store-sqlite.ts");
      return await createSqliteStore(dbPath);
    } catch {
      // Node 运行环境（如 Vercel）无 bun:sqlite → 内存降级
    }
  }
  return createMemoryStore();
}

let storePromise: Promise<Store> | null = null;

/** 获取存储单例（首次调用时初始化） */
export function getDb(): Promise<Store> {
  return (storePromise ??= createStore());
}
