/**
 * restore.ts 单测 — bun test
 *   bun test .trae/scripts/restore/__tests__/restore.test.ts
 *
 * 覆盖：文件清单收集（排除 .gitkeep）、备份移动（保留相对结构）、永久删除、
 *       zip 读写（zipDirectory / listZipEntries / readZipText）、骨架重建、空目录清理、
 *       runRestore 整体流程（dry-run / 备份+压缩 / purge / tracker / 历史备份压缩）。
 */

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureSkeleton,
  listFilesToClean,
  listZipEntries,
  moveToBackup,
  pruneEmptyDirs,
  purgeFiles,
  readZipText,
  runRestore,
  skeletonDirs,
  zipDirectory,
  zipExistingBackups,
} from "../restore.ts";

/** 构造一个临时 Research 树（含 .gitkeep、知识节点、报告、散落文件、Templates、备份残留） */
function makeResearch(): string {
  const base = mkdtempSync(join(tmpdir(), "restore-test-"));
  const R = join(base, "Research");
  mkdirSync(join(R, "00-Workspace", "01-Inbox", "eval-snapshots"), { recursive: true });
  mkdirSync(join(R, "00-Workspace", "02-Processing", "pdf-texts", "宁德时代"), { recursive: true });
  mkdirSync(join(R, "00-Workspace", "06-Process-Improvement", "reviews"), { recursive: true });
  mkdirSync(join(R, "10-Knowledge", "02-半导体", "02-公司研究"), { recursive: true });
  mkdirSync(join(R, "10-Knowledge", "00-MOC"), { recursive: true });
  mkdirSync(join(R, "10-Knowledge", "99-宏观", "全球经济"), { recursive: true });
  mkdirSync(join(R, "20-Reports"), { recursive: true });
  mkdirSync(join(R, "99-Templates"), { recursive: true });
  mkdirSync(join(R, ".restore-backup", "old"), { recursive: true });

  writeFileSync(join(R, "00-Workspace", "01-Inbox", ".gitkeep"), "");
  writeFileSync(join(R, "00-Workspace", "01-Inbox", "eval-snapshots", "688041-海光信息.md"), "x");
  writeFileSync(join(R, "00-Workspace", "02-Processing", ".gitkeep"), "");
  writeFileSync(join(R, "00-Workspace", "02-Processing", "pdf-texts", "宁德时代", "1225002214.txt"), "x");
  writeFileSync(join(R, "00-Workspace", "02-Processing", "2026-08-14-宁德时代-deep-read.md"), "x");
  writeFileSync(join(R, "00-Workspace", "06-Process-Improvement", "reviews", "r.json"), "x");
  writeFileSync(join(R, "10-Knowledge", "02-半导体", "02-公司研究", "中微公司-公司研究.md"), "x");
  writeFileSync(join(R, "10-Knowledge", "00-MOC", "半导体-MOC.md"), "x");
  writeFileSync(join(R, "10-Knowledge", "99-宏观", "全球经济", "note.md"), "x");
  writeFileSync(join(R, "20-Reports", ".gitkeep"), "");
  writeFileSync(join(R, "20-Reports", "2026-08-03-猪周期-report.md"), "x");
  writeFileSync(join(R, "99-Templates", "company-template.md"), "keep");
  writeFileSync(join(R, ".restore-backup", "old", "legacy.md"), "keep");
  writeFileSync(join(R, "2026-08-04-算力租赁-知识入库整理摘要.md"), "x");
  return base;
}

function cleanup(base: string): void {
  rmSync(base, { recursive: true, force: true });
}

