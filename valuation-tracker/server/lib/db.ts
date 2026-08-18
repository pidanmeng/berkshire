/**
 * 存储单例 — 根据环境选择实现（惰性异步初始化）：
 *   本地 / 自托管（Bun + 可写文件系统）→ 优先 bun:sqlite（data/tracker.db）
 *   Turso（远程 HTTP）仅在以下情况启用：
 *     - 显式 FORCE_TURSO=1；或
 *     - Serverless 环境（VERCEL）或本地文件系统不可用
 *   否则 → 内存降级
 * 背景：2026-08 修复 — 之前 TURSO_URL 优先导致本地 dev 全量 DB 走远程 HTTP，
 * 连接被重置时抛 ECONNRESET（/api/companies、/api/messages 500，耗时 10-25s）。
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

/** 是否处于 Serverless / 无本地文件系统环境（该环境才应使用 Turso） */
function preferTurso(dbPath: string | null): boolean {
  if (process.env.FORCE_TURSO === "1") return true;
  if (process.env.VERCEL) return true;
  if (dbPath === null) return true; // 本地文件系统不可用 → Turso 兜底
  return false;
}

async function createStore(): Promise<Store> {
  const dbPath = resolveDbPath();
  const tursoUrl = process.env.TURSO_URL;

  // 本地优先：Bun 运行时 + 可写文件系统 → bun:sqlite（无需网络）
  if (dbPath && !preferTurso(dbPath)) {
    try {
      const { createSqliteStore } = await import("./store-sqlite.ts");
      return await createSqliteStore(dbPath);
    } catch {
      // sqlite 初始化失败 → 继续尝试 Turso / 内存降级
    }
  }

  if (tursoUrl) {
    try {
      return createTursoStore(tursoUrl, process.env.TURSO_AUTH_TOKEN);
    } catch {
      // fallthrough → memory
    }
  }

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
