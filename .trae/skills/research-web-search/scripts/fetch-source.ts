/**
 * URL 正文抓取器 — 直接提取网页内容（bun 环境）
 *
 * 提取策略：
 *   1. 优先使用 r.jina.ai 提取正文（自动处理 SPA + 过滤广告）
 *   2. 降级到 @mozilla/readability（本地算法提取）
 *   3. 最终降级为「仅引用标题和 URL」
 *   4. 财经新闻信源降级为「仅引用」，不再强行提取低质量正文
 *
 * 用法：
 *   bun run fetch-source.ts <url>                     # 抓取 URL 并输出正文
 *   bun run fetch-source.ts <url> --type 研报         # 显式指定类型
 */

import { SOURCES, classifyUrl, SourceType, SourceEntry } from "./sources.ts";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** 是否为低质量/新闻类信源：降级为仅引用 */
const LOW_QUALITY_NEWS_PATTERNS = [
  /cls\.cn/,          // 财联社
  /nbd\.com\.cn/,      // 每经
  /stcn\.com/,        // 证券时报
  /zqrb\.cn/,         // 证券日报
  /yicai\.com/,       // 第一财经
  /eastmoney\.com\/(?!report|data)/, // 东方财富非研报页
  /sina\.com\.cn/,     // 新浪
  /sohu\.com/,         // 搜狐
  /qq\.com/,           // 腾讯
  /163\.com/,          // 网易
  /hexun\.com/,        // 和讯
  /10jqka\.com\.cn/,   // 同花顺非数据页
];

function isLowQualityNews(url: string): boolean {
  return LOW_QUALITY_NEWS_PATTERNS.some((p) => p.test(url));
}

export function usage(): never {
  console.log(`
URL 正文抓取器 (bun)

用法:
  bun run fetch-source.ts <url>                 抓取 URL 并输出正文内容
  bun run fetch-source.ts <url> --type <类型>    显式指定来源类型

提取策略:
  1. 优先: r.jina.ai (AI 正文提取，自动处理 SPA + 过滤广告)
  2. 降级: @mozilla/readability (本地算法)
  3. 最终: 仅引用标题和 URL（对低质量新闻/SPA/反爬页面）

注意: r.jina.ai 对 data.eastmoney.com 等目标站可能返回「安全验证」反爬页，命中后自动走降级；
      外部用户请统一调用本脚本，勿用「WebFetch + r.jina.ai 前缀」直连拼 URL（会命中反爬）。

示例:
  bun run fetch-source.ts "https://www.cninfo.com.cn/new/disclosure/detail?..."
  bun run fetch-source.ts "https://data.eastmoney.com/report/zw_stock.jshtml?..."
`);
  process.exit(1);
}

/** 提取 <title> */
export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? cleanText(m[1]) : "";
}

/** 提取 meta 时间 / 发布时间 */
export function extractDate(html: string): string {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|pubdate|publishdate|date)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|pubdate|publishdate|date)["']/i,
    /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?[\s\d:]*)/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return m[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

export function cleanText(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 第一梯队：r.jina.ai 提取（AI 清洗，支持 SPA） */
async function extractWithJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/http://${url}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // jina 返回的通常很干净，但偶尔会有前缀说明
    const cleaned = text
      .replace(/^Title:\s*.+\n+/im, "")
      .replace(/^URL Source:\s*.+\n+/im, "")
      .replace(/^Markdown Content:\s*\n+/im, "")
      .trim();
    return cleaned.length > 100 ? cleaned : null;
  } catch {
    return null;
  }
}

