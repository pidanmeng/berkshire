/**
 * 留言板管理员鉴权 — 极简密码体系（单管理员，无多用户/无会话过期）
 * 密码配置在后端环境变量 ADMIN_TOKEN；登录成功后签发确定性 token（密码单向哈希派生），
 * 后端重启不失效；token 由前端存 sessionStorage，后续请求头 Authorization: Bearer <token>。
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** 读取 ADMIN_TOKEN 配置；未配置返回 null（管理员登录禁用） */
export function getAdminTokenConfig(): string | null {
  const token = process.env.ADMIN_TOKEN?.trim();
  return token ? token : null;
}

function hash(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

/** 校验管理员密码（恒定时间比较，防时序侧信道） */
export function verifyAdminPassword(password: string): boolean {
  const cfg = getAdminTokenConfig();
  if (!cfg) return false;
  const a = hash(password);
  const b = hash(cfg);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 签发登录 token（密码单向哈希派生，确定性，重启不失效） */
export function issueAdminToken(): string {
  return createHash("sha256").update(`vt-admin:${getAdminTokenConfig()}`).digest("hex");
}

/** 校验请求携带的 token */
export function verifyAdminToken(token: string | null | undefined): boolean {
  if (!token) return false;
  if (!getAdminTokenConfig()) return false;
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(issueAdminToken(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