describe("listFilesToClean", () => {
  test("收集全部非 .gitkeep 文件（含散落文件），排除 Templates 与既有备份", () => {
    const base = makeResearch();
    const R = join(base, "Research");
    const files = listFilesToClean(R).map((f) => f.slice(R.length + 1).replaceAll("\\", "/"));
    expect(files).toEqual(
      expect.arrayContaining([
        "00-Workspace/01-Inbox/eval-snapshots/688041-海光信息.md",
        "00-Workspace/02-Processing/pdf-texts/宁德时代/1225002214.txt",
        "00-Workspace/02-Processing/2026-08-14-宁德时代-deep-read.md",
        "00-Workspace/06-Process-Improvement/reviews/r.json",
        "10-Knowledge/02-半导体/02-公司研究/中微公司-公司研究.md",
        "10-Knowledge/00-MOC/半导体-MOC.md",
        "10-Knowledge/99-宏观/全球经济/note.md",
        "20-Reports/2026-08-03-猪周期-report.md",
        "2026-08-04-算力租赁-知识入库整理摘要.md",
      ]),
    );
    // 排除 .gitkeep / Templates / 既有备份
    expect(files).not.toEqual(
      expect.arrayContaining([
        "00-Workspace/01-Inbox/.gitkeep",
        "99-Templates/company-template.md",
        ".restore-backup/old/legacy.md",
      ]),
    );
    cleanup(base);
  });
});

describe("moveToBackup", () => {
  test("移入备份目录且保留相对结构，原文件消失", () => {
    const base = makeResearch();
    const R = join(base, "Research");
    const bak = join(base, "bak");
    const files = listFilesToClean(R);
    const moved = moveToBackup(files, R, bak);
    expect(moved).toBe(files.length);
    expect(existsSync(join(R, "10-Knowledge", "02-半导体", "02-公司研究", "中微公司-公司研究.md"))).toBe(false);
    expect(existsSync(join(bak, "10-Knowledge", "02-半导体", "02-公司研究", "中微公司-公司研究.md"))).toBe(true);
    expect(existsSync(join(bak, "2026-08-04-算力租赁-知识入库整理摘要.md"))).toBe(true);
    cleanup(base);
  });
});

describe("purgeFiles", () => {
  test("直接删除文件", () => {
    const base = makeResearch();
    const R = join(base, "Research");
    const files = listFilesToClean(R);
    const n = purgeFiles(files);
    expect(n).toBe(files.length);
    expect(existsSync(join(R, "20-Reports", "2026-08-03-猪周期-report.md"))).toBe(false);
    cleanup(base);
  });
});

describe("zipDirectory / listZipEntries / readZipText", () => {
  test("目录压缩为 zip（含中文/嵌套路径），原目录保留，内容可回读", () => {
    const base = mkdtempSync(join(tmpdir(), "restore-test-"));
    const dir = join(base, "bak");
    mkdirSync(join(dir, "10-Knowledge", "02-半导体", "02-公司研究"), { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ files: 1 }));
    writeFileSync(join(dir, "10-Knowledge", "02-半导体", "02-公司研究", "中微公司-公司研究.md"), "hello 中微");
    const zipPath = join(base, "bak.zip");

    const n = zipDirectory(dir, zipPath);
    expect(n).toBe(2);
    // 原目录不被删除
    expect(existsSync(join(dir, "manifest.json"))).toBe(true);

    const entries = listZipEntries(zipPath);
    expect(entries).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "10-Knowledge/02-半导体/02-公司研究/中微公司-公司研究.md",
      ]),
    );
    expect(readZipText(zipPath, "10-Knowledge/02-半导体/02-公司研究/中微公司-公司研究.md")).toBe("hello 中微");
    expect(JSON.parse(readZipText(zipPath, "manifest.json")).files).toBe(1);
    cleanup(base);
  });
});

