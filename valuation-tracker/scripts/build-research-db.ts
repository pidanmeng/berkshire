/**
 * 构建期生成研究数据 SQLite 库 — research-data/research.db（可选同步到 Turso）
 *
 * 背景：Vercel Function 打包产物体积受限（未压缩 250 MB / 压缩 ~50 MB）。
 * 原方案（sync-research-data.ts）把 Markdown 文件树整体复制到 research-data/ 随包上传，
 * 文件多（~270）、体积大（~65 MB）且随调研公司数持续增长。
 * 本脚本改为把同一批数据 gzip(level 9) 压缩后写入单文件 research.db（实测 ~18 MB / 1 文件），
 * 运行时（Vercel）由 server/lib/doc-store.ts 的 SqliteDocStore 只读；dev / 自托管仍直读 ../Research。
 *
 * --remote 模式：在生成本地库后，把同一批条目 upsert 到 Turso（复用动态状态层 TURSO_URL / TURSO_AUTH_TOKEN 约定），
 * 供云上函数包未携带 research.db 时的自动降级读取（doc-store 探测链：FS → 打包 DB → Turso）。
 *
 * 与旧脚本一致的兼容约定（分两种部署形态）：
 *   - Git 集成 / 仓库根上传：构建环境存在 ../Research，云端 build 现场重建 research.db 并同步 Turso；
 *   - CLI 从 valuation-tracker/ 目录上传：构建环境无 ../Research，**早退**保留本地上传的 research-data/
 *     （早退必须发生在删除/重建之前，避免误删部署产物）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createClient } from "@libsql/client";

// 标准 ESM 定位脚本目录（不用 Bun 专有的 import.meta.dir，保证 Next/Vercel 类型检查通过）
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");      // valuation-tracker/scripts → 仓库根
const DEFAULT_RESEARCH_SRC = join(REPO_ROOT, "Research");
const DEFAULT_DEST_DIR = resolve(__dirname, "..", "research-data"); // valuation-tracker/research-data

export type DocKind = "note" | "deep-read" | "annual-report" | "screener";

/** 已 gzip 压缩的文档条目（本地 research.db 与 Turso 共用同一份数据） */
export interface ResearchDocEntry {
  kind: DocKind;
  rel: string;      // 相对 research-data 的 POSIX 路径（跨平台统一用 "/"）
  gz: Buffer;       // gzip(content, level 9)
  rawSize: number;  // 原始字节数
  mtime: string;    // 源文件修改时间（ISO）
}

export interface BuildResult {
  dbPath: string;
  fileCount: number;
  byKind: Record<DocKind, number>;
  rawBytes: number;
  compressedBytes: number;
  entries: ResearchDocEntry[];
}

/** 相对路径统一为 POSIX 分隔符（Vercel Linux 与 Windows 本地行为一致） */
const posix = (p: string): string => p.split("\\").join("/");

