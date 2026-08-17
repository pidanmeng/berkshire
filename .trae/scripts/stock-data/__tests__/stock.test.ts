import { describe, it, expect } from "bun:test";
import {
  applyTitleFilter,
  stripHtmlTags,
  TITLE_FILTER,
  extractFiscalYear,
  periodEndDate,
  organizeFinancial,
  type FinancialItem,
} from "../stock.ts";

describe("stripHtmlTags", () => {
  it("strips <em> highlight tags", () => {
    expect(stripHtmlTags("关于<em>业绩预增</em>的公告")).toBe("关于业绩预增的公告");
  });
  it("returns as-is without tags", () => {
    expect(stripHtmlTags("2026年半年度报告")).toBe("2026年半年度报告");
  });
});

describe("applyTitleFilter（客户端类别兜底过滤）", () => {
  const items = [
    { title: "2026年半年度业绩预增公告" },
    { title: "2026年第一季度报告" },
    { title: "董事会提名委员会工作规则" },
    { title: "信息披露管理办法" },
    { title: "关于召开2026年半年度业绩说明会的公告" },
    { title: "2026年半年度业绩快报" },
    { title: "关于<em>业绩预减</em>的提示性公告" },
  ];

  it("yjyg：仅保留业绩预告/预增/预减类标题", () => {
    const r = applyTitleFilter(items, "yjyg");
    expect(r.length).toBe(2); // 预增公告 + 预减提示性公告
    expect(r[0].title).toBe("2026年半年度业绩预增公告");
    expect(r.some(i => i.title.includes("工作规则"))).toBe(false);
    expect(r.some(i => i.title.includes("信息披露管理办法"))).toBe(false);
  });

  it("yjbb：仅保留业绩快报/报表类标题", () => {
    const r = applyTitleFilter(items, "yjbb");
    expect(r.length).toBe(1);
    expect(r[0].title).toBe("2026年半年度业绩快报");
  });

  it("无类别过滤映射时原样返回", () => {
    const r = applyTitleFilter(items, "zqbg");
    expect(r.length).toBe(items.length);
  });

  it("含 <em> 标签的标题在剥离后仍可命中", () => {
    const r = applyTitleFilter(items, "yjyg");
    expect(r.some(i => i.title.includes("预减"))).toBe(true);
  });

  it("TITLE_FILTER 覆盖 yjyg 与 yjbb", () => {
    expect(TITLE_FILTER.yjyg).toBeInstanceOf(RegExp);
    expect(TITLE_FILTER.yjbb).toBeInstanceOf(RegExp);
  });
});

describe("extractFiscalYear（解析年报财年）", () => {
  it("解析主报告与摘要", () => {
    expect(extractFiscalYear("2025年年度报告")).toBe(2025);
    expect(extractFiscalYear("2025年年度报告摘要")).toBe(2025);
  });
  it("非年报标题返回 null", () => {
    expect(extractFiscalYear("2026年第一季度报告")).toBeNull();
    expect(extractFiscalYear("2025年半年度报告")).toBeNull();
    expect(extractFiscalYear("董事会决议公告")).toBeNull();
  });
});

describe("periodEndDate（解析报告期截止日）", () => {
  it("四类定期报告映射到对应期末", () => {
    expect(periodEndDate("2026年第一季度报告")).toBe("2026-03-31");
    expect(periodEndDate("2025年半年度报告")).toBe("2025-06-30");
    expect(periodEndDate("2025年第三季度报告")).toBe("2025-09-30");
    expect(periodEndDate("2025年年度报告")).toBe("2025-12-31");
    expect(periodEndDate("2025年年度报告摘要")).toBe("2025-12-31");
  });
  it("非定期报告标题返回 null", () => {
    expect(periodEndDate("关于召开业绩说明会的公告")).toBeNull();
  });
});

describe("organizeFinancial（定期报告整理）", () => {
  const item = (category: string, date: string, title: string): FinancialItem => ({
    category,
    date,
    title,
    pdfUrl: `https://example.com/${category}-${date}.PDF`,
  });

  // 模拟真实场景：年报与一季报同一天公告（2026-04-23），半年报摘要与正文同日
  const groups = [
    {
      category: "ndbg",
      items: [
        item("ndbg", "2026-04-23", "2025年年度报告"),
        item("ndbg", "2026-04-23", "2025年年度报告摘要"),
        item("ndbg", "2025-04-25", "2024年年度报告"),
        item("ndbg", "2024-04-25", "2023年年度报告"),
      ],
    },
    {
      category: "bndbg",
      items: [
        item("bndbg", "2025-08-28", "2025年半年度报告"),
        item("bndbg", "2025-08-28", "2025年半年度报告摘要"),
      ],
    },
    {
      category: "yjdbg",
      items: [
        item("yjdbg", "2026-04-23", "2026年第一季度报告"),
        item("yjdbg", "2025-04-25", "2025年第一季度报告"),
      ],
    },
    {
      category: "sjdbg",
      items: [item("sjdbg", "2025-10-29", "2025年第三季度报告")],
    },
  ];

  it("近三年年报：按财年新→旧、每年优先正文剔除摘要", () => {
    const { annualReports } = organizeFinancial(groups);
    expect(annualReports.map((a) => a.title)).toEqual([
      "2025年年度报告",
      "2024年年度报告",
      "2023年年度报告",
    ]);
  });

  it("最近一期财报：同公告日按报告期截止日取最新（应为 2026 一季报而非 2025 年报）", () => {
    const { latestReport } = organizeFinancial(groups);
    expect(latestReport?.title).toBe("2026年第一季度报告");
  });

  it("全部定期报告按公告日期倒序（同日按报告期倒序、正文优先）", () => {
    const { allSorted } = organizeFinancial(groups);
    expect(allSorted[0].title).toBe("2026年第一季度报告");
    expect(allSorted[1].title).toBe("2025年年度报告");
    expect(allSorted[2].title).toBe("2025年年度报告摘要");
    const dates = allSorted.map((a) => a.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("空输入返回空结果", () => {
    const r = organizeFinancial([]);
    expect(r.allSorted).toEqual([]);
    expect(r.annualReports).toEqual([]);
    expect(r.latestReport).toBeNull();
  });
});
