# 腾讯云 SSR 函数包体积优化方案

> 状态：待评审
> 日期：2026-08-29
> 目标：把函数包体积与调研文档数据量解耦，长期稳定在 128MiB 限制以内

---

## 1. 问题

腾讯云 Cloud SSR 部署报错：

```
Error: Cloud SSR Node functions package size exceeds 128MiB limit (145MiB)
```

本机实测体积构成（2026-08-29）：

| 组成部分 | 体积 | 是否随调研数据增长 |
|---|---|---|
| `public/data/docs/`（调研文档静态拷贝，原文 Markdown）| ≈56MiB | 是 |
| `research-data/research.db`（同一批内容 gzip level 9）| ≈18MiB | 是 |
| 代码 + 运行时（`.next/standalone` + 静态 JS/CSS + ws）| ≈71MiB | 否，固定 |
| **合计** | **≈145MiB** | — |

关键发现：

1. **数据重复打包**：`public/data/docs/` 与 `research-data/research.db` 是**同一批数据的两份形态**——前者由 `scripts/generate-static-data.ts` 生成的原始 Markdown 拷贝，后者由 `scripts/build-research-db.ts` gzip 压缩后的 SQLite。二者都被 `next.config.mjs` 的 `outputFileTracingIncludes` 强制打进函数包。
2. **SSG 并不依赖文档正文**：页面预渲染（SSG）只依赖 `public/data/companies.json`（实测仅 188KB 的元数据索引）。文档正文是浏览器**运行时按需 fetch** 的静态文件（`CompanyDashboard` → `ResearchDocsTabs` → `/data/docs/...`），不属于 SSG 产物。
3. **数据增长不可回避**：Research/ 现有原文 155MB（30+ 家公司）。按每家公司 +3MiB 打包估算，即便现在压线，数据翻倍必然再次顶穿 128MiB。**任何"数据塞进函数包"的方案都不可持续。**

## 2. 目标架构

```
┌─────────────────────────────────────────────┐
│ 函数包（≈71MiB，恒定）                          │
│  ├─ 代码 + 运行时（standalone + ws）             │
│  └─ public/data/companies.json（188KB 元数据）   │
└──────────────┬──────────────────────────────┘
               │
   ┌───────────┼───────────────────────────┐
   ▼           ▼                           ▼
SSG 页面     浏览器文档正文              服务端 API
(预渲染)     (COS 静态直连, 按需拉取)      (doc-store → Turso)
```

- **函数包只留代码 + companies.json**，与数据量解耦
- **文档正文 → 腾讯云 COS**（浏览器直连静态 URL，最贴近现状的"静态拉取"体验）
- **research.db → Turso**（服务端 API 读，`doc-store.ts` 探测链自动降级，链路代码已就绪）

## 3. 方案对比与推荐

| 维度 | A2：COS + CDN（推荐） | A1：API → Turso | B：Cloudflare R2 |
|---|---|---|---|
| 国内访问速度 | 快（大陆节点，同地域 <10ms）| 快（腾讯云内网）| **慢**（免费计划无大陆节点，绕行港/日/新加坡） |
| 默认域名可用性 | 可用 | — | **默认域名国内被墙，必须绑自定义域名** |
| 免费额度 | 个人 50GB 存储/6 个月 | 免费额度够用 | 10GB 存储 + **出站流量全免** |
| 超出后成本 | 存储 ~0.118 元/GB/月，流量 ~0.49 元/GB（量级每月几毛）| Turso 免费额度 | $0.015/GB/月 |
| 需要配置 | SecretId/SecretKey + 桶 + CORS | 无新增（TURSO_URL 已有）| 需绑信用卡 + 自定义域名托管到 CF |
| 改动量 | 中（新增上传脚本 + 改 docUrl）| 小（链路已就绪）| 中（同 COS，且域名托管改动大） |
| 持续可扩展 | 是（存储不占函数包）| 是 | 是 |

**结论**：主链路推荐 **COS**（用户已有腾讯云账号、部署在腾讯云、面向国内访问）。R2 免费额度慷慨但**国内访问是硬伤**，不适合做面向大陆的主链路；可作离岸备份兜底，不推荐作为 CDN 方案。

## 4. 详细改动清单（COS 方案）

### 4.1 新增脚本

**`scripts/upload-docs-cos.ts`** —— 构建期把 `public/data/docs/` 增量上传到 COS：

- 用 `cos-nodejs-sdk-v5`（或 `coscmd` 子进程），S3/COS 标准 API
- 增量同步：对比本地文件 mtime/大小，只上传变更文件（文档量大、每次全量上传浪费时间与请求数）
- 产物可选：生成 `docs-manifest.json`（上传清单 + 时间戳）供排查
- 失败退出码非 0，阻断部署

### 4.2 修改文件

