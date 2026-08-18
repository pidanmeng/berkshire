/**
 * 网络诊断探针（临时端点，根因定位后删除）
 * GET /api/diag/net → 从当前函数环境对多个目标做 DNS 解析 + HTTP 连通性测试
 * 对照组设计：
 *   - hithink  / fuyao.aicubes.cn   同花顺网关（国内）
 *   - eastmoney / push2.eastmoney.com 东财行情（国内）
 *   - baidu    / www.baidu.com        国内对照组
 *   - github   / api.github.com       海外对照组
 * 用途：区分「全部出口不可用 / 特定域名 DNS 失败 / 特定对端被封锁」。
 */
import { Elysia } from "elysia";
import { lookup } from "node:dns/promises";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TARGETS = [
  { name: "hithink", url: "https://fuyao.aicubes.cn/" },
  { name: "eastmoney", url: "https://push2.eastmoney.com/api/qt/ulist.np/get?secids=0.300750&fields=f2,f3,f12,f13,f14,f20,f100&fltt=2" },
  { name: "eastmoney-his", url: "https://push2his.eastmoney.com/" },
  { name: "baidu", url: "https://www.baidu.com/" },
  { name: "github", url: "https://api.github.com/" },
];

function describeErr(err: unknown): string {
  const e = err as { message?: string; cause?: unknown };
  let cause: { code?: unknown; message?: unknown } | undefined;
  let cur: unknown = e?.cause;
  while (cur != null && typeof cur === "object") {
    const c = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (c.code !== undefined || c.message !== undefined) {
      cause = c;
      cur = c.cause;
    } else break;
  }
  const causePart = cause ? `code=${String(cause.code ?? "")} ${String(cause.message ?? "")}`.trim() : "";
  return `${e?.message ?? "fetch failed"}${causePart ? ` (${causePart})` : ""}`;
}

export const diagRoutes = new Elysia({ prefix: "/api" }).get("/diag/net", async () => {
  const results: unknown[] = [];
  for (const t of TARGETS) {
    const host = new URL(t.url).hostname;

    // 1) DNS 解析（与 fetch 同走系统 getaddrinfo）
    let dns: unknown;
    try {
      const addrs = await lookup(host, { all: true });
      dns = addrs.map((a) => `${a.family === 6 ? "IPv6" : "IPv4"}:${a.address}`);
    } catch (err) {
      dns = `DNS_FAIL: ${describeErr(err)}`;
    }

    // 2) HTTP 连通性（短超时，仅作探针）
    let http: unknown;
    const started = Date.now();
    try {
      const res = await fetch(t.url, {
        headers: { "User-Agent": UA },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      http = { status: res.status, ms: Date.now() - started };
    } catch (err) {
      http = { error: describeErr(err), ms: Date.now() - started };
    }

    results.push({ name: t.name, host, dns, http });
  }

  return {
    ts: Date.now(),
    runtime: "nodejs",
    functionRegion: process.env.VERCEL_REGION ?? "unknown",
    awsRegion: process.env.AWS_REGION ?? "unknown",
    results,
  };
});