function walk(dir: string, out: string[]): void {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

/** 收集某范围内满足 predicate 的文件为 DB 条目（读取时即完成 gzip） */
function collect(
  entries: ResearchDocEntry[],
  srcDir: string,
  destBase: string, // 相对 research-data 的目标前缀（POSIX）
  kind: DocKind,
  predicate: (name: string) => boolean,
): void {
  if (!existsSync(srcDir)) return;
  const files: string[] = [];
  walk(srcDir, files);
  for (const p of files) {
    const name = p.split(/[\\/]/).pop() ?? "";
    if (!predicate(name)) continue;
    const st = statSync(p);
    const content = readFileSync(p);
    entries.push({
      kind,
      rel: posix(join(destBase, posix(relative(srcDir, p)))),
      gz: gzipSync(content, { level: 9 }),
      rawSize: content.length,
      mtime: st.mtime.toISOString(),
    });
  }
}

/**
 * documents 表结构（本地 research.db 与 Turso 完全一致，运行时 DocStore 同一套 SQL）。
 * 注意：Turso（libsql 远端）单次 execute 只允许一条语句，建表与建索引必须分开执行。
 */
const CREATE_DOCUMENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS documents (
    id       INTEGER PRIMARY KEY,
    kind     TEXT NOT NULL,
    path     TEXT NOT NULL UNIQUE,
    content  BLOB NOT NULL,
    raw_size INTEGER NOT NULL,
    mtime    TEXT
  );
`;
const CREATE_DOCUMENTS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_docs_kind ON documents(kind);
`;

/**
 * 构建研究数据库（可注入路径，便于测试与未来扩展）
 * @returns 统计信息与条目；researchSrc 不存在时返回 null 且**不触碰** destDir（兼容 Vercel 云端构建）
 */
export async function buildResearchDb(opts: {
  researchSrc: string;
  destDir: string;
}): Promise<BuildResult | null> {
  const { researchSrc, destDir } = opts;
  if (!existsSync(researchSrc)) {
    console.warn(`[build-research-db] 未找到 ${researchSrc}，跳过入库（保留已上传的 research-data/）`);
    return null;
  }

  const entries: ResearchDocEntry[] = [];

  // 同步范围与旧 sync-research-data.ts 保持一致（与后端读取路径对应）：
  //   1. 10-Knowledge 全量 .md（公司笔记 + deep-dive-update）
  //   2. 02-Processing 根目录 *deep-read*.md（年报精读）
  //   3. 02-Processing/pdf-texts 下 *.md / *.txt（年报原文）
  //   4. 07-Screener 下 *.json（全市场初筛看板）
  collect(entries, join(researchSrc, "10-Knowledge"), "Research/10-Knowledge", "note",
    (f) => f.endsWith(".md"));
  collect(entries, join(researchSrc, "00-Workspace", "02-Processing"),
    "Research/00-Workspace/02-Processing", "deep-read",
    (f) => f.endsWith(".md") && f.includes("deep-read"));
  collect(entries, join(researchSrc, "00-Workspace", "02-Processing", "pdf-texts"),
    "Research/00-Workspace/02-Processing/pdf-texts", "annual-report",
    (f) => /\.(md|txt)$/i.test(f));
  collect(entries, join(researchSrc, "00-Workspace", "07-Screener"),
    "Research/00-Workspace/07-Screener", "screener",
    (f) => f.endsWith(".json"));

  // 清空目标目录后重建（与旧 sync-research-data.ts「先删后建」一致）：
  // 残留的旧文件树若不清除，会被 .vercelignore 白名单上传并打包进函数，违背压缩入库的初衷。
  // 注意：researchSrc 缺失时的早退在上方，此处不会误删已上传的部署产物。
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const dbPath = join(destDir, "research.db");

  // bun:sqlite 仅 Bun 运行时有类型声明，改为函数内动态 import（本脚本仅由 bun 执行，Next/Vercel 不打包）
  // @ts-ignore bun:sqlite 仅 Bun 运行时存在
  const { Database } = await import("bun:sqlite");
  // 直接重建目标库（与旧 sync-research-data.ts「先删后建」语义一致；
  // 先写 .tmp 再 rename 在 Windows 下会因文件句柄未释放报 EBUSY）
  rmSync(dbPath, { force: true });
  const db = new Database(dbPath, { create: true });
  db.exec(`DROP TABLE IF EXISTS documents;`);
  db.exec(CREATE_DOCUMENTS_TABLE_SQL);
  db.exec(CREATE_DOCUMENTS_INDEX_SQL);

  const ins = db.prepare(
    `INSERT OR REPLACE INTO documents (kind, path, content, raw_size, mtime) VALUES (?, ?, ?, ?, ?)`,
  );
  const byKind: Record<DocKind, number> = { note: 0, "deep-read": 0, "annual-report": 0, screener: 0 };
  let rawBytes = 0;
  let compressedBytes = 0;

  db.exec("BEGIN");
  for (const e of entries) {
    ins.run(e.kind, e.rel, e.gz, e.rawSize, e.mtime);
    byKind[e.kind] += 1;
    rawBytes += e.rawSize;
    compressedBytes += e.gz.length;
  }
  db.exec("COMMIT");
  db.close();

  // manifest.json：部署后排查（生成时间 / 各类型计数 / 体积）
  writeFileSync(
    join(destDir, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dbFile: "research.db",
        sourceRoot: researchSrc,
        files: byKind,
        bytes: { raw: rawBytes, compressed: compressedBytes },
        note: "构建期由 scripts/build-research-db.ts 生成；运行时经 server/lib/doc-store.ts 只读（dev/自托管直读 ../Research；--remote 可同步到 Turso 兜底）",
      },
      null,
      2,
    ),
  );

  const pct = rawBytes > 0 ? Math.round((compressedBytes / rawBytes) * 100) : 0;
  console.log(
    `[build-research-db] 完成：${entries.length} 文件，raw ${(rawBytes / 1e6).toFixed(1)} MB → ${dbPath}（${(compressedBytes / 1e6).toFixed(1)} MB，${pct}%）`,
  );
  return { dbPath, fileCount: entries.length, byKind, rawBytes, compressedBytes, entries };
}

