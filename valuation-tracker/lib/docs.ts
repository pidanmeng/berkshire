import { loader } from 'fumadocs-core/source';
import { docs } from '../.source';

/**
 * 文档内容源（Fumadocs MDX 13 标准接入）：
 * - baseUrl: '/docs' —— 文档页挂载在 /docs 路由下
 * - source: docs.toFumadocsSource() —— 由 source.config.ts 定义的内容目录（content/docs）生成
 * `.source/` 目录（含 index.ts）在 `next dev` / `next build` 时由 fumadocs-mdx 插件自动生成。
 */
export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});

export const { getPage, getPages, pageTree } = source;
