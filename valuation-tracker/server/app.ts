/**
 * Elysia 应用实例 — 估值追踪系统 API
 * 独立于运行方式（Bun 自托管 listen / Next.js route handler / Serverless fetch）。
 * 运行入口见 index.ts（Bun 自托管）与 app/api/[...path]/route.ts（Next.js 集成）。
 */
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import metricsMiddleware from "elysia-prometheus-metrics";
import { companiesRoutes } from "./routes/companies.ts";
import { quotesRoutes } from "./routes/quotes.ts";
import { klineRoutes } from "./routes/kline.ts";
import { fundamentalsRoutes } from "./routes/fundamentals.ts";
import { screenerRoutes } from "./routes/screener.ts";
import { messagesRoutes } from "./routes/messages.ts";
import { serverTiming } from '@elysia/server-timing'

export const app = new Elysia()
  .use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"],
  }))
  .use(serverTiming())
  // 性能监控：Prometheus 格式直方图（请求耗时/状态码/路径），端点 /api/metrics
  .use(metricsMiddleware({ metricsPath: "/api/metrics" }))
  .get("/api/health", () => ({ ok: true, ts: Date.now() }))
  .use(companiesRoutes)
  .use(quotesRoutes)
  .use(klineRoutes)
  .use(fundamentalsRoutes)
  .use(screenerRoutes)
  .use(messagesRoutes)
  .onError(({ code, error }) => {
    console.error(`[Elysia] ${code}: ${(error as Error).message}`);
    return new Response(JSON.stringify({ error: code, message: (error as Error).message }), {
      status: code === "NOT_FOUND" ? 404 : 500,
      headers: { "Content-Type": "application/json" },
    });
  });

// Serverless 兼容：导出 fetch handler（Vercel Function 等）
export const fetch = app.fetch;
