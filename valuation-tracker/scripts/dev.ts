/**
 * 开发启动脚本 — 并行启动 Elysia API（3001）与 Next.js（3000）
 * 用法：bun run dev
 */
import { spawn } from "node:child_process";

const server = spawn("bun", ["run", "--watch", "server/index.ts"], { stdio: "inherit" });
// Windows 下 node_modules/.bin 只生成 next.exe（无 next 无扩展名文件），直接指向 bin 入口
const web = spawn(process.execPath, ["./node_modules/next/dist/bin/next", "dev", "-p", "3000"], { stdio: "inherit" });

console.log("🚀 估值追踪系统开发模式");
console.log("   API:  http://localhost:3001");
console.log("   Web:  http://localhost:3000");

function shutdown() {
  server.kill();
  web.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
