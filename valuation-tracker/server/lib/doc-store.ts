/**
 * 调研数据存储后端抽象 — 研究文档（Markdown 笔记 / deep-read / 年报原文 / 初筛 JSON）
 *
 * 三种实现，由 openDocStore() 按环境自动选择（探测链）：
 *   - FsDocStore      ：直读仓库根 Research/（dev / 自托管默认，改笔记即时生效）
 *   - SqliteDocStore  ：只读构建期产物 research-data/research.db（Vercel 函数包，内容 gzip 压缩）
 *                       Node 环境（Vercel 22.13+/24）用内置 node:sqlite（零依赖）；
 *                       Bun / 旧 Node 回退 @libsql client file:（懒加载）。
 *   - TursoDocStore   ：云上无打包 DB 时降级读取 Turso（复用 TURSO_URL，需先经 sync-data --remote 完成 seed）。
 *
 * 与动态状态层（server/lib/db.ts 的 price_snapshots / fundamental_checks）职责分离：
 * 本模块只服务「研究文档」读取，不触碰 tracker.db / Turso 的动态状态表。
 * 所有相对路径统一为 POSIX 分隔符（"/"），保证 Windows 本地与 Vercel Linux 行为一致。
 * 接口统一异步。
 *
 * 重要：本模块**不静态导入 @libsql/client**（其 Node 入口会静态拉起 ws 传输层与原生 libsql 绑定，
 * 在 Vercel standalone 打包中会被裁剪导致 ERR_MODULE_NOT_FOUND）。@libsql 仅以动态 import 懒加载，
 * 只用于 Turso 兜底与 Bun 测试回退；主路径（打包 research.db）在 Node 上走内置 node:sqlite。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
// 仅类型导入（编译期擦除，不产生运行时依赖）
import type { Client, Value } from "@libsql/client";

export type DocKind = "note" | "deep-read" | "annual-report" | "screener";

export interface DocRead {
  content: string;
  sizeBytes: number;
}

export interface DocStore {
  describe(): {
    kind: "fs" | "sqlite" | "turso";
    root?: string;
    dbFile?: string;
    generatedAt?: string | null;
    fileCount?: number;
  };
  /** 10-Knowledge 下全部 .md 相对路径（公司笔记 + deep-dive-update） */
  listNotePaths(): Promise<string[]>;
  /** 读原始文本（sqlite 实现内部 gunzip）；不存在返回 null */
  readFile(relPath: string): Promise<string | null>;
  /** 02-Processing 根目录下 deep-read 文件名列表 */
  listDeepReadPaths(): Promise<string[]>;
  /** pdf-texts/<公司名>/ 下年报原文文件名列表 */
  listAnnualReportPaths(name: string): Promise<string[]>;
  /** 文档原始字节数（列表用，不读正文） */
  docSize(kind: "deep-read" | "annual-report", name: string, fileName: string): Promise<number>;
  /** 读文档正文（fileName 含路径分隔符一律拒绝，防目录穿越） */
  readDoc(kind: "deep-read" | "annual-report", name: string, fileName: string): Promise<DocRead | null>;
  /** latest-screener.json 原文 */
  readScreenerJson(): Promise<string | null>;
  /** 释放底层资源（sqlite 关闭连接；fs 空操作）。测试/生命周期收尾用。 */
  close(): void;
}

const posix = (p: string): string => p.split("\\").join("/");

// ===== 目录常量（相对 Research 根的路径）=====

const NOTES_BASE = "Research/10-Knowledge";
const PROCESSING_BASE = "Research/00-Workspace/02-Processing";
const SCREENER_REL = "Research/00-Workspace/07-Screener/latest-screener.json";

// ===== FsDocStore：dev / 自托管直读仓库 =====

