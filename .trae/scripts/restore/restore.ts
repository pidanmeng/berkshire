#!/usr/bin/env bun
/**
 * restore.ts — 投研 vault 一键还原（清理全部旧产出）
 *
 * 背景：投研流程更新较大，之前的数据（中间产物 / 知识节点 / 报告）已过期，
 *       用本脚本把 Research 下所有旧产出清空，并重建标准目录骨架。
 *
 * 用法（在仓库根目录 c:\Code\投研 下执行）:
 *   bun run .trae/scripts/restore/restore.ts                 # dry-run：只列出将被清理的文件
 *   bun run .trae/scripts/restore/restore.ts --yes           # 正式执行：全部备份并压缩为 .zip（默认不动 99-Templates/.gitkeep）
 *   bun run .trae/scripts/restore/restore.ts --yes --purge   # 不备份，直接永久删除
 *   bun run .trae/scripts/restore/restore.ts --yes --tracker # 同时重置 valuation-tracker/data/tracker.db
 *   bun run .trae/scripts/restore/restore.ts --yes --backup "D:/restore-bak"  # 自定义备份目录
 *   bun run .trae/scripts/restore/restore.ts --zip-existing  # 仅把 .restore-backup/ 下未压缩备份压缩为 .zip 并删除原目录（不清理由产出）
 *
 * 备份说明（--yes 且非 --purge 时）:
 *   1) 本次清理文件先移入备份目录，再压缩为 .zip 后删除未压缩的备份目录；
 *      默认备份为 Research/.restore-backup/<时间戳>.zip（保留相对 Research 的目录结构，内含 manifest.json 清单）。
 *   2) 同时把历史遗留的未压缩备份目录一并压缩成 <名称>.zip 并删除原目录（幂等，已存在的 .zip 不再处理）。
 *
 * 清理范围（默认）:
 *   删除  Research/00-Workspace/**（01-Inbox / 02-Processing 含 pdf-texts / 03-Validation / 04-Archive / 05-Metrics / 06-Process-Improvement）
 *          Research/10-Knowledge/**（00-MOC 及全部行业知识节点）
 *          Research/20-Reports/**
 *          散落文件 Research/2026-08-04-算力租赁-知识入库整理摘要.md
 *   保留  Research/99-Templates/**（模板）、所有 .gitkeep（目录骨架）
 *   重建  标准三段式骨架（00-Workspace 各阶段 / 10-Knowledge 各行业 00-行业概览·01-细分行业·02-公司研究 / 20-Reports）
 *
 * --tracker 时额外把 valuation-tracker/data/tracker.db 一并清理（价格快照 / 基本面检测缓存）。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const ROOT = process.cwd();
export const DEFAULT_RESEARCH = join(ROOT, 'Research');
export const DEFAULT_TRACKER_DB = join(
  ROOT,
  'valuation-tracker',
  'data',
  'tracker.db',
);

/** 需要整体清空的 Workspace 阶段目录（含 pdf-texts 中间产物） */
export const WORKSPACE_SKELETON = [
  '00-Workspace/01-Inbox',
  '00-Workspace/02-Processing',
  '00-Workspace/02-Processing/pdf-texts',
  '00-Workspace/03-Validation',
  '00-Workspace/04-Archive',
  '00-Workspace/05-Metrics',
  '00-Workspace/06-Process-Improvement',
];

/** 行业三段式目录（AGENTS.md：00-行业概览 / 01-细分行业 / 02-公司研究） */
export const INDUSTRIES = ['99-宏观'];
export const THREE_TIER = ['00-行业概览', '01-细分行业', '02-公司研究'];
const MACRO_SUBS = ['全球经济', '财政政策', '货币政策'];

/** 标准骨架目录（相对 Research 根），清理后重建并写入 .gitkeep */
export function skeletonDirs(researchRoot: string): string[] {
  const dirs: string[] = [];
  for (const d of WORKSPACE_SKELETON) dirs.push(join(researchRoot, d));
  dirs.push(join(researchRoot, '10-Knowledge', '00-MOC'));
  // for (const ind of INDUSTRIES) {
  //   for (const tier of THREE_TIER) {
  //     dirs.push(join(researchRoot, '10-Knowledge', ind, tier));
  //   }
  // }
  for (const sub of MACRO_SUBS) {
    dirs.push(join(researchRoot, '10-Knowledge', '99-宏观', sub));
  }
  dirs.push(join(researchRoot, '20-Reports'));
  return dirs;
}

