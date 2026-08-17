import { describe, expect, it } from "bun:test";
import { autoScan } from "../investment-checklist-auto";

// 模拟真实用法：report 在前，公司笔记（含 frontmatter + 三年财务表）在后
const report = `# 测试公司投资报告

## 核心结论
估值高企，盈利拐点验证中。
`;

const note = `---
type: "company"
name: "风华高科"
stock_code: "000636.SZ"
research_cutoff:
  report_period: "2025FY"
---

# 风华高科（000636.SZ）

## 财务数据

| 指标 | 2023 | 2024 | 2025 | 趋势 |
|------|------|------|------|------|
| 营收（亿元） | 42.21（+8.97%） | 49.39（+17.00%） | 57.56（+16.54%） | 逐年向好 |
| 归母净利润（亿元） | 1.73（-46.99%） | 3.37（+94.47%） | 2.83（-16.02%） | 波动 |
| 毛利率 | 14.35% | 19.17% | 17.75% | V 型 |
| 净利率 | 4.11% | 6.83% | 4.92% | 周期波动 |
| ROE | 1.46% | 2.79% | 2.29% | 三年 <3% |
| 经营现金流（亿元） | 3.55 | 4.53 | 4.26 | 含金量高 |

> 现金流特征：OCF/净利三年 1.99/1.37/1.49 均 >1
> 财务地雷：商誉 0（安全）；有息负债极低
`;

describe("autoScan（最新财年取值）", () => {
  it("风华高科验收：#11 ROE=2.29%、#25 OCF/NI=1.49、#15 商誉通过、#29 营收取 2025 年 16.54%", () => {
    const { autoResults } = autoScan(report, note);
    // #25 OCF/NI：取多值序列最后（1.49），且 ≥0.8 通过
    expect(autoResults[25].pass).toBe(true);
    expect(autoResults[25].note).toContain("1.49");
    // #15 商誉=0 → 通过
    expect(autoResults[15].pass).toBe(true);
    expect(autoResults[15].checked).toBe(true);
    expect(autoResults[15].note).toContain("0.0%");
    // #26 ROE：2025 值 2.29% <12%（不误取 2023 的 1.46%）
    expect(autoResults[26].pass).toBe(false);
    expect(autoResults[26].note).toContain("2.3%");
    // #29 营收同比：2025 年 16.54%（不误取 2023 的 8.97%）
    expect(autoResults[29].note).toContain("16.5%");
  });

  it("OCF/NI 为负值（-2.74）应判 #25 未通过并触发 NO-GO，负号不被吞", () => {
    const bad = note.replace("OCF/净利三年 1.99/1.37/1.49", "OCF/NI=-2.74");
    const { autoResults, summary } = autoScan(report, bad);
    expect(autoResults[25].pass).toBe(false);
    expect(autoResults[25].note).toContain("NO-GO");
    expect(autoResults[25].note).toContain("-2.74");
    expect(summary.noGoFlags.length).toBeGreaterThan(0);
  });

  it("无三年财务表时回退正文首个匹配（兼容旧行为，不崩溃）", () => {
    const simple = `# 简版\nROE 12.5%，毛利率 30%，资产负债率 45%\n`;
    const { autoResults } = autoScan(simple, undefined);
    expect(autoResults[26].note).toContain("12.5%");
    expect(autoResults[27].pass).toBe(true);
  });
});