export function createFsDocStore(root: string): DocStore {
  const abs = (rel: string): string => join(root, rel);
  const noteBase = join(root, NOTES_BASE);
  const processDir = join(root, PROCESSING_BASE);

  const docPath = (kind: "deep-read" | "annual-report", name: string, fileName: string): string | null => {
    if (basename(fileName) !== fileName) return null; // 禁止路径穿越
    if (kind === "deep-read") return join(processDir, fileName);
    return join(processDir, "pdf-texts", name, fileName);
  };

  return {
    describe: () => ({ kind: "fs", root }),

    async listNotePaths(): Promise<string[]> {
      const out: string[] = [];
      if (!existsSync(noteBase)) return out;
      for (const industry of readdirSync(noteBase)) {
        const researchDir = join(noteBase, industry, "02-公司研究");
        if (!existsSync(researchDir)) continue;
        for (const f of readdirSync(researchDir)) {
          if (!f.endsWith(".md")) continue;
          out.push(posix(join(NOTES_BASE, industry, "02-公司研究", f)));
        }
      }
      return out;
    },

    async readFile(relPath: string): Promise<string | null> {
      const p = abs(relPath);
      if (!existsSync(p)) return null;
      return readFileSync(p, "utf-8");
    },

    async listDeepReadPaths(): Promise<string[]> {
      if (!existsSync(processDir)) return [];
      return readdirSync(processDir).filter((f) => /\.md$/i.test(f) && f.includes("deep-read"));
    },

    async listAnnualReportPaths(name: string): Promise<string[]> {
      const dir = join(processDir, "pdf-texts", name);
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f));
    },

    async docSize(kind, name, fileName): Promise<number> {
      const p = docPath(kind, name, fileName);
      if (!p || !existsSync(p)) return 0;
      return statSync(p).size;
    },

    async readDoc(kind, name, fileName): Promise<DocRead | null> {
      const p = docPath(kind, name, fileName);
      if (!p || !existsSync(p)) return null;
      return { content: readFileSync(p, "utf-8"), sizeBytes: statSync(p).size };
    },

    async readScreenerJson(): Promise<string | null> {
      const p = abs(SCREENER_REL);
      if (!existsSync(p)) return null;
      return readFileSync(p, "utf-8");
    },

    close(): void {
      // fs 模式无持有资源
    },
  };
}

// ===== 共享工具 =====

/** BLOB 列统一转为 Buffer（node:sqlite / @libsql 对 BLOB 返回 Uint8Array，兼容 ArrayBuffer / Buffer） */
function toBuffer(v: unknown): Buffer | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (v instanceof ArrayBuffer) return Buffer.from(new Uint8Array(v));
  if (typeof v === "string") return Buffer.from(v, "base64"); // 兜底：个别驱动以 base64 返回
  return null;
}

const gunzip = (v: unknown): string => {
  const buf = toBuffer(v);
  if (!buf) return "";
  return gunzipSync(buf).toString("utf-8");
};

/** 文档相对路径（kind + fileName 校验，防目录穿越），跨后端统一 */
function docRelPath(kind: "deep-read" | "annual-report", name: string, fileName: string): string | null {
  if (basename(fileName) !== fileName) return null; // 禁止路径穿越
  if (kind === "deep-read") return posix(join(PROCESSING_BASE, fileName));
  return posix(join(PROCESSING_BASE, "pdf-texts", name, fileName));
}

interface ClientDocMeta {
  dbFile?: string;
  generatedAt?: string | null;
  fileCount?: number;
}

/** 读取 research.db 同目录 manifest.json 的元数据（同步，describe 保持同步） */
function readManifestMeta(dbFile: string): ClientDocMeta {
  let generatedAt: string | null = null;
  let fileCount: number | undefined;
  try {
    const manifestPath = join(resolve(dbFile, ".."), "manifest.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        generatedAt?: string;
        files?: Record<string, number>;
      };
      generatedAt = manifest.generatedAt ?? null;
      if (manifest.files) fileCount = Object.values(manifest.files).reduce((a, b) => a + (b || 0), 0);
    }
  } catch {
    generatedAt = null;
  }
  return { dbFile, generatedAt, fileCount };
}

// ===== node:sqlite 后端（Vercel Node 22.13+/24 主路径，零依赖） =====

/** node:sqlite 最小类型面（避免依赖 @types/node 是否包含 node:sqlite 声明） */
interface NodeSqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
}
interface NodeSqliteDatabase {
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}
interface NodeSqliteModule {
  DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => NodeSqliteDatabase;
}

/** 同步探测 node:sqlite 是否可用（Node 22.3+ 提供 process.getBuiltinModule；Bun 无） */
function getNodeSqlite(): NodeSqliteModule | null {
  try {
    const getBuiltinModule = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    const mod = getBuiltinModule?.("node:sqlite");
    return (mod as NodeSqliteModule | undefined) ?? null;
  } catch {
    return null;
  }
}

