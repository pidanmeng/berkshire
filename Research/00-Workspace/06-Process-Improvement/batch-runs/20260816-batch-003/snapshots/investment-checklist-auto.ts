#!/usr/bin/env bun
/**
 * 50 项投资决策清单 - 自动检查脚本
 * 灵感来自 ai-berkshire/investment-checklist Skill
 *
 * 用法:
 *   bun run investment-checklist-auto.ts <report-md-path> [company-md-path]
 *
 * 会扫描报告/公司笔记的 Markdown content，对 [AUTO] 项做正则匹配 + 关键字扫描，输出统计。
 * 输出 Markdown 格式的【清单检查块】，可直接粘贴到报告附录。
 */

import { readFileSync, existsSync } from "node:fs";

interface CheckResult {
  pass: boolean;
  checked: boolean; // false = data missing, can't auto judge
  note: string;
}

function autoScan(content: string, companyContent?: string): {
  autoResults: Record<number, CheckResult>;
  summary: {
    criticalFail: number; criticalTotal: number;
    importantFail: number; importantTotal: number;
    normalFail: number; normalTotal: number;
    noGoFlags: string[];
  };
  reportMarkdown: string;
} {
  const autoResults: Record<number, CheckResult> = {};
  const _r = (n: number, pass: boolean, checked: boolean, note: string) => {
    autoResults[n] = { pass, checked, note };
  };

  const combined = content + "\n" + (companyContent ?? "");
  const has = (re: RegExp) => re.test(combined);
  const pct = (re: RegExp): number | null => {
    const m = combined.match(re);
    if (!m) return null;
    // 从完整匹配字符串中提取带符号数字（避免多捕获组中负号被吞）
    const numMatch = m[0].match(/(-?\d+\.?\d*)/);
    if (!numMatch) return null;
    const v = parseFloat(numMatch[1]);
    if (isNaN(v)) return null;
    return m[0].includes("%") ? v / 100 : v;
  };

  // ---- 最新财年取值（与 quality-screen --mode report 同策略：financials 块 → 财务表最新财年列 → 正文兜底）----
  const fmFlat = (() => {
    const fmSrc = companyContent ?? content;
    const fm = fmSrc.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const out: Record<string, string> = {};
    if (!fm) return out;
    let block = "";
    for (const line of fm[1].split(/\r?\n/)) {
      const top = line.match(/^([a-z_]+)\s*:\s*(.*)$/i);
      const sub = line.match(/^\s+([a-z_]+)\s*:\s*(.*)$/i);
      if (top) { block = top[1]; out[block] = top[2].trim().replace(/^["']|["']$/g, ""); }
      else if (sub) out[`${block}.${sub[1]}`] = sub[2].trim().replace(/^["']|["']$/g, "");
    }
    return out;
  })();
  const yearTables = (() => {
    const tables: Array<{ years: string[]; colIndex: number[]; rows: Array<{ label: string; cells: string[] }> }> = [];
    const lines = combined.split(/\r?\n/);
    const cols = (row: string) => row.split("|").slice(1, -1).map(c => c.trim());
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trim().startsWith("|")) { i++; continue; }
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { block.push(lines[i].trim()); i++; }
      const header = cols(block[0]);
      const years: string[] = [];
      const colIndex: number[] = [];
      header.forEach((cell, idx) => { if (/^\d{4}$/.test(cell)) { years.push(cell); colIndex.push(idx); } });
      if (years.length < 2) continue;
      tables.push({ years, colIndex, rows: block.slice(2).map(r => { const cells = cols(r); return { label: cells[0] ?? "", cells }; }) });
    }
    return tables;
  })();
  const latestYear = (() => {
    const raw = fmFlat["financials.report_period"] ?? fmFlat["research_cutoff.report_period"] ?? "";
    const m = raw.match(/\d{4}/);
    if (m) return m[0];
    return yearTables.length ? yearTables[yearTables.length - 1].years[yearTables[yearTables.length - 1].years.length - 1] : null;
  })();
  const cellNum = (cell: string, preferGrowth: boolean): number | null => {
    const parenNum = cell.match(/[（(]\s*([-+]?\d+(?:\.\d+)?)\s*%/);
    const mainNum = cell.match(/(-?\d+(?:\.\d+)?)/);
    let raw: string | null = null;
    if (preferGrowth && parenNum) raw = parenNum[1];
    else if (mainNum) raw = mainNum[1];
    if (raw === null) return null;
    const v = parseFloat(raw);
    return isNaN(v) ? null : (/%/.test(cell) ? v / 100 : v);
  };
  const cellLatest = (labelRe: RegExp, preferGrowth = false): number | null => {
    for (const t of yearTables) {
      const yearPos = latestYear ? t.years.indexOf(latestYear) : -1;
      const col = yearPos >= 0 ? t.colIndex[yearPos] : t.colIndex[t.colIndex.length - 1];
      for (const row of t.rows) {
        if (!labelRe.test(row.label)) continue;
        const v = cellNum(row.cells[col], preferGrowth);
        if (v !== null) return v;
      }
    }
    return null;
  };
  // 正文兜底：排除阈值/警示措辞（捕获数字在匹配串内紧邻 < > ≥ ≤ ~ 时跳过），多值取最后一个（最新财年），保留负号
  const fallbackNum = (patterns: RegExp[], preferGrowth = false): number | null => {
    for (const p of patterns) {
      const re = new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`);
      let m: RegExpExecArray | null;
      while ((m = re.exec(combined)) !== null) {
        const captured = m[1] ?? m[0].match(/(-?\d+(?:\.\d+)?)/)?.[1];
        if (captured === undefined || captured === null) continue;
        // 阈值/警示措辞：捕获数字在匹配串内紧邻 < > ≥ ≤ ~ 时跳过（如「商誉/净资产 <30%」）
        const numStart = m[0].lastIndexOf(String(captured));
        if (numStart > 0 && "<>≥≤~".includes(m[0][numStart - 1])) continue;
        const nums = m[0].match(/-?\d+(?:\.\d+)?/g) ?? [];
        const raw = nums.length > 1 ? nums[nums.length - 1] : captured;
        const v = parseFloat(raw);
        if (isNaN(v)) continue;
        if (preferGrowth) {
          const paren = m[0].match(/[（(][^）)]*?([-+]?\d+(?:\.\d+)?)\s*%[^）)]*[）)]/);
          if (paren) return parseFloat(paren[1]) / 100;
        }
        return /%/.test(m[0]) ? v / 100 : v;
      }
    }
    return null;
  };
  const latestValue = (finKey: string | undefined, finPercent: boolean, labelRe: RegExp | null, fallbackPatterns: RegExp[], preferGrowth = false): number | null => {
    if (finKey) {
      const raw = fmFlat[`financials.${finKey}`];
      const n = raw === undefined || raw === "" ? NaN : parseFloat(raw);
      if (!isNaN(n)) return finPercent ? n / 100 : n;
    }
    if (labelRe) {
      const v = cellLatest(labelRe, preferGrowth);
      if (v !== null) return v;
    }
    return fallbackNum(fallbackPatterns, preferGrowth);
  };

  // 4 AUTO: 三层结构（行业/细分/公司）关键词
  const hasThreeTiers =
    has(/行业全景|行业概览|00-行业概览|行业分析/i) &&
    has(/细分行业|01-细分行业|赛道/i) &&
    has(/公司研究|02-公司研究|代表公司/i);
  _r(4, hasThreeTiers, true, hasThreeTiers ? "检测到三层关键词（行业+细分+公司）" : "未完整发现三层关键词，请检查结构");

  // 8 AUTO: 是否下载了财报PDF
  const pdfDownloaded = (
    has(/annual.?report|年度报告|年报PDF|财报PDF|CNINFO公告|巨潮资讯|巨潮/i) &&
    has(/(PDF|pdf).*(提取|解析|下载|已抓取)|(提取|解析|下载|已抓取).*(PDF|pdf)/)
  ) || has(/PDF.*财报|财报.*PDF|年报.*已下载|半年报.*已下载|季报.*已下载/i);
  _r(8, pdfDownloaded, true, pdfDownloaded ? "检测到财报PDF下载/解析痕迹" : "未检测到财报PDF下载记录");

  // 11 AUTO: 毛利率≥25% 或 ROE≥15%
  const grossPct = latestValue("gross_margin", true, /^毛利率$/, [/毛\s*利\s*率[^\d]{0,8}([\d.]+)\s*%/]);
  const roePct = latestValue("roe", true, /^ROE$|^净资产收益率$/i, [/ROE[^\d]{0,10}([\d.]+)\s*%|净资产收益率[^\d]{0,8}([\d.]+)\s*%/i]) ?? (
    (() => { const m = combined.match(/roe\s*[:：]\s*([\d.]+)/i); if (!m) return null; const v = parseFloat(m[1]); return v > 1 ? v / 100 : v; })()
  );
  const r11ok = (grossPct !== null && grossPct >= 0.25) || (roePct !== null && roePct >= 0.15);
  const r11note = `毛利率=${grossPct === null ? "N/A" : (grossPct * 100).toFixed(1) + "%"}，ROE=${roePct === null ? "N/A" : (roePct * 100).toFixed(1) + "%"} → ${r11ok ? "✅ 有护城河信号" : "⚠️ 偏低（若无周期性解释）"}`;
  _r(11, r11ok, (grossPct !== null || roePct !== null), r11note);

  // 14 AUTO: 重资产（固定资产/收入 ≥ 50%）— 仅扫关键词，无数据时判 checked=false
  const assetHeavyKeyword = has(/重资产|固定\s*资产.*占.*高|资本密集|CAPEX.*高|折旧.*高/i);
  const assetLightKeyword = has(/轻资产|低资本支出|Capex.*低|平台模式|软件|SaaS|品牌/i);
  if (assetHeavyKeyword && !assetLightKeyword) _r(14, false, true, "⚠️ 关键词判断为重资产（资本需求高，需验证）");
  else if (assetLightKeyword && !assetHeavyKeyword) _r(14, true, true, "✅ 关键词判断为轻资产");
  else _r(14, true, false, "无法自动判断重/轻资产，需人工确认");

  // 15 AUTO: 商誉/净资产 <30%（扫商誉关键词或 Goodwill/NW 比；商誉=0/无商誉直接通过，阈值措辞不误触发）
  const goodwillRatio = (() => {
    if (has(/商誉\s*[:：=]?\s*0|商誉[^\d]{0,6}(?:0|无|不存在|没有)|无(?:大额)?商誉/)) return 0;
    return cellLatest(/^商誉/, false) ?? fallbackNum([/商誉[^\d]{0,8}(?:占|\/)[^\d]{0,8}净资产[^\d]{0,8}([\d.]+)\s*%/, /商誉[^\d]{0,8}占比[^\d]{0,8}([\d.]+)\s*%/]);
  })();
  if (goodwillRatio !== null && !isNaN(goodwillRatio)) {
    const ok = goodwillRatio < 0.30;
    _r(15, ok, true, ok ? `✅ 商誉占比=${(goodwillRatio*100).toFixed(1)}%（<30%）` : `🚩 商誉/净资产=${(goodwillRatio*100).toFixed(1)}% ≥30%（商誉减值风险）`);
  } else if (has(/商誉占比过高|大额商誉|商誉减值风险/i)) {
    _r(15, false, true, "🚩 检测到商誉高警示（关键词）");
  } else {
    _r(15, true, false, "未检测到商誉描述，需人工查看资产负债表确认");
  }

  // 25 AUTO: OCF/NI ≥ 0.8，连续 2 年 <0.5 = 一票否决
  const ocfNiRaw = latestValue("ocf_to_ni", false, /^经营现金流\/净利$|^OCF\/NI$/i, [
    /(?:经营现金流|OCF|现金流)[^\d-]{0,6}(?:\/|每|占|对应)?[^\d-]{0,6}(?:净利|NI)[^\d-]{0,15}([-+]?\d+(?:\.\d+)?(?:\s*\/\s*[-+]?\d+(?:\.\d+)?)*)/i,
    /OCF\/NI\s*[:：]\s*([-\d.]+)/,
  ]);
  if (ocfNiRaw !== null && !isNaN(ocfNiRaw)) {
    const ok = ocfNiRaw >= 0.8;
    const critical = ocfNiRaw < 0.5;
    _r(25, ok, true,
      critical ? `🚨 NO-GO：OCF/NI=${ocfNiRaw.toFixed(2)} < 0.5，盈利质量严重存疑`
               : `OCF/NI=${ocfNiRaw.toFixed(2)} ${ok ? "✅ ≥0.8" : "⚠️ <0.8 但 ≥0.5"}`);
  } else {
    _r(25, true, false, "未检测到 OCF/NI 数据，需人工核对现金流量表");
  }

  // 26 AUTO: ROE ≥ 12% 连续 3 年
  if (roePct !== null) {
    const ok = roePct >= 0.12;
    _r(26, ok, true, `ROE=${(roePct*100).toFixed(1)}% ${ok ? "✅ ≥12%" : "⚠️ <12%（若属周期性低点则可豁免）"}`);
  } else {
    _r(26, true, false, "ROE 数据缺失");
  }

  // 27 AUTO: 资产负债率 非金融 ≤ 60%
  const debtPct = latestValue("asset_liability_ratio", true, /^资产负债率$/, [/资产\s*负债\s*率[^\d]{0,8}([\d.]+)\s*%|负债\s*率[^\d]{0,8}([\d.]+)\s*%/i]);
  if (debtPct !== null) {
    const ok = debtPct <= 0.60;
    const red = debtPct > 0.70;
    _r(27, ok, true, `资产负债率=${(debtPct*100).toFixed(1)}% ${ok ? "✅ ≤60%" : red ? "🚨 >70% 高杠杆红线" : "⚠️ 60%-70% 偏高"}`);
  } else {
    _r(27, true, false, "未检测到资产负债率");
  }

  // 28 AUTO: 有息负债 / 经营现金流 > 5（扫关键词，auto weak）
  const debtDanger = has(/(有息负债|净负债).*高|利息覆盖.*差|利息保障.*[<≤]\s*[12]|债务压顶|违约风险|流动性.*紧/i);
  _r(28, !debtDanger, !debtDanger ? true : true, debtDanger ? "🚩 检测到债务风险关键词" : "未检测到债务风险（建议人工计算有息负债/OCF 比）");

  // 29 AUTO: 营收 + 净利 双负
  const revG = latestValue("revenue_yoy", true, /^营收/, [/营收[^\d]{0,8}(?:同比)?[^\d]{0,6}([-\d.]+)\s*%|营业收入.*同比[^\d]{0,6}([-\d.]+)\s*%/i], true);
  const niG = latestValue("net_profit_yoy", true, /^归母净利润|^净利润/, [/净利润[^\d]{0,8}(?:同比)?[^\d]{0,6}([-\d.]+)\s*%|归母净利润.*同比[^\d]{0,6}([-\d.]+)\s*%/i], true);
  const bothNeg = revG !== null && niG !== null && revG < 0 && niG < 0;
  _r(29, !bothNeg, (revG !== null && niG !== null),
    bothNeg ? `🚩 双负增长：营收${(revG!*100).toFixed(1)}% + 净利${(niG!*100).toFixed(1)}%，萎缩信号` :
    `营收=${revG === null ? "N/A" : (revG*100).toFixed(1)+"%"}，净利=${niG === null ? "N/A" : (niG*100).toFixed(1)+"%"}`);

  // 30 AUTO: 大额减值 / 净利 > 30%
  const impairRed = has(/资产减值损失|商誉减值|信用减值损失[^\d]{0,20}(?:占|\/)[^\d]{0,20}净利润.*[>≥]\s*[3-9]\d%|大额减值[^\d]{0,20}(?:亿|万)/i);
  _r(30, !impairRed, true, impairRed ? "🚩 检测到大额减值警示" : "未检测到大额减值");

  // 31 AUTO: PE>40 且无高增长支撑
  const pe = pct(/PE\s*\(?TTM\)?\s*[:：]?\s*([-\d.]+)|PE\s*[-—]\s*TTM\s*[:：]?\s*([-\d.]+)/i) ?? (() => {
    const m = combined.match(/PE\s*\(?TTM\)?[^\d]{0,10}([-\d.]+)/i);
    if (!m) return null; const v = parseFloat(m[1]); return isNaN(v) ? null : v;
  })();
  const niG2 = niG ?? pct(/净利[^\d]{0,10}增[^\d]{0,6}([-\d.]+)\s*%/i);
  let r31ok = true, r31note = "PE 数据缺失";
  if (pe !== null && pe > 0) {
    const peHigh = pe > 40;
    const growthOk = niG2 !== null && niG2 >= 0.25;
    r31ok = !peHigh || growthOk;
    r31note = `PE(TTM)=${pe.toFixed(1)} ${peHigh ? (">40 " + (growthOk ? "且净利增长≥25% ✅" : "且净利增长<25% 🚩")) : "≤40 ✅"}；净利增长=${niG2 === null ? "N/A" : (niG2*100).toFixed(1)+"%"}`;
  }
  _r(31, r31ok, pe !== null, r31note);

  // ======== 汇总 ========
  const checklistMeta: Record<number, { level: "CRITICAL"|"IMPORTANT"|"NORMAL"; label: string }> = {
    4:  { level: "IMPORTANT", label: "三层结构覆盖" },
    8:  { level: "NORMAL",    label: "财报PDF下载" },
    11: { level: "IMPORTANT", label: "毛利率/ROE 护城河信号" },
    14: { level: "NORMAL",    label: "重/轻资产" },
    15: { level: "NORMAL",    label: "商誉占比" },
    25: { level: "CRITICAL",  label: "经营现金流/净利润 ≥0.8（<0.5=NO-GO）" },
    26: { level: "IMPORTANT", label: "ROE ≥12%" },
    27: { level: "IMPORTANT", label: "资产负债率 ≤60%" },
    28: { level: "CRITICAL",  label: "有息负债 / OCF 流动性红线" },
    29: { level: "IMPORTANT", label: "营收+净利双负增长" },
    30: { level: "IMPORTANT", label: "大额减值 >30%净利" },
    31: { level: "IMPORTANT", label: "PE>40 无高增长" },
  };

  let criticalFail = 0, criticalTotal = 0, importantFail = 0, importantTotal = 0, normalFail = 0, normalTotal = 0;
  const noGoFlags: string[] = [];
  Object.keys(checklistMeta).forEach(n => {
    const idx = Number(n);
    const meta = checklistMeta[idx];
    const r = autoResults[idx] ?? { pass: true, checked: false, note: "未执行自动检查" };
    if (meta.level === "CRITICAL") criticalTotal++;
    else if (meta.level === "IMPORTANT") importantTotal++;
    else normalTotal++;
    if (!r.pass) {
      if (meta.level === "CRITICAL") criticalFail++;
      else if (meta.level === "IMPORTANT") importantFail++;
      else normalFail++;
    }
  });

  // No-Go 触发汇总
  if (autoResults[25]?.checked && autoResults[25].note.includes("NO-GO")) noGoFlags.push("OCF/NI 连续 <0.5（盈利质量恶劣）");

  // 最终判定
  let verdict = "✅ 放行";
  if (noGoFlags.length > 0 || criticalFail > 1) verdict = "🚫 暂缓发布";
  else if (criticalFail === 1 || importantFail > 5) verdict = "⚠️ 有条件放行（见备注）";
  const remarks: string[] = [];
  if (criticalFail === 1) remarks.push("有 1 项 CRITICAL 未通过，已在报告风险提示中单独列出。");
  if (importantFail > 5) remarks.push(`有 ${importantFail} 项 IMPORTANT 未通过，需持续跟踪。`);

  // 生成报告 Markdown 块
  let md = `\n## 🧾 50 项投资决策清单（Auto 扫描块）\n\n`;
  md += `> 仅对 [AUTO] 项自动扫描，**[MANUAL] 项需 Agent 逐项人工打钩**。完整模板见 Research/99-Templates/50-item-investment-checklist.md。\n\n`;
  md += `### AUTO 项扫描结果\n`;
  md += `| # | 级别 | 检查项 | 结果 | 说明 |\n|---|------|--------|------|------|\n`;
  Object.keys(checklistMeta).forEach(n => {
    const idx = Number(n);
    const meta = checklistMeta[idx];
    const r = autoResults[idx] ?? { pass: true, checked: false, note: "未执行" };
    const icon = r.checked ? (r.pass ? "✅" : "❌") : "🟡";
    const levelColor = meta.level === "CRITICAL" ? "🔴" : meta.level === "IMPORTANT" ? "🟠" : "⚪️";
    md += `| ${idx} | ${levelColor} ${meta.level} | ${meta.label} | ${icon} | ${r.note.replace(/[|\n]/g, " ")} |\n`;
  });

  md += `\n### AUTO 项统计\n`;
  md += `- 🔴 CRITICAL：**${criticalFail} / ${criticalTotal} 未通过**  ${criticalFail > 1 ? "🚨（>1，需修正）" : "✅"}`;
  md += `\n- 🟠 IMPORTANT：**${importantFail} / ${importantTotal} 未通过** ${importantFail > 5 ? "⚠️（>5）" : "✅"}`;
  md += `\n- ⚪️ NORMAL：**${normalFail} / ${normalTotal} 未通过** ✅`;
  if (noGoFlags.length > 0) md += `\n- 🚫 **一票否决项触发**：${noGoFlags.join("； ")}`;
  md += `\n\n**综合结论：${verdict}**`;
  if (remarks.length > 0) md += `\n\n**备注**：${remarks.join("； ")}`;
  md += `\n\n> Agent: ReportWriter | 扫描时间: ${new Date().toISOString().slice(0,10)}`;

  return {
    autoResults,
    summary: { criticalFail, criticalTotal, importantFail, importantTotal, normalFail, normalTotal, noGoFlags },
    reportMarkdown: md
  };
}

if (import.meta.main) {
  const reportPath = process.argv[2];
  const companyPath = process.argv[3];
  if (!reportPath) {
    console.log(`
用法: bun run investment-checklist-auto.ts <report-md> [company-md]

会输出 AUTO 项扫描结果 Markdown，可直接粘贴到报告附录。
完整 50 项模板见 Research/99-Templates/50-item-investment-checklist.md
`);
    process.exit(1);
  }
  if (!existsSync(reportPath)) { console.error(`❌ 报告文件不存在: ${reportPath}`); process.exit(2); }
  const reportC = readFileSync(reportPath, "utf-8");
  const companyC = companyPath && existsSync(companyPath) ? readFileSync(companyPath, "utf-8") : undefined;
  const { reportMarkdown, summary } = autoScan(reportC, companyC);
  console.log(reportMarkdown);
  if (summary.noGoFlags.length > 0) process.exit(2);
  if (summary.criticalFail > 1) process.exit(1);
}

export { autoScan };
