/** @type {import('next').NextConfig} */
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";

const nextConfig = {
  reactStrictMode: true,
  // 纯 UI + Elysia 集成：前后端一体部署（/api 由 app/api/[...path]/route.ts 转发）
  output: "standalone",
  // 仓库根有多个 lockfile（bun.lock），显式指定追踪根消除构建警告。
  // 必须用 fileURLToPath 转成本机绝对路径：URL.pathname 在 Windows 返回 /C:/...（POSIX 前导斜杠），
  // 会导致 standalone 目录路径计算错误而静默失败（不生成 .next/standalone）。
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  // 运行时动态读取的调研数据（scripts/build-research-db.ts 构建期生成）打包进函数包；
  // ws 由 @libsql/client 的 Node 传输层静态依赖，但会被 Next 外部化剔除（standalone 不带），
  // 显式包含以确保 Turso 兜底（懒加载 @libsql）在云上可用。
  outputFileTracingIncludes: {
    "/*": ["./research-data/**/*", "./node_modules/ws/**/*"],
  },
  // bun:sqlite 仅 Bun 运行时存在；Node（Vercel）下由 db.ts 降级到 Turso/内存
  serverExternalPackages: ["bun:sqlite"],
};

// Fumadocs MDX：编译 content/docs/ 下的 .mdx 文档并生成 .source/ 产物（next dev/build 时执行）
const withMDX = createMDX();

export default withMDX(nextConfig);
