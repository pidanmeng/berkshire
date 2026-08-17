/**
 * Elysia 后端入口 — 估值追踪系统 API（Bun 自托管模式）
 * 默认端口 3001；CORS 允许前端（本地 dev http://localhost:3000）。
 * 运行：bun run server/index.ts（或 bun run dev）
 * 说明：Elysia 实例已抽出到 app.ts，供 Next.js route handler（app/api/[...path]/route.ts）复用。
 */
import { app } from "./app.ts";

const PORT = Number(process.env.PORT) || 3001;

// Bun 专有属性：直接执行（bun run server/index.ts）时为 true；Node/Next 环境为 undefined
// 用类型断言避免 ImportMeta 缺 main 声明的类型错误（Next/Vercel 类型检查）
const isMain = (import.meta as unknown as { main?: boolean }).main === true;

if (isMain) {
  app.listen(PORT, () => {
    console.log(`🦊 估值追踪 API 已启动: http://localhost:${PORT}`);
    console.log(`   健康检查: http://localhost:${PORT}/api/health`);
  });
}