/** 递归收集目录下所有文件（不含 .gitkeep） */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile() && e.name !== '.gitkeep') out.push(p);
  }
  return out;
}

/**
 * 列出本次将被清理的文件（相对 researchRoot 的路径）。
 * 清理根 = 00-Workspace / 10-Knowledge / 20-Reports 全部非 .gitkeep 文件 + 散落文件。
 */
export function listFilesToClean(researchRoot: string): string[] {
  const roots = ['00-Workspace', '10-Knowledge', '20-Reports'].map((r) =>
    join(researchRoot, r),
  );
  const files = roots.flatMap(walkFiles);
  const loose = ['2026-08-04-算力租赁-知识入库整理摘要.md'].map((f) =>
    join(researchRoot, f),
  );
  for (const f of loose) if (existsSync(f)) files.push(f);
  return files;
}

/** 把文件移入备份目录（保留相对 Research 根的目录结构） */
export function moveToBackup(
  files: string[],
  researchRoot: string,
  backupDir: string,
): number {
  let moved = 0;
  for (const f of files) {
    const dest = join(
      backupDir,
      f.slice(researchRoot.length).replace(/^[\\/]/, ''),
    );
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(f, dest);
    moved++;
  }
  return moved;
}

/** 永久删除文件 */
export function purgeFiles(files: string[]): number {
  for (const f of files) rmSync(f, { force: true });
  return files.length;
}

