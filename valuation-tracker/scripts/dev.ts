/**
 * 开发启动脚本 — 并行启动 Elysia API（3001）与 Next.js（3000）
 * 启动前先同步生成静态数据（public/data），保证「改笔记即生效」；
 * 启动后修改 Markdown 需手动重跑 `bun run generate-data`（或重启 dev）。
 * 用法：bun run dev
 */
import { spawn, spawnSync } from "node:child_process";

// 启动前同步生成静态数据（构建期零外部请求，纯本地文件扫描 + frontmatter 解析）
const gen = spawnSync(process.execPath, ["scripts/generate-static-data.ts"], { stdio: "inherit" });
if (gen.status !== 0) {
  console.error("静态数据生成失败，dev 启动中止（请确认 ../Research/ 存在后重试）");
  process.exit(gen.status ?? 1);
}

const server = spawn("bun", ["run", "--watch", "server/index.ts"], { stdio: "inherit" });
// Windows 下 node_modules/.bin 只生成 next.exe（无 next 无扩展名文件），直接指向 bin 入口
const web = spawn(process.execPath, ["./node_modules/next/dist/bin/next", "dev", "-p", "3000"], { stdio: "inherit" });

console.log("🚀 估值追踪系统开发模式");
console.log("   API:  http://localhost:3001");
console.log("   Web:  http://localhost:3000");

// 前端同花顺 key 检测：NEXT_PUBLIC_ 前缀构建期内联，缺失时行情回退东财直连（同花顺优先不生效）
if (!process.env.NEXT_PUBLIC_HITHINK_API_KEY) {
  console.warn(
    "⚠️ 未配置 NEXT_PUBLIC_HITHINK_API_KEY（.env），行情将回退东财直连。\n" +
      "   如需同花顺优先，请在 valuation-tracker/.env 添加 NEXT_PUBLIC_HITHINK_API_KEY=<同花顺key> 后重启 dev。",
  );
}

function shutdown() {
  server.kill();
  web.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