describe("autoScan（误报消歧：#4/#8/#30）", () => {
  it("#4 三层结构：真实双链 frontmatter 识别通过，模板占位符不误通过", () => {
    const tiered = `# 行业分析报告
## 细分行业
## 公司研究
`;
    const noteWithLinks = `---
type: "company"
name: "锐捷网络"
industry: "[[通信设备-行业概览]]"
sub_industry: "[[数据中心交换机-行业分析]]"
---
## 公司概览
`;
    expect(autoScan(tiered, undefined).autoResults[4].pass).toBe(true);
    expect(autoScan(tiered, noteWithLinks).autoResults[4].pass).toBe(true);
    // 纯模板占位（未填真实链接）不得误判通过
    const placeholder = `---
type: "company"
name: "公司名称"
industry: "[[一级行业]]"
sub_industry: "[[细分行业]]"
---
`;
    expect(autoScan("# 报告", placeholder).autoResults[4].pass).toBe(false);
  });

  it("#8 财报PDF：pdf-texts 路径引用 / 三年年报覆盖表述识别为已下载", () => {
    const withPdfTexts = `# 报告\n已下载 2023/2024/2025 三份年报至 pdf-texts/测试公司/（parse_confidence=1）\n`;
    expect(autoScan(withPdfTexts, undefined).autoResults[8].pass).toBe(true);
    const withCoverage = `# 报告\n三年年报已精读，覆盖 2023/2024/2025 年报 + 2026 半年报\n`;
    expect(autoScan(withCoverage, undefined).autoResults[8].pass).toBe(true);
    // 仅泛泛提到「年报」未下载表述 → 不误判已下载
    const noPdf = `# 报告\n依据 2025 年报数据\n`;
    expect(autoScan(noPdf, undefined).autoResults[8].pass).toBe(false);
  });

  it("#30 大额减值：否定语境（转回/未计提/无减值）不触发警示", () => {
    const negateReversal = `# 报告\n2025 年资产减值损失为转回 +48.80 万、开发支出未计提减值（审计关键事项确认无减值）\n`;
    const negateNone = `# 报告\n商誉无减值、存货跌价正常计提\n`;
    const negateAmount = `# 报告\n2025 年减值 7573.8 万占归母净利 4.2%，未触发\n`;
    expect(autoScan(negateReversal, undefined).autoResults[30].pass).toBe(true);
    expect(autoScan(negateNone, undefined).autoResults[30].pass).toBe(true);
    expect(autoScan(negateAmount, undefined).autoResults[30].pass).toBe(true);
  });

  it("#30 大额减值：占比 >30% 或带金额警示语才触发", () => {
    const bigRatio = `# 报告\n2025 年减值 3.07 亿 = 归母净利 113%（Q4 集中 2.59 亿）\n`;
    const bigKeyword = `# 报告\n公司披露大额减值 2 亿元，需关注商誉减值风险\n`;
    expect(autoScan(bigRatio, undefined).autoResults[30].pass).toBe(false);
    expect(autoScan(bigKeyword, undefined).autoResults[30].pass).toBe(false);
  });
});

describe("autoScan（#28 有息负债/OCF 阈值消歧）", () => {
  it("有息负债/OCF ≤5 且现金覆盖充足 → #28 通过（胜宏科技样例不再误报 CRITICAL）", () => {
    const shenghong = `# 胜宏科技报告
有息负债 64.45 亿元；经营活动产生的现金流量净额 46.03 亿元；货币资金 60 亿元。
`;
    const { autoResults } = autoScan(shenghong, undefined);
    expect(autoResults[28].pass).toBe(true);
    expect(autoResults[28].checked).toBe(true);
    expect(autoResults[28].note).toContain("1.40");
  });

  it("有息负债/OCF >5 且现金不足 → #28 警示（真实高负债低现金仍能识别）", () => {
    const dangerous = `# 高风险公司报告
有息负债 200 亿元；经营活动产生的现金流量净额 20 亿元。
`;
    const { autoResults } = autoScan(dangerous, undefined);
    expect(autoResults[28].pass).toBe(false);
    expect(autoResults[28].checked).toBe(true);
    expect(autoResults[28].note).toContain("10.00");
  });

  it("经营现金流为负 → #28 警示", () => {
    const negOcf = `# 报告\n有息负债 50 亿元；经营现金流净额 -5 亿元。\n`;
    expect(autoScan(negOcf, undefined).autoResults[28].pass).toBe(false);
  });

  it("无法解析金额时仅强关键词触发警示，否则标注需人工核验（checked=false 不误判）", () => {
    const vague = `# 报告\n公司有息负债情况见年报附注。\n`;
    const r = autoScan(vague, undefined).autoResults[28];
    expect(r.pass).toBe(true);
    expect(r.checked).toBe(false);
    expect(r.note).toContain("人工核验");
    const strongKeyword = `# 报告\n公司债务压顶，流动性紧张。\n`;
    expect(autoScan(strongKeyword, undefined).autoResults[28].pass).toBe(false);
  });
});
