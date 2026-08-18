/**
 * 暗盘模块测试 — 页码持久化（SQLite UPSERT 行为） + 东财封装纯函数（日期工具 / 字段映射）
 * 运行：bun test valuation-tracker/server/lib/__tests__/darktrade.test.ts
 * 不发起任何网络请求（网络层 fetchDarkTradePage 等不在此测试范围）。
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createDarkTradePageStoreForTest,
  type DarkTradePageStore,
} from "../darktrade-store.ts";
import {
  fmtDate,
  parseDate,
  shiftDate,
  todayStr,
  mapRawToRow,
  type DarkTradeRawItem,
} from "../darktrade.ts";

// ===== 日期工具 =====

describe("日期工具（yyyyMMdd）", () => {
  test("fmtDate / parseDate 往返一致", () => {
    const d = parseDate("20260228");
    expect(fmtDate(d)).toBe("20260228");
  });

  test("shiftDate 跨月", () => {
    expect(shiftDate("20260301", -1)).toBe("20260228");
    expect(shiftDate("20260228", 1)).toBe("20260301");
  });

  test("shiftDate 跨年", () => {
    expect(shiftDate("20260101", -1)).toBe("20251231");
    expect(shiftDate("20251231", 1)).toBe("20260101");
  });

  test("shiftDate 闰年 2 月", () => {
    expect(shiftDate("20240301", -1)).toBe("20240229");
  });

  test("todayStr 返回 8 位数字", () => {
    expect(todayStr()).toMatch(/^\d{8}$/);
  });
});

// ===== 字段映射 =====

describe("mapRawToRow 脱敏映射", () => {
  const raw: DarkTradeRawItem = {
    "3": 1, "4": "600519", "5": 0,
    "6": 123456789, "7": -100000, "8": 50000,
    "9": 0, "10": 0, "11": 0.054, "12": 0,
    "13": 1723000, "14": 0.025,
    "15": "", "16": "贵州茅台", "17": "白酒", "18": "",
    "19": 0, "20": "", "21": 0,
  };

  test("映射可读字段并完成单位换算（厘→元、小数→%）", () => {
    const row = mapRawToRow(raw);
    expect(row.code).toBe("600519");
    expect(row.name).toBe("贵州茅台");
    expect(row.darkFund).toBe(123456789);
    expect(row.brightFund).toBe(-100000);
    expect(row.mainNet).toBe(50000);
    expect(row.activity).toBe(5.4);          // 0.054 → 5.4%
    expect(row.price).toBe(1723);            // 1723000 厘 → 1723 元
    expect(row.changePct).toBe(2.5);         // 0.025 → 2.5%
    expect(row.boards).toEqual(["白酒"]);    // 空标签被过滤
  });

  test("映射不暴露原始数值索引 key", () => {
    const row = mapRawToRow(raw);
    expect("4" in row).toBe(false);
    expect("13" in row).toBe(false);
  });
});

// ===== 页码持久化（SQLite UPSERT）=====

let store: DarkTradePageStore;
let dbFile = "";

describe("darktrade_pages 页码持久化", () => {
  beforeAll(() => {
    dbFile = join(mkdtempSync(join(tmpdir(), "darktrade-test-")), "tracker.db");
  });

  afterAll(() => {
    store?.close();
    try {
      rmSync(dbFile, { recursive: true, force: true });
    } catch {
      // Windows 文件句柄释放延迟，忽略
    }
  });

  test("无记录时 getPage 返回 null，setPage 写入后返回 true", async () => {
    store = await createDarkTradePageStoreForTest(dbFile);
    expect(await store.getPage("600519")).toBeNull();
    expect(await store.setPage("600519", 3)).toBe(true);
    expect(await store.getPage("600519")).toBe(3);
  });

  test("页码相同不重复写入（返回 false）", async () => {
    expect(await store.setPage("600519", 3)).toBe(false);
    expect(await store.getPage("600519")).toBe(3);
  });

  test("页码变化时 UPSERT 并刷新 updated_at（返回 true）", async () => {
    expect(await store.setPage("600519", 4)).toBe(true);
    expect(await store.getPage("600519")).toBe(4);
  });

  test("批量写回：仅统计变化的条数", async () => {
    // 600519 已是 4（不变）；000858 新增（变化）；600000 新增（变化）
    const changed = await store.setPages({ "600519": 4, "000858": 2, "600000": 1 });
    expect(changed).toBe(2);
    expect(await store.getPage("000858")).toBe(2);
    expect(await store.getPage("600000")).toBe(1);
  });

  test("非法页码（< 1）拒绝写入", async () => {
    expect(await store.setPage("600000", 0)).toBe(false);
    expect(await store.getPage("600000")).toBe(1);
  });

  test("持久化跨实例生效（数据真实落盘）", async () => {
    store.close();
    const store2 = await createDarkTradePageStoreForTest(dbFile);
    expect(await store2.getPage("600519")).toBe(4);
    expect(await store2.getPage("000858")).toBe(2);
    expect(await store2.getPage("600000")).toBe(1);
    store2.close();
    store = await createDarkTradePageStoreForTest(dbFile);
  });
});
