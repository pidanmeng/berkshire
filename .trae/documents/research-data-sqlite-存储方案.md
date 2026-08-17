# 调研数据改存 SQLite：构建时 vs 运行时评估与实施方案

## 一、背景与问题

### 1.1 现状：Markdown 打包进 Vercel 产物

当前数据流（`valuation-tracker/`）：

1. **事实源**：`../Research/`（Git 仓库内的 Markdown 笔记 + 初筛 JSON），运行时解析（`server/lib/research.ts`，gray-matter + 60s 缓存）。
2. **打包**：构建前 `scripts/sync-research-data.ts` 把 4 类数据复制到 `valuation-tracker/research-data/`：
   - `10-Knowledge/*.md`（公司笔记 + deep-dive-update）
   - `02-Processing/*deep-read*.md`（年报精读）
   - `02-Processing/pdf-texts/*.{md,txt}`（年报原文）
   - `07-Screener/*.json`（全市场初筛看板）
3. **上传**：`.vercelignore` 保留 `research-data/` 上传（Vercel 云端构建环境访问不到 `../Research`，只能靠本地上传的副本）。
4. **打包进函数**：`next.config.mjs` 的 `outputFileTracingIncludes: { "/*": ["./research-data/**/*"] }` 把整个目录打进函数包。
5. **运行时读取**：`resolveResearchRoot()` 依次探测 `RESEARCH_ROOT` → 仓库根（dev）→ `research-data` → `.next` 兜底，命中即读。

### 1.2 实测体积（2026-08-18 测量）

| 数据 | 文件数 | 体积 |
|------|-------|------|
| 10-Knowledge（.md） | 57 | 1.0 MB |
| deep-read（.md） | 29 | 1.5 MB |
| pdf-texts（.md/.txt） | 184 | 49.4 MB |
| 07-Screener（.json） | 3 | 13.1 MB |
| **合计（打包进函数）** | **~270** | **65.5 MB（未压缩）** |

### 1.3 Vercel 约束（官方文档确认）

- 单函数包 **未压缩 ≤ 250 MB**，**压缩后 ≈ 50 MB**（AWS Lambda 限制，先触顶的是压缩后体积）。
- 叠加 Next.js standalone 输出 + `node_modules`，当前 65.5 MB 数据 + 框架体积已接近压缩上限；且每调研一家公司约新增 6-8 个年报文档（1-3 MB），数据量持续增长。
- 另有单次部署文件数上限（数千到万级），当前 ~270 个文件不构成威胁，但同样是隐患。

### 1.4 目标

将「需要的文档」由「多文件树打包」改为「单文件 SQLite 数据库（内容 gzip 压缩）」，显著降低函数包体积与文件数；并评估入库发生在哪个阶段（构建时 / 运行时）。

---

## 二、阶段评估：入库应在构建时（核心决策）

### 2.1 候选方案对比

| 维度 | A. 构建时入库（推荐） | B. 运行时入库（Turso 外部 DB） |
|------|----------------------|------------------------------|
| 数据存放 | `research-data/research.db`，随部署打进函数包，运行时只读 | 外部 SQLite（Turso），bundle 内不携带数据，运行时按 `TURSO_URL` 读 |
| 函数包体积 | 65.5 MB → **~19 MB**（gzip 后） | **0 MB**（数据不在包内） |
| 运行时网络依赖 | 无（纯本地只读文件） | 有（冷启动依赖外部 DB 可达性/延迟） |
| 新增基础设施 | 无（`@libsql/client` 已是依赖） | 需要 Turso 账号 + seed 流程管理 |
| 确定性/可测试 | 高（本地可复现、可冒烟） | 中（依赖远端状态） |
| 数据新鲜度 | 随部署发布，天然一致 | 需每次数据变更后 seed |
| 与现有架构契合 | 完全契合（复用 research-data 上传链路） | 需改造 db.ts 降级链路并新增 doc 读写接口 |

### 2.2 结论：构建时入库（A），运行时（B）作为未来扩展路径

理由：

