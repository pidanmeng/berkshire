/**
 * 流程模式路由建议
 *
 * 用法：
 *   bun run route-mode.ts --topic "主题" --last-research "2026-01-15" --decision-critical true
 */

interface RouteResult {
  mode: "standard" | "fast" | "deep" | "incremental";
  reason: string;
  phases: string[];
}

function route(topic: string, lastResearch: string | null, decisionCritical: boolean, incrementalTarget: string | null): RouteResult {
  // 深度模式优先
  if (decisionCritical) {
    return {
      mode: "deep",
      reason: "重大决策场景，启用深度模式（强制四大师评估 + 财报精读 + 3年历史回溯）",
      phases: ["Phase 1 全量采集", "Phase 2 结构化提取", "Phase 3 深度验证", "Phase 4 知识入库", "Phase 5 双报告", "Phase 6 归档"],
    };
  }

  // 增量模式
  if (incrementalTarget) {
    return {
      mode: "incremental",
      reason: `定向补充 ${incrementalTarget}，跳过全量行业采集`,
      phases: ["Phase 1 定向采集", "Phase 4 增量写入"],
    };
  }

  // 快速模式判断
  if (lastResearch) {
    const lastDate = new Date(lastResearch);
    const daysDiff = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff < 90) {
      return {
        mode: "fast",
        reason: `该主题 ${Math.round(daysDiff)} 天前有研究覆盖，启用快速模式`,
        phases: ["Phase 1 精简采集", "Phase 2 快速处理", "Phase 3 轻量验证", "Phase 4 增量更新", "Phase 5 简版报告"],
      };
    }
  }

  // 默认标准模式
  return {
    mode: "standard",
    reason: "全新主题或超过90天未更新，启用标准六阶段流程",
    phases: ["Phase 1 采集", "Phase 2 处理", "Phase 3 验证", "Phase 4 入库", "Phase 5 报告", "Phase 6 归档"],
  };
}

function usage(): never {
  console.log(`
流程模式路由建议

用法:
  bun run route-mode.ts --topic "主题名称" [--last-research YYYY-MM-DD] [--decision-critical true] [--incremental-target "公司名/细分赛道"]

示例:
  bun run route-mode.ts --topic "新能源-锂电池" --last-research 2026-01-15
  bun run route-mode.ts --topic "宁德时代" --decision-critical true
  bun run route-mode.ts --topic "半导体" --incremental-target "AI芯片"
`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const topicIdx = args.indexOf("--topic");
  const lastIdx = args.indexOf("--last-research");
  const criticalIdx = args.indexOf("--decision-critical");
  const incrementalIdx = args.indexOf("--incremental-target");

  if (topicIdx < 0) usage();

  const topic = args[topicIdx + 1];
  const lastResearch = lastIdx >= 0 ? args[lastIdx + 1] : null;
  const decisionCritical = criticalIdx >= 0 ? args[criticalIdx + 1] === "true" : false;
  const incrementalTarget = incrementalIdx >= 0 ? args[incrementalIdx + 1] : null;

  if (!topic) usage();

  const result = route(topic, lastResearch, decisionCritical, incrementalTarget);

  console.log(`# 流程模式路由建议\n`);
  console.log(`- **主题**: ${topic}`);
  console.log(`- **推荐模式**: ${result.mode}`);
  console.log(`- **理由**: ${result.reason}\n`);
  console.log(`## 执行阶段`);
  result.phases.forEach((p, i) => console.log(`${i + 1}. ${p}`));
  console.log(`\n> 使用: /research ${topic} --mode ${result.mode}`);
}

if (import.meta.main) main();
export { route };
