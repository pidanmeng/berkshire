#!/usr/bin/env bun
/**
 * 存量公司笔记回填脚本 — 为缺估值追踪结构化字段的笔记自动推导并写回 frontmatter
 *
 * 用法:
 *   bun run .trae/scripts/valuation/backfill.ts                # 正式回填
 *   bun run .trae/scripts/valuation/backfill.ts --dry-run      # 只输出变更摘要，不写文件
 *   bun run .trae/scripts/valuation/backfill.ts --dir <dir>    # 指定扫描目录
 *
 * 回填字段（标记 backfilled: true + backfilled_at）：
 *   scores.*                  ← 正文「四大师评分卡」星级 × 2（或已存在的 0-10 分列）
 *   target_market_cap_yi.*    ← 「目标价」表三情景每股目标价 × 总股本（东财 f20/f2 现算）
 *   forward_pe.value          ← 正文「Forward PE」散文数值
 *   valuation_type            ← 默认 general；financials.net_profit_yoy≥25 提示 growth（人工已维护则跳过）
 *   peg.*                     ← forward_pe.value + base_net_profit_yi/financials.net_profit_yi 隐含增速推导（增速≤0 或无数据跳过）
 *   research_cutoff.*         ← created/updated 日期 + 最近 deep-read 文件的 latest_report_period
 *   financials.*              ← 同花顺财务 API 三表多期序列现算（quality-screen 8 项 + 近 5 年趋势）
 *
 * 综合分不写回（由 composite.ts 权重现算）；已含 scores 的笔记跳过。
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import {
  getMarketCapFromEastmoney,
  getIncomeStatements,
  getBalanceSheets,
  getCashFlows,
  type IncomeStatement,
  type BalanceSheet,
  type CashFlow,
} from "../hithink/hithink.ts";

const ROOT = process.cwd();
const DEFAULT_DIR = join(ROOT, "Research/10-Knowledge");
const DEEP_READ_DIR = join(ROOT, "Research/00-Workspace/02-Processing");

const DRY_RUN = process.argv.includes("--dry-run");
const dirIdx = process.argv.indexOf("--dir");
const SCAN_DIR = dirIdx >= 0 ? join(ROOT, process.argv[dirIdx + 1] ?? "") : DEFAULT_DIR;

/** 维度名 → scores 键 */
const DIM_MAP: Record<string, string> = {
  能力圈: "capability",
  护城河: "moat",
  生意模式: "business_model",
  管理层诚信: "management",
  "管理层诚信（本分）": "management",
  "管理层诚信(本分)": "management",
  反向检查清单: "inversion",
  历史类比: "historical",
  "历史类比与时间框架": "historical",
  "历史类比与时间框架（李录）": "historical",
};

/** 星级字符串 → 十分制（★=1, ☆=0.5；十分制 = 星级 × 2，1 位小数） */
export function starsToScore(starStr: string): number | null {
  let v = 0;
  for (const ch of starStr) {
    if (ch === "★") v += 1;
    else if (ch === "☆") v += 0.5;
  }
  if (v <= 0) return null;
  return Math.round(v * 2 * 10) / 10;
}

/** 解析评分卡表 → 六维十分制（兼容「星级|0-10分」两列、星级带 🔴/★/☆ 等包装） */
export function parseScorecard(content: string): Record<string, number> {
  const scores: Record<string, number> = {};
  // 第一列维度名 | 第二列大师 | 第三列星级（可含 🔴/🟡/🟢、**、全角括号注释）| [可选 0-10 分]
  const rowRe = /^\|\s*([^|]+?)\s*\|\s*[^|]*?\s*\|\s*([^|]*?)\s*\|(?:\s*(\d+(?:\.\d+)?)\s*\/\s*10\s*\|)?/gm;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(content)) !== null) {
    const dim = (m[1] ?? "").replace(/^\*+\s*/, "").replace(/\s*\*+$/, "").trim();
    const key = DIM_MAP[dim];
    if (!key) continue;
    const starStr = (m[2] ?? "").match(/[★☆✩★]{1,5}/)?.[0] ?? "";
    const starScore = starsToScore(starStr);
    const explicit = m[3] !== undefined ? Math.round(parseFloat(m[3]) * 10) / 10 : null;
    if (explicit !== null) scores[key] = explicit;         // 已有 0-10 分列优先
    else if (starScore !== null) scores[key] = starScore;  // 否则星级 × 2
  }
  return scores;
}