1. **Vercel 函数文件系统只读**（除 /tmp），且 /tmp 是每实例临时目录、实例间不共享——"运行时把文档写进本地 SQLite"在 Serverless 上不成立；运行时入库唯一可行形态是**外部 DB（Turso）**，需要额外基础设施与网络依赖。
2. **构建时方案改动最小**：复用现有 `research-data/` 上传 + `outputFileTracingIncludes` 打包链路，仅把"复制文件树"换成"生成单文件 research.db"；dev/自托管模式（能直接访问 `../Research`）完全不受影响。
3. **实测压缩收益显著**：65.5 MB → 18.2 MB（gzip level 9，约 28%），文件数 ~270 → 1，同时缓解体积与文件数双重约束。
4. **无冷启动网络开销、无外部服务成本/可用性风险**，符合自托管/Serverless 双形态。
5. **扩展路径**：当数据量逼近上限（函数包未压缩 250 MB）时，`build-research-db.ts` 增加 `--remote` 模式把同一份数据 upsert 到 Turso，运行时按 `TURSO_URL` 优先读外部 DB（复用现有 `store-turso.ts` 基建与 `TURSO_URL` 环境变量约定），bundle 内不再携带数据。**本次不实现，仅在文档中标注扩展点。**

> 补充说明：Vercel 已提供 Large Functions Beta（5 GB，Fluid Compute），是另一种兜底路径，但依赖 Fluid Compute 且需配置开关，不是根本解法；SQLite 压缩方案对所有形态通用。

---

## 三、目标方案（构建时 SQLite）

### 3.1 数据流（改造后）

```
本地/CI：
  bun run sync-data
    → scripts/build-research-db.ts 读 ../Research/ 4 类数据
    → gzip(level 9) 压缩正文 → 写入 research-data/research.db（单文件）
    → 生成 research-data/manifest.json（计数/体积/生成时间）
    ↓ npx vercel --prod（research-data/ 照常上传）
Vercel 云端：
  next build → outputFileTracingIncludes 把 research-data/ 打进函数包
运行时（Vercel 集成部署）：
  openDocStore() 探测到 research-data/research.db → SqliteDocStore（@libsql/client file: 只读 + gunzip）
运行时（dev / 自托管，仓库在本机）：
  探测到 ../Research → FsDocStore（直接读文件，行为不变）
```

