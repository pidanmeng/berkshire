import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/**
 * 文档布局共享配置：导航标题 + 返回站点首页的链接
 * 顶部导航左侧为站点名（点击回 / 首页），右侧为「估值追踪系统」返回链接。
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="text-[var(--text-primary)]">
          <span className="font-bold">估值追踪系统</span>
          <span className="ml-1 text-xs text-[var(--text-muted)]">文档</span>
        </span>
      ),
      url: '/docs',
    },
    links: [
      {
        text: '返回估值追踪',
        url: '/',
        active: 'none',
      },
    ],
  };
}