describe("zipExistingBackups", () => {
  test("压缩所有未压缩备份目录并删除原目录；已存在 zip 的残留目录仅删除、不覆盖 zip", () => {
    const base = mkdtempSync(join(tmpdir(), "restore-test-"));
    const root = join(base, ".restore-backup");
    mkdirSync(join(root, "bak-a", "sub"), { recursive: true });
    mkdirSync(join(root, "bak-b"), { recursive: true });
    mkdirSync(join(root, "bak-c"), { recursive: true });
    writeFileSync(join(root, "bak-a", "sub", "f1.md"), "a");
    writeFileSync(join(root, "bak-b", "f2.md"), "b");
    writeFileSync(join(root, "bak-c", "leftover.md"), "c");
    writeFileSync(join(root, "bak-c.zip"), "existing");

    const zipped = zipExistingBackups(root);
    expect(zipped).toEqual([join(root, "bak-a.zip"), join(root, "bak-b.zip")]);
    // 原目录全部删除
    expect(existsSync(join(root, "bak-a"))).toBe(false);
    expect(existsSync(join(root, "bak-b"))).toBe(false);
    expect(existsSync(join(root, "bak-c"))).toBe(false);
    // 新 zip 生成，内容完整
    expect(existsSync(join(root, "bak-a.zip"))).toBe(true);
    expect(existsSync(join(root, "bak-b.zip"))).toBe(true);
    expect(listZipEntries(join(root, "bak-a.zip"))).toEqual(["sub/f1.md"]);
    expect(readZipText(join(root, "bak-a.zip"), "sub/f1.md")).toBe("a");
    // 已存在的 zip 未被覆盖
    expect(readFileSync(join(root, "bak-c.zip"), "utf8")).toBe("existing");
    cleanup(base);
  });

  test("备份根目录不存在时返回空", () => {
    const base = mkdtempSync(join(tmpdir(), "restore-test-"));
    expect(zipExistingBackups(join(base, "nope"))).toEqual([]);
    cleanup(base);
  });
});

describe("skeletonDirs / ensureSkeleton", () => {
  test("生成标准骨架（workspace 阶段 + 99-宏观三段 + MOC + Reports）并补齐 .gitkeep", () => {
    const base = mkdtempSync(join(tmpdir(), "restore-test-"));
    const R = join(base, "Research");
    mkdirSync(join(R, "10-Knowledge", "99-宏观", "全球经济"), { recursive: true });
    const dirs = skeletonDirs(R);
    const created = ensureSkeleton(dirs);
    expect(created).toBe(dirs.length);
    for (const d of dirs) {
      expect(existsSync(join(d, ".gitkeep"))).toBe(true);
    }
    expect(existsSync(join(R, "10-Knowledge", "99-宏观", "全球经济", ".gitkeep"))).toBe(true);
    expect(existsSync(join(R, "10-Knowledge", "99-宏观", "货币政策", ".gitkeep"))).toBe(true);
    expect(existsSync(join(R, "10-Knowledge", "00-MOC", ".gitkeep"))).toBe(true);
    expect(existsSync(join(R, "00-Workspace", "02-Processing", "pdf-texts", ".gitkeep"))).toBe(true);
    cleanup(base);
  });
});

describe("pruneEmptyDirs", () => {
  test("删除空目录但保留含 .gitkeep 的骨架目录", () => {
    const base = makeResearch();
    const R = join(base, "Research");
    const dirs = skeletonDirs(R);
    ensureSkeleton(dirs);
    // 模拟清理后遗留的空目录
    mkdirSync(join(R, "10-Knowledge", "02-半导体", "01-细分行业", "废弃赛道"), { recursive: true });
    const removed = pruneEmptyDirs(join(R, "10-Knowledge"), join(R, "10-Knowledge"));
    expect(removed).toBeGreaterThan(0);
    expect(existsSync(join(R, "10-Knowledge", "02-半导体", "01-细分行业", "废弃赛道"))).toBe(false);
    // 骨架目录保留（.gitkeep 使其非空）
    expect(existsSync(join(R, "10-Knowledge", "99-宏观", "全球经济", ".gitkeep"))).toBe(true);
    cleanup(base);
  });
});

