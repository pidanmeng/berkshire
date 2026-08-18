import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import { baseOptions } from '@/lib/layout.shared';
import { pageTree } from '@/lib/docs';
import AppIconRail from '@/components/AppIconRail';

export default function DocsLayoutPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh min-w-0 w-full overflow-hidden">
      {/* 最左侧页面导航 ICON 列（与主站一致） */}
      <AppIconRail className="h-full" />
      <div className="fd-scope min-h-0 min-w-0 flex-1 overflow-y-auto">
        <RootProvider search={{ enabled: false }}>
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
      </div>
    </div>
  );
}