| 文件 | 改动 |
|---|---|
| `next.config.mjs` | `outputFileTracingIncludes` 中：移除 `./research-data/**/*`；把 `./public/data/**/*` 收窄为 `./public/data/companies.json`；**保留 `./node_modules/ws/**/*`**（doc-store 现在更依赖 Turso，ws 是 @libsql Node 传输层必需） |
| `package.json` | `build` 前挂 `generate-data` 已存在；**新增部署前置命令**：`predeploy` = `sync-data:remote && upload-docs-cos`（明确写进流程，当前 sync-data 未接入 build） |
| `lib/api.ts` | `docUrl()`（`#L337-L345`）：文档 base URL 从 `/data/docs/` 改为 `${NEXT_PUBLIC_DOCS_BASE_URL}/docs/`（COS 访问域名），由环境变量控制，本地 dev 仍走 `/data/docs/` |
| `components/ResearchDocsTabs.tsx` | 文档正文 fetch 地址改经 `docUrl()`（若已统一用 docUrl 则只改 api.ts 一处） |
| `components/CompanyDashboard.tsx` | 同上，确认所有 `/data/docs/` 引用都走统一工具函数 |
| `scripts/generate-static-data.ts` | 增加开关（如 `SKIP_DOCS_COPY=1`）：生产构建不再写 `public/data/docs/`（只留 companies.json），避免 56MiB 进包 |

### 4.3 配置项（腾讯云 SSR 环境变量 + 本地 `.env`）

```
# COS（文档正文）
COS_SECRET_ID=
COS_SECRET_KEY=
COS_BUCKET=research-docs-<appid>
COS_REGION=ap-shanghai
NEXT_PUBLIC_DOCS_BASE_URL=https://<bucket>.cos.<region>.myqcloud.com   # 或 CDN/自定义域名

# Turso（服务端研究文档，复用动态状态层约定）
TURSO_URL=
TURSO_AUTH_TOKEN=
```

密钥只存服务端环境变量 / CI secret；`.env` 已在 `.vercelignore`，不得提交 git。

### 4.4 COS 控制台一次性配置

1. 开通 COS，创建桶（选就近地域，如 `ap-shanghai`）
2. 访问管理 CAM 创建**子账号** + 最小权限（仅该桶读写）
3. 桶配置 **CORS 规则**：`AllowedOrigin = 腾讯云 SSR 站点域名`、`AllowedMethod = GET`（浏览器直连必需）
4. 可选：绑自定义域名（需已备案）或开 CDN；量小可不配，直接用 COS 默认域名

## 5. 部署流程（两种形态）

**Git 集成 / 仓库根上传**（云端构建，clone 含 `../Research`）：
```
云端构建：generate-data（companies.json）→ next build
云端部署前：sync-data --remote（推 Turso）→ upload-docs-cos（推文档）
```
构建环境需配置上述密钥环境变量。

**CLI 从 valuation-tracker/ 目录上传**（构建环境无 `../Research`）：
```
本地：bun run generate-data
       bun run sync-data --remote
       bun run upload-docs-cos
       bun run build
然后上传（剔除 research-data/ 与 public/data/docs，.vercelignore 补充规则）
```

## 6. 运行时降级链路（doc-store）

`doc-store.ts` 探测链在云上变为：`FS（无 ../Research，跳过）→ 打包 research.db（已剔除，跳过）→ Turso（主路径）`。

- Turso 可用 → 服务端 API 正常读研究文档
- Turso 不可用 → 降级 FS 空目录（列表为空、文档 tab 提示加载失败），**不崩溃**；列表页仍可用（companies.json 在包内）

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 文档 tab 多一跳网络 | COS 同地域 <10ms 量级；且是用户主动点击动作，非首屏 |
| Turso 同步失败导致服务端读旧数据 | `sync-data --remote` 失败已置 exit code 1 阻断部署（build-research-db.ts 已实现）|
| COS 密钥泄露 | 子账号最小权限 + 仅存环境变量；泄露可随时吊销轮换 |
| CORS 配置遗漏导致浏览器拉取失败 | 验收步骤包含浏览器实测文档 tab |
| 需要回滚 | 恢复 `next.config.mjs` 两行 tracing + 保留 docs 生成开关，重新打包即可 |

## 8. 验收标准

- [ ] 本地 `bun run build` 后 standalone 输出（含 companies.json）< 80MiB
- [ ] 部署后 `/api/health` 正常，服务端 API 能从 Turso 读到研究文档
- [ ] 浏览器打开公司详情 → 文档 tab 能从 COS URL 拉到正文（实测 CORS 生效）
- [ ] SSG 不变：看板页 / 公司详情页首屏预渲染内容与改前一致
- [ ] 新增一家公司后，函数包体积不增长（数据只进 COS/Turso）

## 9. 可选后续优化（非本次范围）

- research.db 内容改用 brotli 压缩（再省 10~15%）
- 代码侧瘦身：echarts 按需引入已做，`lucide-react` tree-shake、next 平台二进制裁剪等（71MiB 固定部分可再挤 10~20MiB）
- 文档走 COS 后，可考虑把 COS 桶开启 CDN + 缓存策略，进一步压访问延迟与流量费