/** 第二梯队：mozilla/readability 本地提取 */
function extractWithReadability(html: string, url: string): string | null {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article && article.textContent && article.textContent.length > 100) {
      return article.textContent.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/** 第三梯队：简单正则提取（兜底） */
function extractBodyRegex(html: string): string {
  const candidates = [
    /<article[\s\S]*?<\/article>/i,
    /<div[^>]+class=["'][^"']*(?:article|content|main|detail|text|news)[^"']*["'][^>]*>[\s\S]*?<\/div>/i,
    /<div[^>]+id=["'][^"']*(?:article|content|main|detail|text|news)[^"']*["'][^>]*>[\s\S]*?<\/div>/i,
  ];
  for (const re of candidates) {
    const m = html.match(re);
    if (m) {
      const text = cleanText(m[1]);
      if (text.length > 120) return text;
    }
  }
  return cleanText(html);
}

/** 统一提取入口 */
async function extractContent(url: string, html: string): Promise<{ text: string; method: string }> {
  // 1. jina AI
  const jina = await extractWithJina(url);
  if (jina) return { text: jina, method: "jina-ai" };

  // 2. readability
  const readable = extractWithReadability(html, url);
  if (readable) return { text: readable, method: "readability" };

  // 3. regex 兜底
  const regex = extractBodyRegex(html);
  if (regex.length > 200) return { text: regex, method: "regex-fallback" };

  return { text: "", method: "failed" };
}

/** 是否为 PDF/文件直链 */
export function isFileUrl(url: string): boolean {
  return /\.(pdf|doc|docx|xls|xlsx|csv)$/i.test(url.split("?")[0]);
}

async function fetchUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = await res.arrayBuffer();
  const decoders: string[] = ["utf-8", "gb18030", "gbk"];
  for (const enc of decoders) {
    try {
      const text = new TextDecoder(enc).decode(buf);
      if (text.includes("\u4e2d") || text.includes("\u56fd") || /[\u4e00-\u9fa5]/.test(text) || /![\u00c0-\u00ff]/.test(text.slice(0, 100))) {
        return text;
      }
    } catch {}
  }
  return new TextDecoder("utf-8").decode(buf);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0].startsWith("--")) usage();

  // 直接抓取 URL 内容
  const url = args[0];
  const typeIdx = args.indexOf("--type");
  const typeArg = typeIdx >= 0 ? args[typeIdx + 1] as SourceType : undefined;
  const type = typeArg ?? classifyUrl(url);

  try {
    // PDF/文件直链
    if (isFileUrl(url)) {
      console.log(`## 来源条目（自动分类: ${type}）`);
      console.log(`- **URL**: ${url}`);
      console.log(`- **类型**: ${type}`);
      console.log(`- **注意**: 文件直链（PDF/表格），需下载后解析`);
      console.log(`- **下载**: \`bun run .trae/scripts/file-ingestion/fetch-file.ts ${url} --pdf-markdown --output "Research/00-Workspace/02-Processing/pdf-texts/<公司名>/"\``);
      return;
    }

    // 低质量新闻：直接降级为仅引用
    if (isLowQualityNews(url)) {
      console.log(`## 来源条目（自动分类: ${type}）`);
      console.log(`- **来源类型**: ${type}`);
      console.log(`- **URL**: ${url}`);
      console.log(`- **状态**: ⚠️ 财经新闻站点，正文提取质量低，仅引用标题和 URL`);
      console.log(`- **建议**: 如需详情，请直接访问原文；数据事实请优先使用法定披露平台或同花顺 API`);
      console.log(`\n> 原文: ${url}`);
      return;
    }

    const html = await fetchUrl(url);
    const title = extractTitle(html);
    const date = extractDate(html);
    const { text: body, method } = await extractContent(url, html);
    const bodyPreview = body.slice(0, 3000);

    console.log(`## 来源条目（自动分类: ${type} | 提取方式: ${method}）`);
    console.log(`- **来源类型**: ${type}`);
    console.log(`- **标题**: ${title}`);
    console.log(`- **URL**: ${url}`);
    if (date) console.log(`- **发布时间**: ${date}`);
    console.log(`- **可信度初评**: （待 InfoHunter 按来源权威性评估 1-10）`);
    console.log(``);

    if (bodyPreview) {
      console.log(`**正文摘要**（前 3000 字符，提取方式: ${method}）:`);
      console.log(bodyPreview);
    } else {
      console.log(`**正文提取**: ❌ 失败（页面可能为 SPA/反爬/动态渲染）`);
      console.log(`- **建议**: 仅引用标题和 URL，或使用 \`bun run .trae/scripts/file-ingestion/fetch-file.ts ${url} --pdf-markdown --output "Research/00-Workspace/02-Processing/pdf-texts/<公司名>/"\` 尝试下载`);
    }
    console.log(`\n> 原文: ${url}`);
  } catch (err) {
    console.error(`❌ 抓取失败: ${(err as Error).message}`);
    process.exit(1);
  }
}

// 直接运行时执行 main；被 import 时不执行
if (import.meta.main) main();
export { main, extractContent, extractWithJina, extractWithReadability, extractBodyRegex, isLowQualityNews };
