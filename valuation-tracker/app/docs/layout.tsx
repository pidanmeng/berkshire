import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import { baseOptions } from '@/lib/layout.shared';
import { pageTree } from '@/lib/docs';

export default function DocsLayoutPage({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout
        tree={pageTree}
        {...baseOptions()}
        // 站点固定暗色黑金风格：禁用主题切换与搜索（未接入搜索索引）
        themeSwitch={{ enabled: false }}
        searchToggle={{ enabled: false }}
        sidebar={{ defaultOpenLevel: 1 }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