/**
 * 把同一批条目 upsert 到 Turso（复用动态状态层 TURSO_URL / TURSO_AUTH_TOKEN 约定）。
 * 表结构与本地 research.db 一致，运行时 doc-store 的 TursoDocStore 用同一套 SQL 读取。
 */
export async function syncResearchToTurso(
  entries: ResearchDocEntry[],
  opts: { url: string; authToken?: string },
): Promise<{ inserted: number; compressedBytes: number }> {
  const client = createClient({ url: opts.url, authToken: opts.authToken });
  try {
    // 单次 execute 只允许一条语句（Turso 远端限制），建表/建索引分开执行
    await client.execute(CREATE_DOCUMENTS_TABLE_SQL);
    await client.execute(CREATE_DOCUMENTS_INDEX_SQL);
    // 全量重建语义（与本地库「先删后建」一致，幂等）
    await client.execute(`DELETE FROM documents;`);
    // 分批原子批量写入，避开 Turso 单请求大小限制
    const BATCH_SIZE = 50;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      await client.batch(
        chunk.map((e) => ({
          sql: `INSERT INTO documents (kind, path, content, raw_size, mtime) VALUES (?, ?, ?, ?, ?)`,
          args: [e.kind, e.rel, e.gz, e.rawSize, e.mtime],
        })),
      );
    }
    const compressedBytes = entries.reduce((sum, e) => sum + e.gz.length, 0);
    return { inserted: entries.length, compressedBytes };
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  const remote = process.argv.includes("--remote");
  const result = await buildResearchDb({ researchSrc: DEFAULT_RESEARCH_SRC, destDir: DEFAULT_DEST_DIR });
  if (!result) return;
  if (!remote) return;

  const url = process.env.TURSO_URL;
  if (!url) {
    console.warn("[build-research-db] 已指定 --remote 但未设置 TURSO_URL，跳过 Turso 同步（本地 research.db 不受影响）");
    return;
  }
  try {
    const { inserted, compressedBytes } = await syncResearchToTurso(result.entries, {
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    console.log(`[build-research-db] Turso 同步完成：${inserted} 条（${(compressedBytes / 1e6).toFixed(1)} MB）`);
  } catch (e) {
    // 已配置 TURSO_URL 却同步失败不应静默：本地 research.db 已生成，但云上兜底会停留在旧数据。
    // 置 exit code 1 使打包流程（build 已绑定 sync-data:remote）尽早暴露问题，修复后重跑即可。
    console.error(`[build-research-db] Turso 同步失败（本地 research.db 已生成，兜底数据未更新）：`, (e as Error).message);
    process.exitCode = 1;
  }
}

// Bun 专有属性：直接执行（bun run scripts/build-research-db.ts）时为 true；被测试 import 时为 false
const isMain = (import.meta as unknown as { main?: boolean }).main === true;
if (isMain) await main();