function createNodeSqliteDocStore(dbFile: string, meta: ClientDocMeta, module: NodeSqliteModule): DocStore {
  const db = new module.DatabaseSync(dbFile, { readOnly: true });

  const queryPaths = (sql: string, args: unknown[]): string[] =>
    db.prepare(sql).all(...args).map((r) => String(r.path));

  return {
    describe: () => ({ kind: "sqlite", dbFile: meta.dbFile, generatedAt: meta.generatedAt, fileCount: meta.fileCount }),

    async listNotePaths(): Promise<string[]> {
      return queryPaths(`SELECT path FROM documents WHERE kind = ? ORDER BY path`, ["note"]);
    },

    async readFile(relPath: string): Promise<string | null> {
      const row = db.prepare(`SELECT content FROM documents WHERE path = ?`).get(relPath);
      if (!row) return null;
      return gunzip(row.content);
    },

    async listDeepReadPaths(): Promise<string[]> {
      return queryPaths(`SELECT path FROM documents WHERE kind = ? ORDER BY path`, ["deep-read"])
        .map((p) => basename(p));
    },

    async listAnnualReportPaths(name: string): Promise<string[]> {
      const prefix = `${PROCESSING_BASE}/pdf-texts/${name}/`;
      return queryPaths(
        `SELECT path FROM documents WHERE kind = ? AND path LIKE ? ORDER BY path`,
        ["annual-report", `${prefix}%`],
      ).map((p) => p.slice(prefix.length));
    },

    async docSize(kind, name, fileName): Promise<number> {
      const rel = docRelPath(kind, name, fileName);
      if (!rel) return 0;
      const row = db.prepare(`SELECT raw_size FROM documents WHERE path = ?`).get(rel);
      if (!row) return 0;
      return Number(row.raw_size ?? 0);
    },

    async readDoc(kind, name, fileName): Promise<DocRead | null> {
      const rel = docRelPath(kind, name, fileName);
      if (!rel) return null;
      const row = db.prepare(`SELECT content, raw_size FROM documents WHERE path = ?`).get(rel);
      if (!row) return null;
      return { content: gunzip(row.content), sizeBytes: Number(row.raw_size ?? 0) };
    },

    async readScreenerJson(): Promise<string | null> {
      const row = db
        .prepare(`SELECT content FROM documents WHERE kind = ? AND path LIKE ? ORDER BY path DESC LIMIT 1`)
        .get("screener", "%latest-screener.json");
      if (!row) return null;
      return gunzip(row.content);
    },

    close(): void {
      db.close();
    },
  };
}

// ===== @libsql client 后端（Turso 兜底 / Bun 测试回退；懒加载，主路径不引入 ws） =====

/** 基于懒获取的 @libsql/client 连接的文档存储实现（file: 本地库与 https/wss: Turso 同一套 SQL） */
function createLibsqlDocStore(
  getClient: () => Promise<Client>,
  kind: "sqlite" | "turso",
  meta: ClientDocMeta,
): DocStore {
  const queryPaths = async (sql: string, args: Value[]): Promise<string[]> =>
    (await (await getClient()).execute({ sql, args })).rows.map((r) => String(r.path));

  return {
    describe: () => ({ kind, dbFile: meta.dbFile, generatedAt: meta.generatedAt, fileCount: meta.fileCount }),

    async listNotePaths(): Promise<string[]> {
      return queryPaths(`SELECT path FROM documents WHERE kind = ? ORDER BY path`, ["note"]);
    },

    async readFile(relPath: string): Promise<string | null> {
      const r = await (await getClient()).execute({ sql: `SELECT content FROM documents WHERE path = ?`, args: [relPath] });
      if (r.rows.length === 0) return null;
      return gunzip(r.rows[0].content);
    },

    async listDeepReadPaths(): Promise<string[]> {
      return queryPaths(`SELECT path FROM documents WHERE kind = ? ORDER BY path`, ["deep-read"]).then((paths) =>
        paths.map((p) => basename(p)),
      );
    },

    async listAnnualReportPaths(name: string): Promise<string[]> {
      const prefix = `${PROCESSING_BASE}/pdf-texts/${name}/`;
      const paths = await queryPaths(
        `SELECT path FROM documents WHERE kind = ? AND path LIKE ? ORDER BY path`,
        ["annual-report", `${prefix}%`],
      );
      return paths.map((p) => p.slice(prefix.length));
    },

    async docSize(kind, name, fileName): Promise<number> {
      const rel = docRelPath(kind, name, fileName);
      if (!rel) return 0;
      const r = await (await getClient()).execute({
        sql: `SELECT raw_size FROM documents WHERE path = ?`,
        args: [rel],
      });
      if (r.rows.length === 0) return 0;
      return Number(r.rows[0].raw_size ?? 0);
    },

    async readDoc(kind, name, fileName): Promise<DocRead | null> {
      const rel = docRelPath(kind, name, fileName);
      if (!rel) return null;
      const r = await (await getClient()).execute({
        sql: `SELECT content, raw_size FROM documents WHERE path = ?`,
        args: [rel],
      });
      if (r.rows.length === 0) return null;
      const row = r.rows[0];
      return { content: gunzip(row.content), sizeBytes: Number(row.raw_size ?? 0) };
    },

    async readScreenerJson(): Promise<string | null> {
      const r = await (await getClient()).execute({
        sql: `SELECT content FROM documents WHERE kind = ? AND path LIKE ? ORDER BY path DESC LIMIT 1`,
        args: ["screener", "%latest-screener.json"],
      });
      if (r.rows.length === 0) return null;
      return gunzip(r.rows[0].content);
    },

    close(): void {
      void getClient().then((c) => c.close());
    },
  };
}

