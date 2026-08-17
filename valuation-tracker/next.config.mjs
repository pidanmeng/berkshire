/** @type {import('next').NextConfig} */
import { fileURLToPath } from "node:url";

const nextConfig = {
  reactStrictMode: true,
  // 纯 UI + Elysia 集成：前后端一体部署（/api 由 app/api/[...path]/route.ts 转发）
  output: "standalone",
  // 仓库根有多个 lockfile（bun.lock），显式指定追踪根消除构建警告。
  // 必须用 fileURLToPath 转成本机绝对路径：URL.pathname 在 Windows 返回 /C:/...（POSIX 前导斜杠），
  // 会导致 standalone 目录路径计算错误而静默失败（不生成 .next/standalone）。
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  // 运行时动态读取的调研数据（scripts/sync-research-data.ts 构建期生成）打包进函数包
  outputFileTracingIncludes: {
    "/*": ["./research-data/**/*"],
  },
  // bun:sqlite 仅 Bun 运行时存在；Node（Vercel）下由 db.ts 降级到 Turso/内存
  serverExternalPackages: ["bun:sqlite"],
};

export default nextConfig;