/** 自底向上删除空目录（不删除 stop 本身） */
export function pruneEmptyDirs(dir: string, stop: string): number {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) removed += pruneEmptyDirs(join(dir, e.name), stop);
  }
  if (dir !== stop && readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

// ---------- 极简 ZIP 读写（无第三方依赖，Bun 1.2.x 无内置 zip API） ----------
// 采用 deflate（方法 8）+ UTF-8 文件名（通用标志位 0x0800），兼容 Windows 资源管理器 / bsdtar / unzip。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 时间 → ZIP 的 DOS 时间/日期（1980 年之前钳制为 0） */
function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(d.getFullYear() - 1980, 0);
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: ((y << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

/** 递归收集 dir 下所有文件（相对 dir 的路径，统一 / 分隔），含 .gitkeep */
function walkRelative(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile())
        out.push(p.slice(dir.length).replace(/^[\\/]/, '').replaceAll('\\', '/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/**
 * 把目录压缩为 zip（条目路径相对 dir）。不删除原目录。
 * @returns 写入的条目数
 */
export function zipDirectory(dir: string, zipPath: string): number {
  const files = walkRelative(dir);
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const rel of files) {
    const abs = join(dir, rel);
    const data = readFileSync(abs);
    const name = Buffer.from(rel, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const { time, date } = dosDateTime(statSync(abs).mtime);

    // 本地文件头
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // flags: UTF-8 文件名
    lh.writeUInt16LE(8, 8); // method: deflate
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28); // extra len
    local.push(lh, name, compressed);

    // 中央目录记录
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); // extra len
    ch.writeUInt16LE(0, 32); // comment len
    ch.writeUInt16LE(0, 34); // disk number
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42); // local header offset
    central.push(ch, name);

    offset += 30 + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  // 中央目录结束记录（EOCD）
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  writeFileSync(zipPath, Buffer.concat([...local, centralBuf, eocd]));
  return files.length;
}

/** 读取 zip 中央目录，返回全部条目名 */
export function listZipEntries(zipPath: string): string[] {
  const buf = readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`不是有效的 zip 文件: ${zipPath}`);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip 中央目录损坏');
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    names.push(buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** 提取 zip 内单个文本条目（内部校验用；仅支持 deflate/存储） */
export function readZipText(zipPath: string, entryName: string): string {
  const buf = readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`不是有效的 zip 文件: ${zipPath}`);
  let off = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  let targetOffset = -1;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip 中央目录损坏');
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    if (name === entryName) targetOffset = buf.readUInt32LE(off + 42);
    off += 46 + nameLen + extraLen + commentLen;
  }
  if (targetOffset < 0) throw new Error(`zip 中不存在条目: ${entryName}`);
  if (buf.readUInt32LE(targetOffset) !== 0x04034b50) throw new Error('zip 本地头损坏');
  const nameLen = buf.readUInt16LE(targetOffset + 26);
  const extraLen = buf.readUInt16LE(targetOffset + 28);
  const csize = buf.readUInt32LE(targetOffset + 18);
  const usize = buf.readUInt32LE(targetOffset + 22);
  const method = buf.readUInt16LE(targetOffset + 8);
  const data = buf.subarray(targetOffset + 30 + nameLen + extraLen, targetOffset + 30 + nameLen + extraLen + csize);
  const raw = method === 8 ? inflateRawSync(data) : data;
  if (raw.length !== usize) throw new Error('zip 条目解压尺寸不符');
  return raw.toString('utf8');
}

/**
 * 把备份根目录下所有未压缩的备份目录压缩为 <名称>.zip 并删除原目录（幂等）。
 * 已存在同名 .zip 时仅删除残留目录，不重复压缩。返回本次新生成的 zip 路径列表。
 */
export function zipExistingBackups(backupRootDir: string): string[] {
  if (!existsSync(backupRootDir)) return [];
  const zipped: string[] = [];
  const dirs = readdirSync(backupRootDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(backupRootDir, e.name))
    .sort();
  for (const d of dirs) {
    const zipPath = `${d}.zip`;
    if (existsSync(zipPath)) {
      // 已存在同名 zip（上次已压缩但目录未删干净）→ 仅清掉目录
      rmSync(d, { recursive: true, force: true });
      continue;
    }
    zipDirectory(d, zipPath);
    rmSync(d, { recursive: true, force: true });
    zipped.push(zipPath);
  }
  return zipped;
}

/** 重建标准骨架：mkdir -p + 补 .gitkeep */
export function ensureSkeleton(dirs: string[]): number {
  let created = 0;
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
    const keep = join(d, '.gitkeep');
    if (!existsSync(keep)) {
      writeFileSync(keep, '');
      created++;
    }
  }
  return created;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface RestoreResult {
  dryRun: boolean;
  purge: boolean;
  files: string[];
  /** 本次备份压缩后的 .zip 路径（无备份或 purge 时为 null） */
  backupDir: string | null;
  /** 历史遗留的未压缩备份目录 → 本次被压缩成的 .zip 路径列表 */
  zippedExisting: string[];
  trackerDbHandled: boolean;
}

/**
 * 核心执行逻辑（可单测）。researchRoot 必须存在。
 * yes=false → 只收集清单返回（dry-run），不做任何改动。
 * yes=true 且非 purge → 备份移入目录后压缩为 .zip 并删除未压缩目录；历史未压缩备份一并压缩删除。
 */
export async function runRestore(opts: {
  researchRoot: string;
  trackerDb?: string | null;
  purge?: boolean;
  backupRoot?: string | null;
  yes?: boolean;
}): Promise<RestoreResult> {
  const {
    researchRoot,
    trackerDb = null,
    purge = false,
    backupRoot = null,
    yes = false,
  } = opts;
  const files = listFilesToClean(researchRoot);
  const handleTracker = trackerDb ? existsSync(trackerDb) : false;
  const result: RestoreResult = {
    dryRun: !yes,
    purge,
    files,
    backupDir: null,
    zippedExisting: [],
    trackerDbHandled: false,
  };

  if (!yes) return result; // dry-run：不落盘

  // 默认备份根目录（历史备份也在此扫描）
  const backupRootDir =
    backupRoot ?? join(researchRoot, '.restore-backup');
  let backupDir: string | null = null;

  if (files.length > 0) {
    if (purge) {
      purgeFiles(files);
    } else {
      backupDir =
        backupRoot ?? join(backupRootDir, timestamp());
      mkdirSync(backupDir, { recursive: true });
      moveToBackup(files, researchRoot, backupDir);
      writeFileSync(
        join(backupDir, 'manifest.json'),
        JSON.stringify({ purged: false, movedAt: timestamp(), files }, null, 2),
      );
    }
  }

  // 重建骨架（先建 .gitkeep，再清理空目录，保证骨架目录不被误删）
  ensureSkeleton(skeletonDirs(researchRoot));
  for (const r of ['00-Workspace', '10-Knowledge', '20-Reports']) {
    pruneEmptyDirs(join(researchRoot, r), join(researchRoot, r));
  }

  let trackerHandled = false;
  if (handleTracker) {
    if (purge) {
      rmSync(trackerDb ?? '', { force: true });
    } else {
      const destDir = backupDir ?? backupRoot ?? join(backupRootDir, timestamp());
      mkdirSync(destDir, { recursive: true });
      renameSync(trackerDb ?? '', join(destDir, 'tracker.db'));
      if (!backupDir) backupDir = destDir;
    }
    trackerHandled = true;
  }
  result.trackerDbHandled = trackerHandled;

  // 备份压缩：本次备份目录 → .zip 后删除原目录；历史未压缩备份目录同样处理
  const zippedExisting: string[] = [];
  if (!purge) {
    if (backupDir && existsSync(backupDir)) {
      const zipPath = `${backupDir}.zip`;
      zipDirectory(backupDir, zipPath);
      rmSync(backupDir, { recursive: true, force: true });
      result.backupDir = zipPath;
    }
    if (!backupRoot) {
      // 默认模式下扫描 .restore-backup/ 中历史遗留的未压缩备份目录（本次备份目录已删除，不会重复处理）
      zippedExisting.push(...zipExistingBackups(backupRootDir));
    }
  }
  result.zippedExisting = zippedExisting;

  return result;
}

function printPlan(
  files: string[],
  trackerDb: string | null,
  purge: boolean,
  yes: boolean,
): void {
  const handleTracker = trackerDb ? existsSync(trackerDb) : false;
  console.log(`[restore] 待清理文件: ${files.length} 个`);
  for (const f of files.slice(0, 20)) console.log(`  - ${f}`);
  if (files.length > 20) console.log(`  ... 其余 ${files.length - 20} 个省略`);
  if (handleTracker) console.log(`  - ${trackerDb} (--tracker)`);
  console.log(
    !yes
      ? '[restore] dry-run 模式，未做任何改动。加 --yes 执行；--purge 永久删除，--tracker 重置 tracker.db。'
      : purge
        ? '[restore] 已永久删除。'
        : '[restore] 备份已压缩为 .zip（含 manifest.json 清单），未压缩备份已删除。',
  );
}

function help(): void {
  console.log(`restore.ts — 清理投研 vault 全部旧产出并重建骨架
用法: bun run .trae/scripts/restore/restore.ts [选项]
  --yes          正式执行（默认 dry-run 只列清单）
  --purge        永久删除（不保留备份；默认备份压缩为 .restore-backup/<时间戳>.zip）
  --tracker      同时重置 valuation-tracker/data/tracker.db
  --backup <dir> 自定义备份目录（备份压缩为 <dir>.zip）
  --zip-existing 仅把备份根目录（默认 .restore-backup/，或 --backup 目录）下未压缩备份压缩为 .zip 并删除原目录；不清理由产出
  --help         显示本帮助
备份: 备份目录压缩为 .zip 后删除未压缩目录；历史未压缩备份目录一并压缩为 <名称>.zip 并删除
清理范围: Research/00-Workspace、10-Knowledge、20-Reports 全部内容 + 散落文件；保留 99-Templates 与 .gitkeep，重建标准三段式骨架`);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    help();
    process.exit(0);
  }
  const yes = argv.includes('--yes');
  const purge = argv.includes('--purge');
  const tracker = argv.includes('--tracker');
  const backupIdx = argv.indexOf('--backup');
  const backupRoot = backupIdx >= 0 ? argv[backupIdx + 1] : null;

  if (!existsSync(DEFAULT_RESEARCH)) {
    console.error(`[restore] 未找到 Research 目录: ${DEFAULT_RESEARCH}`);
    process.exit(1);
  }

  // 仅压缩历史未压缩备份（不触发任何清理）
  if (argv.includes('--zip-existing')) {
    const root = backupRoot ?? join(DEFAULT_RESEARCH, '.restore-backup');
    if (!existsSync(root)) {
      console.error(`[restore] 备份根目录不存在: ${root}`);
      process.exit(1);
    }
    const zipped = zipExistingBackups(root);
    for (const z of zipped) console.log(`[restore] 已压缩: ${z}`);
    console.log(
      zipped.length > 0
        ? `[restore] 完成。${zipped.length} 个备份已压缩为 .zip，原目录已删除。`
        : '[restore] 完成。未发现未压缩的备份目录。',
    );
    process.exit(0);
  }

  const r = await runRestore({
    researchRoot: DEFAULT_RESEARCH,
    trackerDb: tracker ? DEFAULT_TRACKER_DB : null,
    purge,
    backupRoot,
    yes,
  });

  printPlan(r.files, tracker ? DEFAULT_TRACKER_DB : null, purge, yes);
  if (r.trackerDbHandled) console.log('[restore] tracker.db 已重置。');
  if (r.backupDir) console.log(`[restore] 本次备份压缩包: ${r.backupDir}`);
  if (r.zippedExisting.length > 0)
    console.log(`[restore] 历史备份已压缩: ${r.zippedExisting.join(', ')}`);
  console.log(
    `[restore] 完成。${r.dryRun ? 'dry-run' : r.purge ? 'purge' : '已备份并压缩'}`,
  );
}
