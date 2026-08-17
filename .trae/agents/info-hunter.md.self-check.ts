/**
 * InfoHunter 阶段内自检脚本
 * 用法: bun run info-hunter.md.self-check.ts <raw-file-path>
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

interface CheckResult {
  pass: boolean;
  score: number; // 0-10
  issues: string[];
}

function check(rawPath: string): CheckResult {
  const issues: string[] = [];
  let score = 10;

  try {
    const content = readFileSync(rawPath, "utf-8");

    // 1. 检查三层结构完整性
    const hasLayer1 = /第 1 层[:：]\s*行业级/.test(content);
    const hasLayer2 = /第 2 层[:：]\s*细分行业级/.test(content);
    const hasLayer3 = /第 3 层[:：]\s*公司级/.test(content);
    if (!hasLayer1) issues.push("缺少第 1 层：行业级结构");
    if (!hasLayer2) issues.push("缺少第 2 层：细分行业级结构");
    if (!hasLayer3) issues.push("缺少第 3 层：公司级结构");

    // 2. 检查来源充分性（充分性标准，替代数量硬线）
    //    原则：数量是自然结果而非目标——检查「关键论点是否有权威来源、核心数据是否多源交叉验证」，而不是凑来源总数。
    const sourceMatches = content.match(/来源\d+[:：]/g) || [];
    const sourceCount = sourceMatches.length;
    // 2a. 每一层至少 1 个来源标记（有实质采集内容，而非空壳层）
    const layerBlocks = content.split(/第 \d 层[:：]/);
    const layerTitles = ["行业级", "细分行业级", "公司级"];
    for (let i = 0; i < layerTitles.length; i++) {
      const block = layerBlocks[i + 1];
      if (block !== undefined && !/来源\d+[:：]/.test(block)) {
        issues.push(`${layerTitles[i]}层缺少来源标记，请确认该层有实质采集内容（而非空壳）`);
        score -= 1;
      }
    }
    // 2b. 完全无来源 → 硬性失败
    if (sourceCount === 0) {
      issues.push("未找到任何来源标记（来源N:），采集可能为空");
      score -= 2;
    }
    // 2c. 来源偏少仅作提示不扣分——关键论点的证据强度比来源总数更重要
    if (sourceCount > 0 && sourceCount < 3) {
      issues.push(`提示：来源总数仅 ${sourceCount} 个。请自查：关键论点是否有权威来源支撑？核心数据是否 ≥2 独立来源交叉验证？小众主题单源支撑的论点请显式标注「单源支撑，置信度上限 6」`);
    }

    // 3. 检查 URL 锚点
    const urlMatches = content.match(/https?:\/\//g) || [];
    if (urlMatches.length === 0) {
      issues.push("未找到任何 URL 来源锚点");
      score -= 2;
    }

    // 4. 检查四大师视角搜索清单
    const hasBafeite = /巴菲特|护城河/.test(content);
    const hasMangge = /芒格|逆向思维/.test(content);
    const hasDuan = /段永平|生意模式/.test(content);
    const hasLilu = /李录|文明趋势/.test(content);
    if (!hasBafeite) issues.push("缺少巴菲特（护城河）视角搜索");
    if (!hasMangge) issues.push("缺少芒格（逆向思维）视角搜索");
    if (!hasDuan) issues.push("缺少段永平（生意模式）视角搜索");
    if (!hasLilu) issues.push("缺少李录（文明趋势）视角搜索");

    // 5. 检查研究偏见校验
    const hasBiasCheck = /研究偏见|反向关键词|反向搜索/.test(content);
    if (!hasBiasCheck) {
      issues.push("缺少研究偏见校验");
      score -= 1;
    }

    // 6. 检查待验证点
    const hasVerifyPoints = /待验证点/.test(content);
    if (!hasVerifyPoints) issues.push("缺少待验证点清单");

    // 7. 检查财报 Markdown 文件事实
    const hasFinancialReport = /财报原文|定期报告|年报PDF|半年报PDF|季报PDF|fetch-file\.ts|pdfjs|PDF (?:文本|Markdown)提取/.test(content);
    if (!hasFinancialReport) {
      issues.push("未检测到财报原文（PDF Markdown 提取）数据，公司级数据应优先获取一手财报");
      score -= 2;
    }
    const declaredPdfFiles = [...content.matchAll(/(?:Research[\\/])?00-Workspace[\\/]02-Processing[\\/]pdf-texts[\\/][^\s`\"']+\.md/g)].map((match) => match[0]);
    if (hasLayer3 && declaredPdfFiles.length === 0) {
      issues.push("公司级采集未声明任何财报 Markdown 文件路径");
      score -= 2;
    }
    const rawRoot = resolve(dirname(rawPath), "..", "..", "..");
    for (const declared of declaredPdfFiles) {
      const candidate = isAbsolute(declared) ? declared : resolve(rawRoot, declared);
      if (!existsSync(candidate) || !statSync(candidate).isFile()) {
        issues.push(`财报 Markdown 文件不存在：${declared}`);
        score -= 1;
        continue;
      }
      const markdown = readFileSync(candidate, "utf-8");
      const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const requiredFields = ["pdf_title", "source", "page_count", "parse_confidence", "pages_needing_ocr", "has_encoding_issues"];
      if (!frontmatter || requiredFields.some((field) => !new RegExp(`^${field}:`, "m").test(frontmatter[1]))) {
        issues.push(`财报 Markdown frontmatter 不完整：${declared}`);
        score -= 1;
        continue;
      }
      const metadata = frontmatter[1];
      const confidenceValue = metadata.match(/^parse_confidence:\s*([^\r\n]+)/m)?.[1].trim();
      const confidence = confidenceValue === undefined ? Number.NaN : Number(confidenceValue);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        issues.push(`财报 Markdown parse_confidence 非法：${declared}`);
        score -= 2;
      } else if (confidence < 0.8) {
        issues.push(`财报 Markdown 解析置信度低于 0.8：${declared}（${confidence}）`);
        score -= 2;
      }
      const encodingValue = metadata.match(/^has_encoding_issues:\s*([^\r\n]+)/m)?.[1].trim().toLowerCase();
      if (encodingValue !== "true" && encodingValue !== "false") {
        issues.push(`财报 Markdown has_encoding_issues 必须为布尔值：${declared}`);
        score -= 1;
      } else if (encodingValue === "true") {
        issues.push(`财报 Markdown 存在编码异常，必须重提取或更换来源：${declared}`);
        score -= 2;
      }
      const ocrValue = metadata.match(/^pages_needing_ocr:\s*([^\r\n]+)/m)?.[1].trim();
      if (!ocrValue || !/^\[.*\]$/.test(ocrValue)) {
        issues.push(`财报 Markdown pages_needing_ocr 格式非法：${declared}`);
        score -= 1;
      } else if (ocrValue !== "[]") {
        issues.push(`财报 Markdown 仍有页面需要 OCR：${declared}（${ocrValue}）`);
        score -= 2;
      }
      const body = markdown.slice(frontmatter[0].length);
      const replacementCount = (body.match(/�/g) || []).length;
      if (replacementCount > 0) {
        issues.push(`财报 Markdown 正文检测到 ${replacementCount} 个 Unicode 替换字符：${declared}`);
        score -= 2;
      }
    }

    // 8. 检查是否包含估值/股价数据
    const hasValuation = /PE[-_]?TTM|PB[-_]?MRQ|PS[-_]?TTM|估值快照|最新价|股价|last_price|getValuations/.test(content);
    if (hasLayer3 && !hasValuation) {
      issues.push("公司级数据缺少估值与股价信息（PE-TTM / PB-MRQ / 最新价），应调用 hithink API 获取");
      score -= 1;
    }

    // 9. 检查研报依赖是否过度（研报应作为辅助，不应是核心来源）
    const reportCount = (content.match(/券商研报|研报中心|东方财富研报|慧博|研报客/g) || []).length;
    const finReportCount = (content.match(/财报原文|定期报告|年报|半年报|季报|巨潮资讯|cninfo/g) || []).length;
    if (hasLayer3 && reportCount > finReportCount && finReportCount === 0) {
      issues.push("研报引用多于财报原文，应优先使用一手财报，研报仅作辅助参考");
      score -= 1;
    }

  } catch (err) {
    issues.push(`读取文件失败: ${(err as Error).message}`);
    score = 0;
  }

  const pass = issues.length === 0 || score >= 7;
  return { pass, score: Math.max(0, score), issues };
}

// CLI
if (import.meta.main) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log("用法: bun run info-hunter.md.self-check.ts <raw-file-path>");
    process.exit(1);
  }
  const result = check(filePath);
  console.log(`# InfoHunter 自检报告: ${filePath}\n`);
  console.log(`- 评分: ${result.score}/10`);
  console.log(`- 结果: ${result.pass ? "✅ 通过" : "❌ 不通过"}\n`);
  if (result.issues.length > 0) {
    console.log("## 问题清单");
    result.issues.forEach((issue, i) => console.log(`${i + 1}. ❌ ${issue}`));
  } else {
    console.log("✅ 所有检查项通过");
  }
  process.exit(result.pass ? 0 : 1);
}

export { check };
