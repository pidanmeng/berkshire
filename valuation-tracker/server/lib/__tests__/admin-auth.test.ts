/**
 * 留言板管理员鉴权测试 — 密码校验 / token 签发与校验 / 未配置时禁用
 * 运行：bun test valuation-tracker/server/lib/__tests__/admin-auth.test.ts
 */
import { describe, test, expect } from "bun:test";
import { getAdminTokenConfig, issueAdminToken, verifyAdminPassword, verifyAdminToken } from "../admin-auth.ts";

process.env.ADMIN_TOKEN = "s3cret"; // 模块级设置，避免 bun test 钩子执行顺序干扰

describe("已配置 ADMIN_TOKEN", () => {
  test("getAdminTokenConfig 返回配置值", () => {
    expect(getAdminTokenConfig()).toBe("s3cret");
  });

  test("正确密码通过，错误密码拒绝", () => {
    expect(verifyAdminPassword("s3cret")).toBe(true);
    expect(verifyAdminPassword("wrong")).toBe(false);
    expect(verifyAdminPassword("")).toBe(false);
  });

  test("token 签发后可校验通过，非法 token 拒绝", () => {
    const t = issueAdminToken();
    expect(t).toBeTruthy();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAdminToken(t)).toBe(true);
    expect(verifyAdminToken("bad-token")).toBe(false);
    expect(verifyAdminToken("")).toBe(false);
    expect(verifyAdminToken(null)).toBe(false);
    expect(verifyAdminToken(undefined)).toBe(false);
  });
});

describe("未配置 ADMIN_TOKEN", () => {
  test("登录功能禁用：配置为空、密码校验失败、token 校验失败", () => {
    const saved = process.env.ADMIN_TOKEN;
    try {
      delete process.env.ADMIN_TOKEN;
      expect(getAdminTokenConfig()).toBeNull();
      expect(verifyAdminPassword("s3cret")).toBe(false);
      expect(verifyAdminToken(issueAdminToken())).toBe(false);
    } finally {
      process.env.ADMIN_TOKEN = saved;
    }
  });
});
