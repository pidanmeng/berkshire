/**
 * KQI 记录与趋势追踪
 *
 * 用法：
 *   bun run kqi-tracker.ts --record --topic "主题" --source-coverage 0.92 ...
 *   bun run kqi-tracker.ts --report --month 2026-01
 *   bun run kqi-tracker.ts --backtrack --report <path> --days 30
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const METRICS_DIR = "Research/00-Workspace/05-Metrics";
const KQI_FILE = join(METRICS_DIR, "kqi-history.json");

interface KQIRecord {
  timestamp: string;
  topic: string;
  sourceCoverage: number | null;
  highConfidenceRatio: number | null;
  fourMastersCoverage: number | null;
  predictionAccuracy: number | null;
  revisionCount: number;
  mode: string;
  phaseScores: { phase: number; total: number; verdict: string }[];
}

function ensureMetricsDir() {
  if (!existsSync(METRICS_DIR)) {
    mkdirSync(METRICS_DIR, { recursive: true });
  }
}

function loadHistory(): KQIRecord[] {
  if (!existsSync(KQI_FILE)) return [];
  try {
    return JSON.parse(readFileSync(KQI_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveHistory(records: KQIRecord[]) {
  ensureMetricsDir();
  writeFileSync(KQI_FILE, JSON.stringify(records, null, 2));
}

function record(args: Record<string, string | number | null | boolean>) {
  const records = loadHistory();
  const record: KQIRecord = {
    timestamp: new Date().toISOString(),
    topic: (args.topic as string) || "unknown",
    sourceCoverage: args.sourceCoverage !== undefined ? parseFloat(String(args.sourceCoverage)) : null,
    highConfidenceRatio: args.highConfidenceRatio !== undefined ? parseFloat(String(args.highConfidenceRatio)) : null,
    fourMastersCoverage: args.fourMastersCoverage !== undefined ? parseFloat(String(args.fourMastersCoverage)) : null,
    predictionAccuracy: null,
    revisionCount: args.revisionCount !== undefined ? parseInt(String(args.revisionCount), 10) : 0,
    mode: (args.mode as string) || "standard",
    phaseScores: [],
  };
  records.push(record);
  saveHistory(records);
  console.log(`✅ KQI 已记录: ${record.topic} @ ${record.timestamp}`);
}

function generateReport(month: string) {
  const records = loadHistory().filter(r => r.timestamp.startsWith(month));
  if (records.length === 0) {
    console.log(`ℹ️ ${month} 无记录`);
    return;
  }

  const avg = (key: keyof KQIRecord) => {
    const vals = records.map(r => r[key] as number | null).filter(v => v !== null) as number[];
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const reportPath = join(METRICS_DIR, `${month}-质量趋势报告.md`);
  const report = `# ${month} 质量趋势报告

> 生成时间: ${new Date().toISOString().slice(0, 10)}
> 样本数: ${records.length} 次研究

## 平均指标

| KQI | 平均值 | 目标值 | 状态 |
|-----|--------|--------|------|
| 来源覆盖率 | ${(avg("sourceCoverage") ?? "—")} | >90% | ${(avg("sourceCoverage") ?? 0) >= 0.9 ? "✅" : "⚠️"} |
| 高置信度占比 | ${(avg("highConfidenceRatio") ?? "—")} | >70% | ${(avg("highConfidenceRatio") ?? 0) >= 0.7 ? "✅" : "⚠️"} |
| 四大师覆盖率 | ${(avg("fourMastersCoverage") ?? "—")} | 100% | ${(avg("fourMastersCoverage") ?? 0) >= 1.0 ? "✅" : "⚠️"} |
| 平均返工次数 | ${(avg("revisionCount") ?? "—")} | <1 | ${(avg("revisionCount") ?? 0) < 1 ? "✅" : "⚠️"} |

## 详细记录

| 时间 | 主题 | 模式 | 来源覆盖率 | 高置信度占比 | 返工次数 |
|------|------|------|-----------|-------------|---------|
${records.map(r => `| ${r.timestamp.slice(0, 10)} | ${r.topic} | ${r.mode} | ${r.sourceCoverage ?? "—"} | ${r.highConfidenceRatio ?? "—"} | ${r.revisionCount} |`).join("\n")}

## 改进建议

<!-- 基于数据趋势自动生成 -->
${(avg("sourceCoverage") ?? 0) < 0.9 ? "- 来源覆盖率未达标，建议加强 Phase 1 采集深度\n" : ""}${(avg("highConfidenceRatio") ?? 0) < 0.7 ? "- 高置信度占比偏低，建议提高来源质量或加强验证\n" : ""}${(avg("fourMastersCoverage") ?? 0) < 1.0 ? "- 四大师覆盖率不足，需检查 Agent 提示词执行情况\n" : ""}
`;

  writeFileSync(reportPath, report);
  console.log(`✅ 质量趋势报告已生成: ${reportPath}`);
}

function backtrack(reportPath: string, days: number) {
  console.log(`# 质量回溯: ${reportPath} (${days} 天后)\n`);
  console.log("ℹ️ 请人工评估以下内容并记录：");
  console.log("1. 报告中的核心预测是否被验证？偏差多大？");
  console.log("2. 反向检查清单中的风险情景是否发生？");
  console.log("3. 跟踪指标的变化趋势是否符合预期？");
  console.log("\n请使用 --record 更新 predictionAccuracy 字段。");
}

function usage(): never {
  console.log(`
KQI 记录与趋势追踪

用法:
  # 记录一次研究的 KQI
  bun run kqi-tracker.ts --record --topic "主题" --source-coverage 0.92 --high-confidence-ratio 0.75 --four-masters-coverage 1.0 --revision-count 0 --mode standard

  # 生成月度质量报告
  bun run kqi-tracker.ts --report --month 2026-01

  # 质量回溯
  bun run kqi-tracker.ts --backtrack --report <path> --days 30
`);
  process.exit(1);
}

function parseArgs(): Record<string, string | number | null | boolean> {
  const args = process.argv.slice(2);
  const result: Record<string, string | number | null | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = args[i + 1];
      if (val && !val.startsWith("--")) {
        result[key] = val;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

async function main() {
  const args = parseArgs();

  if (args.record !== undefined) {
    record(args);
    return;
  }

  if (args.report !== undefined) {
    const month = (args.month as string) || new Date().toISOString().slice(0, 7);
    generateReport(month);
    return;
  }

  if (args.backtrack !== undefined) {
    const reportPath = args.report as string;
    const days = args.days !== undefined ? parseInt(String(args.days), 10) : 30;
    if (!reportPath) usage();
    backtrack(reportPath, days);
    return;
  }

  usage();
}

if (import.meta.main) main();
export { record, generateReport, backtrack };
