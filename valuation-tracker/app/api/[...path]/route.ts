/**
 * Next.js Route Handler — 将 /api/* 请求转发到 Elysia 应用实例
 * 前后端一体部署（Vercel）：前端页面与 API 同域，无需跨域。
 * 所有方法统一转发 app.handle（Elysia 1.x fetch handler）。
 */
import { type NextRequest } from "next/server";
import { app } from "../../../server/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  return app.handle(req);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as HEAD };