describe("runRestore", () => {
  test("dry-run 不做任何改动", async () => {
    const base = makeResearch();
    const R = join(base, "Research");
    const r = await runRestore({ researchRoot: R });
    expect(r.dryRun).toBe(true);
    expect(r.files.length).toBeGreaterThan(0);
    expect(r.backupDir).toBeNull();
    expect(r.zippedExisting).toEqual([]);
    expect(existsSync(join(R, "10-Knowledge", "02-半导体", "02-公司研究", "中微公司-公司研究.md"))).toBe(true);
    cleanup(base);
  });

  test("yes 模式：备份压缩为 .zip、历史备份一并压缩、重建骨架、Templates 与 .gitkeep 保留", async () => {
    const base = makeResearch();
    const R = join(base, "Research");
    const r = await runRestore({ researchRoot: R, yes: true });
    expect(r.dryRun).toBe(false);
    // 本次备份为 .zip
    expect(r.backupDir).not.toBeNull();
    expect(r.backupDir!.endsWith(".zip")).toBe(true);
    expect(existsSync(r.backupDir!)).toBe(true);
    // 原文件已移走
    expect(existsSync(join(R, "10-Knowledge", "02-半导体", "02-公司研究", "中微公司-公司研究.md"))).toBe(false);
    expect(existsSync(join(R, "20-Reports", "2026-08-03-猪周期-report.md"))).toBe(false);
    // zip 内含 manifest 与保留相对结构的备份文件
    const entries = listZipEntries(r.backupDir!);
    expect(entries).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "10-Knowledge/02-半导体/02-公司研究/中微公司-公司研究.md",
        "20-Reports/2026-08-03-猪周期-report.md",
      ]),
    );
    const manifest = JSON.parse(readZipText(r.backupDir!, "manifest.json"));
    expect(manifest.files.length).toBe(r.files.length);
    // 骨架保留
    expect(existsSync(join(R, "10-Knowledge", "99-宏观", "全球经济", ".gitkeep"))).toBe(true);
    // Templates 不动
    expect(readFileSync(join(R, "99-Templates", "company-template.md"), "utf8")).toBe("keep");
    // 历史未压缩备份 old/ → old.zip，原目录删除
    expect(r.zippedExisting).toEqual([join(R, ".restore-backup", "old.zip")]);
    expect(existsSync(join(R, ".restore-backup", "old"))).toBe(false);
    expect(existsSync(join(R, ".restore-backup", "old.zip"))).toBe(true);
    expect(readZipText(join(R, ".restore-backup", "old.zip"), "legacy.md")).toBe("keep");
    cleanup(base);
  });

  test("purge 模式：直接删除且不产生备份", async () => {
    const base = makeResearch();
    const R = join(base, "Research");
    const r = await runRestore({ researchRoot: R, yes: true, purge: true });
    expect(r.purge).toBe(true);
    expect(r.backupDir).toBeNull();
    expect(r.zippedExisting).toEqual([]);
    expect(existsSync(join(R, "10-Knowledge", "00-MOC", "半导体-MOC.md"))).toBe(false);
    expect(existsSync(join(R, "20-Reports", "2026-08-03-猪周期-report.md"))).toBe(false);
    expect(existsSync(join(R, "00-Workspace", "01-Inbox", ".gitkeep"))).toBe(true);
    cleanup(base);
  });

  test("tracker：db 文件被压缩进备份 zip", async () => {
    const base = makeResearch();
    const R = join(base, "Research");
    const trackerDb = join(base, "tracker.db");
    writeFileSync(trackerDb, "sqlite");
    const r = await runRestore({ researchRoot: R, trackerDb, yes: true });
    expect(r.trackerDbHandled).toBe(true);
    expect(existsSync(trackerDb)).toBe(false);
    expect(r.backupDir!.endsWith(".zip")).toBe(true);
    expect(listZipEntries(r.backupDir!)).toContain("tracker.db");
    expect(readZipText(r.backupDir!, "tracker.db")).toBe("sqlite");
    cleanup(base);
  });

  test("自定义 --backup：备份压缩为 <dir>.zip 并删除原目录", async () => {
    const base = makeResearch();
    const R = join(base, "Research");
    const bak = join(base, "custom-bak");
    const r = await runRestore({ researchRoot: R, yes: true, backupRoot: bak });
    expect(r.backupDir).toBe(`${bak}.zip`);
    expect(existsSync(`${bak}.zip`)).toBe(true);
    expect(existsSync(bak)).toBe(false);
    expect(r.zippedExisting).toEqual([]);
    cleanup(base);
  });
});