### 3.2 SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS documents (
  id       INTEGER PRIMARY KEY,
  kind     TEXT    NOT NULL,   -- note | deep-read | annual-report | screener
  path     TEXT    NOT NULL UNIQUE,  -- 相对 research-data 的路径，如 Research/10-Knowledge/04-电子/02-公司研究/宁德时代-公司研究.md
  content  BLOB    NOT NULL,   -- gzipSync(content, level 9)
  raw_size INTEGER NOT NULL,   -- 原始字节数
  mtime    TEXT                -- 源文件修改时间（ISO，调试用）
);
CREATE INDEX IF NOT EXISTS idx_docs_kind ON documents(kind);
```

要点：
- **只存原始文本，frontmatter 解析仍在运行时做**（gray-matter）——解析逻辑只保留在 `research.ts` 一处，避免构建脚本复制解析规则造成漂移；"Markdown 为唯一事实源"语义不变。
- `kind` 按 sync-research-data.ts 的 4 个同步范围归类，`path` 保持相对路径以便按目录前缀检索（如 `loadCompanyUpdates` 按公司目录过滤）。
- 内容 gzip 压缩是**本方案体积收益的核心**（65.5 MB → 18.2 MB），必须启用。

---

## 四、具体改动（文件级）

### 4.1 新建 `valuation-tracker/scripts/build-research-db.ts`（替换 sync-research-data.ts 的角色）

**What**：构建期脚本，用 `bun:sqlite`（Bun 原生，批量写入快）扫描 `../Research/` 生成 `research-data/research.db` + `research-data/manifest.json`。

**Why**：把 4 类数据从多文件树变成单文件压缩库，是解决 Vercel 体积约束的核心改动。

**How**：
- 目录定位、`../Research` 缺失时早退（保留已上传 DB，与现有 sync-research-data.ts 行为一致，兼容 Vercel 云端构建无源数据场景）——**必须在 `rmSync` 之前早退**。
- 扫描范围与现有 sync-research-data.ts 完全一致（10-Knowledge 全量 .md；02-Processing 根 `*deep-read*.md`；pdf-texts `*.{md,txt}`；07-Screener `*.json`）。
- 单条 `INSERT ... ON CONFLICT(path) DO UPDATE`（幂等重建：先 DROP/重建表或先建临时库再替换）。
- `manifest.json` 记录 `generatedAt`、各 `kind` 计数、raw/compressed 字节数、源路径说明，便于部署后排查。
- 控制台输出体积对比（raw vs compressed），便于 CI 观察。

### 4.2 修改 `valuation-tracker/package.json`

- `"sync-data": "bun run scripts/build-research-db.ts"`（沿用命令名，内部换实现，README/AGENTS.md 引用不变）。
- `"build"` 保持 `"bun run sync-data && next build"` 不变。
- 无新增依赖（`@libsql/client` 已是依赖；构建脚本用 bun:sqlite 内建）。

### 4.3 删除 `valuation-tracker/scripts/sync-research-data.ts`

**Why**：文件树复制逻辑被 build-research-db.ts 取代，保留会造成双份维护。删除后确认无其他引用（仅 package.json）。

### 4.4 新建 `valuation-tracker/server/lib/doc-store.ts`（存储后端抽象）

**What**：数据源抽象，两个实现 + 一个探测入口。

**Why**：`research.ts` / `screener.ts` 的读取点（listDir/readFile/stat）在 FS 与 SQLite 两种模式下形态不同，抽象后上层公共函数零改动。

**How**：

```ts
export interface DocStore {
  describe(): { kind: "fs" | "sqlite"; root?: string; dbFile?: string; generatedAt?: string };
  listNotePaths(): string[];                     // 10-Knowledge 下所有 .md 相对路径（公司笔记 + update）
  readFile(relPath: string): string | null;      // 读原始文本（sqlite 实现内部 gunzip）
  listDeepReadPaths(): string[];                 // kind=deep-read 的文件名
  listAnnualReportPaths(name: string): string[]; // kind=annual-report 且路径前缀 pdf-texts/<name>/ 的文件名
  readDoc(kind: "deep-read" | "annual-report", fileName: string): { content: string; sizeBytes: number } | null;  // 校验 fileName 无路径分隔符
  readScreenerJson(): string | null;             // latest-screener.json 原文
}
```

- `FsDocStore`：封装现有 `resolveResearchRoot()` + `readdirSync/readFileSync/statSync` 逻辑（把 research.ts 里的 FS 细节收拢进来）。
- `SqliteDocStore`：`createClient({ url: "file:research.db" })`（`@libsql/client`，**已验证 Bun 与 Node 22 均可用本地 file: 模式**，见下方验证记录）；只读查询 + `gunzipSync`。
- `openDocStore()`：探测顺序——`research-data/research.db` 存在 → SqliteDocStore；否则 → FsDocStore。探测路径复用现有 `resolveResearchRoot()` 的候选目录（`RESEARCH_ROOT` → 仓库根 → `research-data` → `.next` 兜底），标记改为「该目录下存在 `research.db`」（现有标记是「存在 `Research/10-Knowledge`」，两者并存：先探 DB 再探 FS 目录）。

> 验证记录（本会话实测）：`@libsql/client@0.14` 的 `createClient({ url: "file:xxx.db" })` 在本机 Bun 与 Node v22.15.0 均成功建表/读写。运行时兼容 Vercel Node runtime（纯 JS 客户端 + libsql 本地引擎）。计划验证步骤 6.4 增加「bun:sqlite 建库 → @libsql/client 读取」的交叉读取冒烟，确保两驱动互读兼容。

### 4.5 修改 `valuation-tracker/server/lib/research.ts`

**What**：公共 API 不变（`loadCompanies` / `findCompany` / `readNoteBody` / `loadCompanyUpdates` / `loadCompanyDocs` / `readCompanyDoc` / `cacheStat`），内部读取改为经 `doc-store`。

**Why**：上层路由（`server/routes/companies.ts`）与前端（`lib/api.ts`）契约零变化，改动面收敛在数据源层。

**How**：
- 模块顶部 `const store = openDocStore()`（惰性单例）。
- `loadCompanies()`：由「FS 双重目录遍历」改为 `store.listNotePaths()` + `store.readFile()`，frontmatter `type` 过滤逻辑（`company` vs `deep-dive-update`）保留——`loadCompanyUpdates` 从同一路径列表按**目录前缀 + type** 过滤（SQLite 模式无绝对路径可 join，统一用相对路径前缀）。
- `notePath` 字段语义：FS 模式保留绝对路径（内部仅用于 readFile/update 定位，前端类型 `lib/api.ts` 不含 `notePath`，已验证无外部消费）；SQLite 模式存相对路径。`readNoteBody` / `loadCompanyUpdates` 改为经 `store.readFile(relPath)`。
- `scanDeepReads(name)` / `scanAnnualReports(name)`：改为 `store.listDeepReadPaths()` / `store.listAnnualReportPaths(name)`，文件名匹配逻辑（`includes(name)`、`includes("deep-read")`）不变。
- `readCompanyDoc()`：`basename(fileName) !== fileName` 的路径穿越校验保留；读文件改经 `store.readDoc()`。
- `resolveResearchRoot()` 保留，新增 `resolveResearchDbPath()` 探测（并入 doc-store 的 `openDocStore`）。

### 4.6 修改 `valuation-tracker/server/lib/screener.ts`

**What**：`loadScreener()` 的 `latest-screener.json` 读取改为经 `store.readScreenerJson()`（FS/SQLite 双实现）。

**Why**：初筛看板 JSON 同样随包发布（13.1 MB），一并纳入 SQLite 压缩。

**How**：`screenerFile()` + `readFileSync` → `readScreenerJson()`；60s 缓存与 `researched` 标记逻辑不变。

### 4.7 不变项（确认无需改动）

- `next.config.mjs`：`outputFileTracingIncludes: ["./research-data/**/*"]` 自动覆盖 `research.db` + `manifest.json`。
- `.vercelignore`：`research-data/` 仍需上传，保留。
- `.gitignore`：`valuation-tracker/research-data` 已忽略，保留。
- `server/routes/*`、`lib/api.ts`、前端组件：无改动。
- `db.ts` / `store-sqlite.ts` / `store-turso.ts`（动态状态层：价格快照、基本面检测）：**不参与本次改造**，研究文档与动态状态分库存储，职责清晰。

### 4.8 文档同步

- `valuation-tracker/README.md`：数据流段落更新（构建期 `sync-data` 生成 research.db；运行时 Vercel 走 SQLite、dev 走 FS）。
- `AGENTS.md`「估值追踪系统」数据流/部署段落：同步一句说明（Markdown 仍为唯一事实源，部署时由构建脚本入库压缩）。

### 4.9 测试（遵循仓库"新/改脚本配套测试"约定）

- 新建 `valuation-tracker/scripts/__tests__/build-research-db.test.ts`（`bun test`）：
  - 用临时 fixture 目录构造 4 类样本文件（note/deep-read/annual-report/screener JSON，含中文文件名与 frontmatter）；
  - 断言：DB 生成、kind 归类正确、gzip 往返一致（解压后与原文相等）、manifest 计数正确；
  - 断言：`../Research` 缺失时早退且不破坏已存在的 DB。
- 新建 `valuation-tracker/server/lib/__tests__/doc-store.test.ts`：
  - 同一 fixture 分别走 FsDocStore 与 SqliteDocStore，断言两类输出一致（listNotePaths / readFile / readDoc / readScreenerJson）；
  - 断言路径穿越校验（`../` 拒绝）。
- 语法检查：`bun build --no-bundle` 通过（项目约定）。

---

## 五、假设与决策

| # | 假设/决策 | 说明 |
|---|----------|------|
| 1 | **入库时机 = 构建时** | 见第二节评估；运行时（Turso）仅作文档化扩展点，本次不实现 |
| 2 | **库内只存原始文本，frontmatter 运行时解析** | 解析规则唯一（research.ts），避免双份维护；"Markdown 唯一事实源"语义不变 |
| 3 | **内容 gzip 压缩** | 体积收益核心（65.5→18.2 MB），运行时按需 gunzip + 60s 缓存，性能可接受 |
| 4 | **dev/自托管仍走 FS 直读** | 保留"改笔记即时生效"；SQLite 仅是 Vercel 部署产物，不改变本地工作流 |
| 5 | **研究文档与动态状态分库** | `research.db`（只读数据）与 `tracker.db`/Turso（动态状态）职责分离，互不耦合 |
| 6 | **命令名 `sync-data` 保留** | 内部换实现，避免 README/文档/习惯全部改动 |
| 7 | **@libsql/client file: 模式作为 Vercel 运行时读取器** | 已是依赖；Bun/Node 22 实测可用。若 Vercel Node 环境异常，回退选项：`node:sqlite`（Node 22.13+）或 better-sqlite3（Vercel 官方支持原生模块），接口不变 |
| 8 | **Vercel 部署形态 = 前后端集成（Next.js + Elysia 一体）** | 由 `.vercelignore`、`outputFileTracingIncludes`、`app/api/[...path]/route.ts` 转发等代码证据支撑；自托管形态不受影响 |

---

## 六、验证步骤

1. `bun install`（确认无新依赖）。
2. `bun test valuation-tracker/scripts/__tests__/build-research-db.test.ts valuation-tracker/server/lib/__tests__/doc-store.test.ts`（全部通过）。
3. `bun build --no-bundle` 语法检查新/改脚本，exit 0。
4. `bun run sync-data`：生成 `research-data/research.db` + `manifest.json`，控制台打印体积对比（期望 raw ~65 MB → compressed ~19 MB，文件数 270 → 1）。
5. **交叉驱动冒烟**：用 bun:sqlite 生成的 research.db，写一个一次性 `bun -e` 脚本用 `@libsql/client file:` 读取，断言能读出并解压成功（验证构建/运行时两驱动互读）。
6. **dev 回归**：`bun run dev`，访问 `/api/companies`、`/api/companies/:thscode`、`/api/screener`、文档读取端点（deep-read / annual-report），与改造前行为一致（dev 走 FS 后端）。
7. **SQLite 后端冒烟**：临时设置环境强制走 SqliteDocStore（或在本地存在 research.db 时直接验证 `openDocStore()` 探测顺序），重复第 6 步断言结果一致。
8. （可选）`npx vercel build` / 部署 Preview，确认 `research.db` 被 `outputFileTracingIncludes` 打进函数包、线上 `/api/companies` 正常返回。

---

## 七、规模与风险

### 7.1 效果预估

| 指标 | 现状 | 改造后 |
|------|------|--------|
| 打包文件数 | ~270 | 1（+ manifest.json） |
| 打包体积（未压缩） | 65.5 MB | ~19 MB |
| dev/自托管读取 | FS 直读 ../Research | 不变 |
| Vercel 读取 | 扫描 research-data 文件树 | 打开 research.db（只读） |
| 运行时新增依赖 | — | `@libsql/client`（已是依赖） |

### 7.2 风险与对策

| 风险 | 对策 |
|------|------|
| `@libsql/client file:` 在 Vercel Node 环境不兼容 | 验证步骤 5 先本地 Node 复现；失败则切换 `node:sqlite` / better-sqlite3（DocStore 接口不变，仅换实现） |
| 大文档 gunzip 解压延迟 | 文档按需读取 + 60s 缓存；单篇最大 ~0.9 MB，gunzip <10ms |
| 构建脚本在 Vercel 云端误删已上传 DB | 保留"../Research 缺失早退于 rmSync 之前"逻辑（与现有 sync-research-data.ts 一致） |
| 未来数据继续增长逼近 250 MB | 扩展路径：`build-research-db.ts --remote` seed 到 Turso；或 Vercel Large Functions（5 GB Beta） |