/** 解析「估值区间与目标价」三情景表 → 每股目标价（元） */
export function parseTargetPrices(content: string): { pessimistic?: number; neutral?: number; optimistic?: number } {
  const out: { pessimistic?: number; neutral?: number; optimistic?: number } = {};
  const rowRe = /^\|\s*(悲观|中性|乐观)\s*\|[^|]*\|\s*([\d.]+)\s*\|/gm;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(content)) !== null) {
    const v = parseFloat(m[2]);
    if (!Number.isNaN(v)) {
      if (m[1] === "悲观") out.pessimistic = v;
      else if (m[1] === "中性") out.neutral = v;
      else out.optimistic = v;
    }
  }
  return out;
}

/** 正则提取正文「Forward PE」散文数值 */
export function parseForwardPe(content: string): number | null {
  const m = content.match(/Forward\s*PE[^\d]{0,6}([\d.]+)\s*x?/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isNaN(v) ? null : v;
}

/** 提取 frontmatter 嵌套块字段值（如 forward_pe.base_net_profit_yi、financials.net_profit_yi；块头支持行内注释） */
export function parseFmNestedValue(frontmatter: string, block: string, field: string): string | undefined {
  const re = new RegExp(`^${block}:\\s*(?:#[^\\n]*)?\\n(?:\\s*[^\\n]*\\n)*?\\s+${field}:\\s*["']?([^\\s"']+)`, "m");
  const m = frontmatter.match(re);
  return m ? m[1] : undefined;
}

/** 由 forward_pe.value + 基准期净利 + 当期净利推导隐含增速与 PEG（隐含增速 ≤0 或无数据 → null，留人工维护） */
export function computePeg(
  forwardPeValue: number | null,
  baseNetProfitYi: number | null,
  currentNetProfitYi: number | null,
): { value: number; growth_basis: string } | null {
  if (forwardPeValue === null || forwardPeValue <= 0) return null;
  if (baseNetProfitYi === null || baseNetProfitYi <= 0) return null;
  if (currentNetProfitYi === null || currentNetProfitYi <= 0) return null;
  const impliedGrowth = baseNetProfitYi / currentNetProfitYi - 1; // 隐含预测期增速（小数）
  if (impliedGrowth <= 0) return null;
  const value = forwardPeValue / (impliedGrowth * 100); // PEG = PE ÷ 增速(%)
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value: Math.round(value * 10) / 10, growth_basis: "forward" };
}

/** 从 frontmatter 文本提取日期字段（兼容 created/created_at/updated） */
export function parseFmDates(frontmatter: string): { updated?: string; created?: string } {
  const g = (key: string) => {
    const m = frontmatter.match(new RegExp(`^${key}:\\s*["']?([\\d-]+)`, "m"));
    return m ? m[1] : undefined;
  };
  return { updated: g("updated") ?? g("updated_at"), created: g("created") ?? g("created_at") };
}

