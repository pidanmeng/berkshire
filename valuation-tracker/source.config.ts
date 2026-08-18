import { defineConfig, defineDocs } from 'fumadocs-mdx/config';

/**
 * 文档内容源配置（Fumadocs MDX 13）：
 * - `content/docs/` 目录下的 .mdx 文件即文档页面
 * - 页面 frontmatter 支持 title / description / icon / full 等字段
 * - 侧边栏分组可通过 `content/docs/meta.json` 调整
 */
export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig();