/** 懒加载 @libsql/client（动态 import，避免主路径静态引入其 ws/原生绑定链） */
function loadLibsqlClient(url: string, authToken?: string): () => Promise<Client> {
  let client: Client | null = null;
  return async () => {
    if (!client) {
      const { createClient } = await import("@libsql/client");
      client = createClient({ url, authToken });
    }
    return client;
  };
}

// ===== 工厂（对外） =====

/** Vercel 函数包内只读 research.db（构建期产物）：Node 用内置 node:sqlite，Bun/旧 Node 回退 @libsql file: */
export function createSqliteDocStore(dbFile: string): DocStore {
  const meta = readManifestMeta(dbFile);
  const nodeSqlite = getNodeSqlite();
  if (nodeSqlite) {
    return createNodeSqliteDocStore(dbFile, meta, nodeSqlite);
  }
  // Bun / 无 node:sqlite 环境 → @libsql file:（懒加载；dev 自托管不经过此路径，仅测试/部署兜底）
  return createLibsqlDocStore(loadLibsqlClient(`file:${posix(dbFile)}`), "sqlite", meta);
}

/** Turso（libSQL 远端）只读研究文档 — 云上无打包 research.db 时的自动降级；复用 TURSO_URL / TURSO_AUTH_TOKEN */
export function createTursoDocStore(url: string, authToken?: string): DocStore {
  // 远端无本地 manifest，generatedAt / fileCount 不展示（不影响功能）
  return createLibsqlDocStore(loadLibsqlClient(url, authToken), "turso", {});
}

// ===== 根目录探测 + 单例 =====

const DB_FILENAME = "research.db";

/** 探测 FS 模式仓库根（存在 Research/10-Knowledge 即命中） */
function resolveResearchRootFs(): string | null {
  const dataDir = process.env.RESEARCH_DATA_DIR || "research-data";
  const env = process.env.RESEARCH_ROOT;
  const candidates = env
    ? [resolve(process.cwd(), env)]
    : [
        resolve(process.cwd(), ".."),                        // 本地仓库根（真实数据）
        resolve(process.cwd(), dataDir),                     // research-data（旧文件树兼容兜底）
        resolve(process.cwd(), ".next", dataDir),            // standalone 输出
        resolve(process.cwd(), ".next", "server", dataDir),  // Vercel serverless 函数包层级
      ];
  for (const c of candidates) {
    try {
      if (existsSync(join(c, "Research", "10-Knowledge"))) return c;
    } catch {
      // 探测失败继续下一候选
    }
  }
  return null;
}

/** 探测构建期产物 research.db（Vercel 函数包） */
function resolveResearchDbFile(): string | null {
  const dataDir = process.env.RESEARCH_DATA_DIR || "research-data";
  const env = process.env.RESEARCH_ROOT;
  const candidates = env
    ? [resolve(process.cwd(), env)]
    : [
        resolve(process.cwd(), dataDir),
        resolve(process.cwd(), ".next", dataDir),
        resolve(process.cwd(), ".next", "server", dataDir),
      ];
  for (const c of candidates) {
    try {
      const db = join(c, DB_FILENAME);
      if (existsSync(db)) return db;
    } catch {
      // 探测失败继续下一候选
    }
  }
  return null;
}

function createDocStore(): DocStore {
  // 探测链：FS（dev/自托管，改笔记即时生效）→ 打包 research.db（无网络）→ Turso（云上兜底）→ FS 兜底
  const fsRoot = resolveResearchRootFs();
  if (fsRoot) return createFsDocStore(fsRoot);

  const dbFile = resolveResearchDbFile();
  if (dbFile) {
    try {
      return createSqliteDocStore(dbFile);
    } catch (e) {
      console.warn(`[doc-store] 打开 ${dbFile} 失败，尝试 Turso/FS 降级：`, (e as Error).message);
    }
  }

  // 复用动态状态层 TURSO_URL / TURSO_AUTH_TOKEN 约定；需先经 bun run sync-data --remote 完成 seed
  const tursoUrl = process.env.TURSO_URL;
  if (tursoUrl) {
    try {
      return createTursoDocStore(tursoUrl, process.env.TURSO_AUTH_TOKEN);
    } catch (e) {
      console.warn(`[doc-store] 连接 Turso 失败，降级 FS 模式：`, (e as Error).message);
    }
  }

  const env = process.env.RESEARCH_ROOT;
  return createFsDocStore(env ? resolve(process.cwd(), env) : resolve(process.cwd(), ".."));
}

let docStore: DocStore | null = null;

/** 获取调研数据存储单例 */
export function openDocStore(): DocStore {
  return (docStore ??= createDocStore());
}