/** 从 02-Processing 目录找同公司 deep-read 文件，读 latest_report_period/latest_report_date */
export function findDeepReadCutoff(companyName: string): { report_period?: string; report_date?: string } {
  try {
    if (!existsSync(DEEP_READ_DIR)) return {};
    const files = readdirSync(DEEP_READ_DIR).filter((f) =>
      f.endsWith("-deep-read.md") && f.includes(companyName),
    );
    if (files.length === 0) return {};
    // 取最新一个
    const latest = files
      .map((f) => ({ f, t: statSync(join(DEEP_READ_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
    const c = readFileSync(join(DEEP_READ_DIR, latest.f), "utf-8");
    const fm = c.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return {};
    const g = (key: string) => {
      const m = fm[1].match(new RegExp(`^${key}:\\s*["']?([^\\s"']+)`, "m"));
      return m ? m[1].replace(/["']/g, "") : undefined;
    };
    return { report_period: g("latest_report_period"), report_date: g("latest_report_date") };
  } catch {
    return {};
  }
}

/** 提取 frontmatter 文本（不含首尾 ---） */
export function extractFrontmatter(content: string): string | null {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

/** 生成待插入字段块
 * @param skipExistingKeys - frontmatter 已存在的顶层键（如 scores、target_market_cap_yi、forward_pe、valuation_type、peg、research_cutoff）
 *   这些由人工精心维护，脚本生成版本精度低、兜底易失真，存在则跳过不覆盖，避免 YAML 同名键取最后值导致安全边际分档、评分被污染
 */
export function buildFieldBlock(
  scores: Record<string, number>,
  targets: { pessimistic?: number; neutral?: number; optimistic?: number },
  totalSharesYi: number | null,
  forwardPe: number | null,
  cutoff: { report_period?: string; report_date?: string; announcement_date?: string },
  financialsBlock: string | null = null,
  skipExistingKeys: ReadonlySet<string> = new Set(),
  valuationType: string | null = null,                       // 品种（默认 general；financials 净利同比≥25% 提示 growth）
  peg: { value: number; growth_basis: string } | null = null, // PEG 快照（隐含增速口径）
  forwardPeBasePeriod: string | null = null,                  // forward_pe.base_period，peg.base_period 与之对齐
): string {
  const lines: string[] = [];
  lines.push("# ===== 估值追踪结构化字段（backfill 生成，供 valuation-tracker 消费）=====");
  // 人工字段：存在即跳过（scores/target_market_cap_yi/forward_pe/valuation_type/peg/research_cutoff 属人工精心维护）
  if (!skipExistingKeys.has("scores") && Object.keys(scores).length > 0) {
    lines.push("scores:");
    for (const [k, v] of Object.entries(scores)) lines.push(`  ${k}: ${v.toFixed(1)}`);
  }
  const hasTargets = targets.pessimistic !== undefined || targets.neutral !== undefined || targets.optimistic !== undefined;
  if (!skipExistingKeys.has("target_market_cap_yi") && hasTargets && totalSharesYi) {
    const cap = (price?: number) => (price !== undefined ? Math.round(price * totalSharesYi) : 0);
    lines.push("target_market_cap_yi:");
    lines.push(`  pessimistic: ${cap(targets.pessimistic)}`);
    lines.push(`  neutral: ${cap(targets.neutral)}`);
    lines.push(`  optimistic: ${cap(targets.optimistic)}`);
  }
  if (!skipExistingKeys.has("forward_pe") && forwardPe !== null) {
    lines.push("forward_pe:");
    lines.push(`  value: ${forwardPe.toFixed(1)}`);
  }
  // 品种（与 evaluate.ts VALUATION_TYPES 7 类口径一致；默认 general）
  if (!skipExistingKeys.has("valuation_type")) {
    lines.push(`valuation_type: "${valuationType ?? "general"}"`);
  }
  // PEG 快照（隐含增速口径：base_net_profit_yi/net_profit_yi − 1）
  if (!skipExistingKeys.has("peg") && peg !== null) {
    lines.push("peg:");
    lines.push(`  value: ${peg.value.toFixed(1)}`);
    lines.push(`  growth_basis: "${peg.growth_basis}"`);
    lines.push(`  base_period: ${forwardPeBasePeriod ? `"${forwardPeBasePeriod}"` : '""'}`);
  }
  const hasCutoff = cutoff.announcement_date !== undefined;
  if (!skipExistingKeys.has("research_cutoff") && hasCutoff) {
    lines.push("research_cutoff:");
    lines.push(`  report_period: ${cutoff.report_period ? `"${cutoff.report_period}"` : '""'}`);
    lines.push(`  report_date: ${cutoff.report_date ? `"${cutoff.report_date}"` : '""'}`);
    lines.push(`  announcement_date: "${cutoff.announcement_date}"`);
  }
  // financials / backfilled / backfilled_at 永远写回（是脚本专属字段）
  if (financialsBlock) {
    lines.push("# ===== 财务结构化字段（backfill 从同花顺三表多期现算，供看板财务维度消费）=====");
    lines.push(financialsBlock);
  }
  lines.push(`backfilled: true`);
  lines.push(`backfilled_at: "${new Date().toISOString().slice(0, 10)}"`);
  // 如果全部非专属字段都被跳过，最后只保留一行注释说明也不要空块
  if (lines.length <= 3) lines.splice(1, 0, "#（人工已维护 scores/估值目标/PE/研究截止日，跳过脚本重复写入）");
  return lines.join("\n");
}

// ==================== financials 块（同花顺三表多期 → 结构化财务字段）====================

/** 数值安全：null/undefined/NaN → null，否则返回原值 */
function safeNum(v: number | null | undefined): number | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

/** 保留 2 位小数（比例/比值用） */
function r2(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100) / 100;
}

/** 元 → 亿元，保留 2 位小数 */
function yi(v: number | null): number | null {
  return v === null ? null : Math.round((v / 1e8) * 100) / 100;
}

/** 小数比率 → 百分数（0.2491 → 24.91），null 透传 */
function toPercent(v: number | null): number | null {
  return v === null ? null : v * 100;
}

/** 两数相除（分母非正 → null） */
function ratio(a: number | null, b: number | null): number | null {
  const x = safeNum(a);
  const y = safeNum(b);
  if (x === null || y === null || y === 0) return null;
  return x / y;
}

/** 按 fiscal_year 对齐三表，返回升序年份列表（以利润表为主序列） */
export function alignAnnualStatements(
  income: IncomeStatement[],
  balance: BalanceSheet[],
  cashflow: CashFlow[],
): { fiscal_year: number; revenue: number | null; operating_costs: number | null; net_profit: number | null; equity: number | null; total_debt: number | null; assets_total: number | null; ocf: number | null }[] {
  const byYear = <T extends { fiscal_year: number }>(arr: T[]) => {
    const m = new Map<number, T>();
    for (const it of arr) m.set(it.fiscal_year, it);
    return m;
  };
  const inc = byYear(income);
  const bal = byYear(balance);
  const cfl = byYear(cashflow);
  const years = [...inc.keys()].sort((a, b) => a - b);
  return years.map((y) => {
    const i = inc.get(y);
    const b = bal.get(y);
    const c = cfl.get(y);
    return {
      fiscal_year: y,
      revenue: safeNum(i?.operating_income),
      operating_costs: safeNum(i?.operating_costs),
      // 优先归母净利润，缺失时回退净利润
      net_profit: safeNum(i?.parent_holder_net_profit ?? i?.net_profit),
      equity: safeNum(b?.holder_equity_total),
      total_debt: safeNum(b?.total_debt),
      assets_total: safeNum(b?.assets_total),
      ocf: safeNum(c?.act_cash_flow_net),
    };
  });
}

/**
 * 由三表多期序列生成 financials frontmatter 子块（不含顶层键 `financials:` 之前的注释）。
 * 口径（年度/期末值；金额=亿元；比率=百分数，如 24.91 表示 24.91%；比值=原值，如 OCF/NI=1.28）：
 *   roe ≈ 归母净利 / 期末股东权益；gross_margin = 1 - 营业成本/营业收入；
 *   net_margin = 归母净利/营业收入；asset_liability_ratio = 负债合计/资产总计；
 *   ocf_to_ni = 经营现金流净额/归母净利；revenue_yoy / net_profit_yoy 取最近两个连续财年。
 * 比率字段统一以百分数形式存储（与 quality-screen.ts / investment-checklist-auto.ts 的 n/100 读取约定一致）。
 * 返回 null 表示无可用数据（不写块）。
 */
export function buildFinancialsBlock(
  income: IncomeStatement[],
  balance: BalanceSheet[],
  cashflow: CashFlow[],
): string | null {
  const rows = alignAnnualStatements(income, balance, cashflow);
  // 仅以「有营业收入」的财年为准（避免报告期未披露导致的空壳年份）
  const withRevenue = rows.filter((r) => r.revenue !== null);
  if (withRevenue.length === 0) return null;

  const latest = withRevenue[withRevenue.length - 1];
  const prev = withRevenue[withRevenue.length - 2];

  const roe = r2(toPercent(ratio(latest.net_profit, latest.equity)));
  const grossMargin = latest.operating_costs !== null && latest.revenue !== null
    ? r2(toPercent(1 - latest.operating_costs / latest.revenue))
    : null;
  const netMargin = r2(toPercent(ratio(latest.net_profit, latest.revenue)));
  const assetLiabilityRatio = r2(toPercent(ratio(latest.total_debt, latest.assets_total)));
  const ocfToNi = r2(ratio(latest.ocf, latest.net_profit)); // 比值，不乘 100

  // 最近两个连续有效财年的同比
  const revenueYoy = prev && latest.revenue !== null && prev.revenue !== null && prev.revenue !== 0
    ? r2(toPercent(latest.revenue / prev.revenue - 1))
    : null;
  const netProfitYoy = prev && latest.net_profit !== null && prev.net_profit !== null && prev.net_profit !== 0
    ? r2(toPercent(latest.net_profit / prev.net_profit - 1))
    : null;

  const lines: string[] = [];
  lines.push("financials:");
  lines.push(`  report_period: ${latest.fiscal_year}`);
  lines.push(`  revenue_yi: ${yi(latest.revenue)}`);
  lines.push(`  net_profit_yi: ${yi(latest.net_profit)}`);
  lines.push(`  roe: ${roe === null ? "null" : roe}`);
  lines.push(`  gross_margin: ${grossMargin === null ? "null" : grossMargin}`);
  lines.push(`  net_margin: ${netMargin === null ? "null" : netMargin}`);
  lines.push(`  asset_liability_ratio: ${assetLiabilityRatio === null ? "null" : assetLiabilityRatio}`);
  lines.push(`  ocf_yi: ${yi(latest.ocf)}`);
  lines.push(`  ocf_to_ni: ${ocfToNi === null ? "null" : ocfToNi}`);
  lines.push(`  revenue_yoy: ${revenueYoy === null ? "null" : revenueYoy}`);
  lines.push(`  net_profit_yoy: ${netProfitYoy === null ? "null" : netProfitYoy}`);
  lines.push("  history:"); // 近 N 年年报序列（趋势）
  for (const r of withRevenue) {
    lines.push(`    - fiscal_year: ${r.fiscal_year}`);
    lines.push(`      revenue_yi: ${yi(r.revenue)}`);
    lines.push(`      net_profit_yi: ${yi(r.net_profit)}`);
    lines.push(`      roe: ${r2(toPercent(ratio(r.net_profit, r.equity)))}`);
    lines.push(`      net_margin: ${r2(toPercent(ratio(r.net_profit, r.revenue)))}`);
    lines.push(`      ocf_yi: ${yi(r.ocf)}`);
    lines.push(`      asset_liability_ratio: ${r2(toPercent(ratio(r.total_debt, r.assets_total)))}`);
  }
  return lines.join("\n");
}

/** 拉取单只股票三表并生成 financials 块（任一失败返回 null，不阻断其他笔记） */
async function fetchFinancialsBlock(stockCode: string): Promise<string | null> {
  try {
    const [income, balance, cashflow] = await Promise.all([
      getIncomeStatements(stockCode, "annual", 5),
      getBalanceSheets(stockCode, "annual", 5),
      getCashFlows(stockCode, "annual", 5),
    ]);
    return buildFinancialsBlock(income, balance, cashflow);
  } catch (err) {
    console.warn(`⚠️ 财务数据获取失败 ${stockCode}（${(err as Error).message}）`);
    return null;
  }
}

/** 受限并发执行器 */
async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  if (!existsSync(SCAN_DIR)) {
    console.error(`❌ 扫描目录不存在: ${SCAN_DIR}`);
    process.exit(1);
  }

  // 收集所有公司笔记（支持传入知识库根或具体行业目录）
  const companyDirs: string[] = [];
  if (existsSync(join(SCAN_DIR, "02-公司研究"))) {
    companyDirs.push(join(SCAN_DIR, "02-公司研究"));
  }
  for (const industry of readdirSync(SCAN_DIR)) {
    const researchDir = join(SCAN_DIR, industry, "02-公司研究");
    if (existsSync(researchDir)) companyDirs.push(researchDir);
  }
  if (companyDirs.length === 0) {
    console.error(`❌ 未找到 02-公司研究 目录（扫描: ${SCAN_DIR}）`);
    process.exit(1);
  }

  const files: { path: string; name: string }[] = [];
  for (const dir of companyDirs) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".md")) files.push({ path: join(dir, f), name: f.replace(/\.md$/, "") });
    }
  }
  console.log(`扫描到 ${files.length} 个公司笔记\n`);

  /** 从 frontmatter 文本中提取已存在的顶层 YAML 键（缩进 0 空格、以字母开头且带冒号），用于跳过重复写入人工精心维护的字段 */
  const detectTopLevelKeys = (fm: string): Set<string> => {
    const set = new Set<string>();
    for (const line of fm.split("\n")) {
      const m = line.match(/^([a-zA-Z_][\w]*):(?:\s|$)/);
      if (m) set.add(m[1]);
    }
    return set;
  };

  // 第一遍：解析所有需要回填的笔记
  const toFill: {
    path: string; name: string; stockCode: string;
    scores: Record<string, number>;
    targets: { pessimistic?: number; neutral?: number; optimistic?: number };
    forwardPe: number | null;
    cutoff: { report_period?: string; report_date?: string; announcement_date?: string };
    needsFinancials: boolean;   // frontmatter 尚无 financials 块 → 需从同花顺三表现算
    financialsBlock: string | null;
    existingKeys: Set<string>;  // frontmatter 已有的顶层键（跳过写入，避免 YAML 重复键覆盖）
  }[] = [];

  for (const f of files) {
    const content = readFileSync(f.path, "utf-8");
    const fm = extractFrontmatter(content);
    if (!fm) continue;
    const sc = content.match(/stock_code:\s*"?([\d.]+\.(?:SH|SZ|BJ))"?/i);
    const stockCode = sc ? sc[1].toUpperCase() : "";
    if (!stockCode) continue;

    const existingKeys = detectTopLevelKeys(fm);
    const hasScores = existingKeys.has("scores");
    const hasFinancials = existingKeys.has("financials");
    const scores = parseScorecard(content);
    // 完全无需回填：scores 与 financials 均已有；或既无评分卡又不需要 financials
    if (hasScores && hasFinancials) continue;
    if (!hasScores && Object.keys(scores).length === 0 && !hasFinancials) continue;

    const dates = parseFmDates(fm);
    const companyName = basename(f.name).split("-")[0];
    const dr = findDeepReadCutoff(companyName);
    toFill.push({
      path: f.path,
      name: f.name,
      stockCode,
      scores,
      targets: parseTargetPrices(content),
      forwardPe: parseForwardPe(content),
      cutoff: {
        report_period: dr.report_period,
        report_date: dr.report_date,
        announcement_date: dates.updated ?? dates.created,
      },
      needsFinancials: !hasFinancials,
      financialsBlock: null,
      existingKeys,
    });
  }
  console.log(`待回填笔记: ${toFill.length} 个（其余已含 scores/financials 或无需回填）\n`);

  // 批量获取含目标价表笔记的总股本（东财 f20/f2）
  const needShares = [...new Set(toFill.filter((t) => Object.keys(t.targets).length > 0).map((t) => t.stockCode))];
  const sharesMap = new Map<string, number>();
  if (needShares.length > 0) {
    console.log(`获取 ${needShares.length} 只股票总股本（东财）...`);
    try {
      const mcap = await getMarketCapFromEastmoney(needShares);
      for (const it of mcap) {
        if (it.market_cap != null && it.price != null && it.price > 0) {
          sharesMap.set(it.thscode, it.market_cap / it.price / 1e8); // 亿股
        }
      }
    } catch (err) {
      console.warn(`⚠️ 东财市值获取失败（${(err as Error).message}），含目标价表的笔记将仅写 scores`); 
    }
  }

  // 批量获取财务结构化字段（同花顺三表多期，并发 4）
  const needFin = toFill.filter((t) => t.needsFinancials);
  if (needFin.length > 0) {
    console.log(`获取 ${needFin.length} 只股票财务三表（同花顺，annual×5）...`);
    const blocks = await mapWithConcurrency(needFin, 4, async (t) => {
      const b = await fetchFinancialsBlock(t.stockCode);
      console.log(b ? `  ✓ ${t.name} (${t.stockCode}) financials 就绪` : `  ✗ ${t.name} (${t.stockCode}) financials 无数据`);
      return b;
    });
    needFin.forEach((t, i) => (t.financialsBlock = blocks[i]));
  }

  /** 清理 frontmatter body 中前一次 backfill 遗留的旧字段块（scores/target_market_cap_yi/forward_pe/research_cutoff 重复项 + 旧注释分隔 + backfilled 标记）
   *  保留 `# ===== 财务结构化字段` 及其后的 financials 块（如果已存在且 t.needsFinancials 为 false）
   */
  const stripOldBackfillBlock = (fmBody: string, keepFinancials: boolean): string => {
    // 删除整个「估值追踪结构化字段」块（从注释头开始 → 到紧随其后的下一个非缩进顶层键或第二个分段注释或 body 末尾）
    // 匹配：从 `# ===== 估值追踪结构化字段（backfill 生成...` 开始，直到「财务结构化字段」注释行（不含）或顶层键开始的任何行（不含）或 body 末尾（含 backfilled 标记行）
    let s = fmBody;
    if (keepFinancials) {
      // 删除 [backfill 注释头, 财务结构化字段注释头) 区间 + 末尾 backfilled 行
      s = s.replace(
        /\n# ===== 估值追踪结构化字段\(backfill 生成[\s\S]*?(?=\n# ===== 财务结构化字段)/,
        "\n",
      );
    } else {
      // 删除 [backfill 注释头, 下一个顶层键之前) 区间 — 含整个 financials 块
      s = s.replace(
        /\n# ===== 估值追踪结构化字段\(backfill 生成[\s\S]*?(?=\n(?:[a-zA-Z_][\w]*):(?:\s|$)|$)/,
        "\n",
      );
    }
    // 残余的 backfilled 行（如果块末尾在 body 结尾会残留）
    s = s.replace(/\nbackfilled:\s*(?:true|false)/g, "");
    s = s.replace(/\nbackfilled_at:\s*"[^"]*"/g, "");
    s = s.replace(/\nnotes_repo_url:\s*"[^"]*"/g, "");
    return s;
  };

  // 第二遍：写回
  let changed = 0;
  const skippedNoShares: string[] = [];
  const skippedNoFinancials: string[] = [];
  for (const t of toFill) {
    const totalSharesYi = sharesMap.get(t.stockCode) ?? null;
    const hasTargets = Object.keys(t.targets).length > 0;
    if (hasTargets && totalSharesYi === null) skippedNoShares.push(`${t.name}（有目标价但总股本缺失）`);
    if (t.needsFinancials && t.financialsBlock === null) skippedNoFinancials.push(`${t.name}（financials 数据获取失败）`);

    const skipKeys = new Set<string>();
    for (const k of t.existingKeys) skipKeys.add(k);
    const content = readFileSync(t.path, "utf-8");
    const fmText = extractFrontmatter(content) ?? "";

    /** 读取 financials 块字段数值：优先本次生成的 financialsBlock（写入前），否则读已有 frontmatter financials 块 */
    const finValue = (field: string): number | null => {
      if (t.financialsBlock) {
        const m = t.financialsBlock.match(new RegExp(`^\\s*${field}:\\s*(\\d+(?:\\.\\d+)?|null)`, "m"));
        if (m && m[1] !== "null") { const v = parseFloat(m[1]); return Number.isNaN(v) ? null : v; }
        return null;
      }
      const raw = parseFmNestedValue(fmText, "financials", field);
      if (raw === undefined || raw === "null") return null;
      const v = parseFloat(raw);
      return Number.isNaN(v) ? null : v;
    };

    // 品种（人工已维护则跳过；否则默认 general，financials.net_profit_yoy≥25 提示 growth，仅供分析师复核，周期股低谷反弹可能误报 growth）
    let valuationType: string | null = null;
    if (!skipKeys.has("valuation_type")) {
      const npy = finValue("net_profit_yoy");
      valuationType = npy !== null && npy >= 25 ? "growth" : "general";
    }

    // PEG 快照（仅当 frontmatter 已含 forward_pe.value + base_net_profit_yi 人工字段、且 financials.net_profit_yi 可用时推导；
    // 隐含增速 = base_net_profit_yi / net_profit_yi − 1；增速 ≤0 或无数据 → 跳过留人工维护）
    let peg: { value: number; growth_basis: string } | null = null;
    let pegBasePeriod: string | null = null;
    if (!skipKeys.has("peg")) {
      const fwdPeRaw = parseFmNestedValue(fmText, "forward_pe", "value");
      const baseProfitRaw = parseFmNestedValue(fmText, "forward_pe", "base_net_profit_yi");
      if (fwdPeRaw !== undefined && baseProfitRaw !== undefined) {
        const fwdPe = parseFloat(fwdPeRaw);
        const baseProfit = parseFloat(baseProfitRaw);
        const currentProfit = finValue("net_profit_yi");
        if (!Number.isNaN(fwdPe) && !Number.isNaN(baseProfit) && currentProfit !== null) {
          peg = computePeg(fwdPe, baseProfit, currentProfit);
          if (peg) pegBasePeriod = parseFmNestedValue(fmText, "forward_pe", "base_period") ?? null;
        }
      }
    }

    const block = buildFieldBlock(t.scores, t.targets, totalSharesYi, t.forwardPe, t.cutoff, t.financialsBlock, skipKeys, valuationType, peg, pegBasePeriod);
    // 拆分 frontmatter：首 --- | body | 尾 --- | 正文
    const m = content.match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/);
    if (!m) continue;
    // 先清旧 backfill 块：needsFinancials=true 说明要重写 financials，整块删；否则保留 financials
    const fmClean = stripOldBackfillBlock(m[2], !t.needsFinancials);
    const newContent = `${m[1]}${fmClean}\n${block}${m[3]}${m[4]}`;

    if (newContent === content) continue;
    changed++;
    if (DRY_RUN) {
      console.log(`[DRY-RUN] ${t.name} (${t.stockCode})`);
      const parts: string[] = [];
      if (!skipKeys.has("scores") && Object.keys(t.scores).length > 0) parts.push(`scores(${Object.keys(t.scores).length}维)`);
      if (!skipKeys.has("target_market_cap_yi") && hasTargets && totalSharesYi) parts.push("target_market_cap_yi");
      if (!skipKeys.has("forward_pe") && t.forwardPe !== null) parts.push("forward_pe");
      if (!skipKeys.has("research_cutoff") && t.cutoff.announcement_date) parts.push("research_cutoff");
      if (t.financialsBlock) parts.push("financials");
      if (!skipKeys.has("valuation_type") && valuationType) parts.push(`valuation_type(${valuationType})`);
      if (!skipKeys.has("peg") && peg) parts.push(`peg(${peg.value},${peg.growth_basis})`);
      console.log(`  新增字段: ${parts.join(" + ") || "(无，仅清理旧重复块 + 刷新 backfilled_at)"}`);
    } else {
      writeFileSync(t.path, newContent, "utf-8");
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY-RUN] 计划变更" : "已回填"} ${changed} 个笔记`);
  if (skippedNoShares.length > 0) {
    console.log(`\n⚠️ 以下笔记有目标价表但未获取到总股本（可重跑补齐 target_market_cap_yi）:`);
    skippedNoShares.forEach((s) => console.log(`  - ${s}`));
  }
  if (skippedNoFinancials.length > 0) {
    console.log(`\n⚠️ 以下笔记未能写入 financials（同花顺接口失败或无数据，可重跑补齐）:`);
    skippedNoFinancials.forEach((s) => console.log(`  - ${s}`));
  }
  console.log("\n提示: 综合分由系统按 .trae/scripts/valuation/composite.ts 权重计算，不写回 frontmatter。");
}

if (import.meta.main) main().catch((err) => { console.error(`❌ ${err.message}`); process.exit(1); });
