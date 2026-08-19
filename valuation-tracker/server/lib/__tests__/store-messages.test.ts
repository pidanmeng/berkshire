/**
 * 留言存储层测试 — memory 与 sqlite（临时库路径）实现行为一致
 * 运行：bun test valuation-tracker/server/lib/__tests__/store-messages.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryStore, type Store } from "../store.ts";
import { createSqliteStore } from "../store-sqlite.ts";

let root: string;
let sqliteStorePromise: Promise<Store>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "msg-store-test-"));
  sqliteStorePromise = createSqliteStore(join(root, "tracker.db"));
});

/** Windows 文件句柄释放有延迟，rmSync 可能瞬时 EBUSY，重试直至成功 */
async function safeRm(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

afterAll(async () => {
  await safeRm(root);
});

for (const name of ["memory", "sqlite"] as const) {
  describe(`留言存储（${name}）`, () => {
    // 每个测试自建 fresh memory store；sqlite 共享同一临时库（测试互不依赖留言状态）
    async function freshStore(): Promise<Store> {
      return name === "memory" ? createMemoryStore() : (await sqliteStorePromise)!;
    }

    test("getAnnouncement：初始为 null", async () => {
      const store = await freshStore();
      expect(await store.getAnnouncement()).toBeNull();
    });

    test("setAnnouncement：设置后可读、覆盖更新并刷新 updatedAt", async () => {
      const store = await freshStore();
      const a1 = await store.setAnnouncement("第一条公告");
      expect(a1.content).toBe("第一条公告");
      expect(a1.updatedAt).toBeTruthy();
      expect(await store.getAnnouncement()).toEqual(a1);

      // 覆盖更新：内容替换、updatedAt 刷新
      await new Promise((r) => setTimeout(r, 5));
      const a2 = await store.setAnnouncement("更新后的公告");
      expect(a2.content).toBe("更新后的公告");
      expect(new Date(a2.updatedAt).getTime()).toBeGreaterThan(new Date(a1.updatedAt).getTime());
      const got = await store.getAnnouncement();
      expect(got).not.toBeNull();
      expect(got!.content).toBe("更新后的公告");
      expect(got!.updatedAt).toBe(a2.updatedAt);
    });

    test("createMessage：初始为未回复，不出现在公开列表，出现在全部列表", async () => {
      const store = await freshStore();
      const m = await store.createMessage({ type: "qa", content: "测试留言" });
      expect(m.id).toBeGreaterThan(0);
      expect(m.type).toBe("qa");
      expect(m.reply).toBeNull();
      expect(m.replied_at).toBeNull();
      expect(m.tip_amount).toBeNull();
      expect(m.created_at).toBeTruthy();

      const replied = await store.listRepliedMessages();
      expect(replied.find((x) => x.id === m.id)).toBeUndefined();

      const all = await store.listAllMessages();
      expect(all.find((x) => x.id === m.id)).toBeDefined();
    });

    test("replyMessage：回复 + 标注打赏，公开列表可见", async () => {
      const store = await freshStore();
      const m = await store.createMessage({ type: "wish", content: "想看宁德时代" });
      const updated = await store.replyMessage(m.id, "已收到，正在安排", 5);
      expect(updated).not.toBeNull();
      expect(updated!.reply).toBe("已收到，正在安排");
      expect(updated!.replied_at).toBeTruthy();
      expect(updated!.tip_amount).toBe(5);
      expect(updated!.tip_marked_at).toBeTruthy();

      const replied = await store.listRepliedMessages();
      const found = replied.find((x) => x.id === m.id);
      expect(found).toBeDefined();
      expect(found!.reply).toBe("已收到，正在安排");
      expect(found!.tip_amount).toBe(5);
    });

    test("replyMessage：不传打赏则保持无打赏标注", async () => {
      const store = await freshStore();
      const m = await store.createMessage({ type: "feature", content: "加个暗色开关" });
      const updated = await store.replyMessage(m.id, "好建议", null);
      expect(updated!.reply).toBe("好建议");
      expect(updated!.tip_amount).toBeNull();
      expect(updated!.tip_marked_at).toBeNull();
    });

    test("replyMessage：id 不存在返回 null", async () => {
      const store = await freshStore();
      expect(await store.replyMessage(999999, "x", null)).toBeNull();
    });

    test("deleteMessage：删除后列表不再包含，不存在返回 false", async () => {
      const store = await freshStore();
      const m = await store.createMessage({ type: "qa", content: "待删除" });
      expect(await store.deleteMessage(m.id)).toBe(true);
      const all = await store.listAllMessages();
      expect(all.find((x) => x.id === m.id)).toBeUndefined();
      const replied = await store.listRepliedMessages();
      expect(replied.find((x) => x.id === m.id)).toBeUndefined();
      expect(await store.deleteMessage(m.id)).toBe(false);
    });

    test("列表按创建时间倒序", async () => {
      const store = await freshStore();
      const a = await store.createMessage({ type: "other", content: "第一条" });
      await new Promise((r) => setTimeout(r, 5));
      const b = await store.createMessage({ type: "other", content: "第二条" });
      await store.replyMessage(a.id, "r1", null);
      await store.replyMessage(b.id, "r2", null);

      const replied = await store.listRepliedMessages();
      const idxA = replied.findIndex((x) => x.id === a.id);
      const idxB = replied.findIndex((x) => x.id === b.id);
      expect(idxA).toBeGreaterThanOrEqual(0);
      expect(idxB).toBeGreaterThanOrEqual(0);
      expect(idxB).toBeLessThan(idxA); // b 后创建，排在前面
    });
  });
}
