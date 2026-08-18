'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CompanyItem } from '@/lib/api';
import { getCompanies } from '@/lib/api';
import type { Layout } from 'react-resizable-panels';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import AppIconRail from './AppIconRail';
import TagSidebar, { buildTagStats } from './TagSidebar';
import CompanySidebar from './CompanySidebar';
import WatchlistTable from './WatchlistTable';
import CompanyDashboard from './CompanyDashboard';
import CompareTable from './CompareTable';
import DonateDialog from './DonateDialog';
import { useDashboardStore } from '@/lib/dashboard-store';

/** 右侧分割（公司列表 | 主内容）宽度布局持久化 key */
const SPLIT_LAYOUT_KEY = 'valuation-split-layout';

/** 默认右侧分割（flexGrow）：公司列表 / 主内容 */
const DEFAULT_LAYOUT: Layout = { companies: 14, main: 86 };

export default function Dashboard({
  initial,
}: {
  initial: { list: CompanyItem[]; fetchedAt: number };
}) {
  const [items, setItems] = useState<CompanyItem[]>(initial.list);
  const [lastUpdated, setLastUpdated] = useState<number>(initial.fetchedAt);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 选择状态（标签 / 公司 / 单选多选模式）由 zustand store 统一管理
  const selectedTags = useDashboardStore((s) => s.selectedTags);
  const selectedCompanies = useDashboardStore((s) => s.selectedCompanies);
  const companyMultiSelect = useDashboardStore((s) => s.companyMultiSelect);
  const toggleCompany = useDashboardStore((s) => s.toggleCompany);
  const selectCompany = useDashboardStore((s) => s.selectCompany);
  const clearCompanies = useDashboardStore((s) => s.clearCompanies);

  const onLayoutChanged = useCallback(
    (layout: Layout, meta: { isUserInteraction: boolean }) => {
      if (!meta.isUserInteraction) return;
      try {
        window.localStorage.setItem(SPLIT_LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        // 存储不可用时忽略（如隐私模式）
      }
    },
    [],
  );

  // 60s 轮询刷新行情
  useEffect(() => {
    timerRef.current = setInterval(async () => {
      try {
        const data = await getCompanies();
        setItems(data.list);
        setLastUpdated(data.fetchedAt);
        setError(null);
      } catch {
        setError('实时行情刷新失败（Elysia 后端不可达）');
      }
    }, 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const tagStats = useMemo(() => buildTagStats(items), [items]);

  // 按 tag 过滤后的公司（无 tag 选中 = 全部）
  const tagFiltered = useMemo(
    () =>
      selectedTags.length === 0
        ? items
        : items.filter((it) => selectedTags.every((t) => it.tags.includes(t))),
    [items, selectedTags],
  );

  const companyByCode = useMemo(
    () => new Map(items.map((it) => [it.thscode, it])),
    [items],
  );
  const selectedItems = useMemo(
    () =>
      selectedCompanies
        .map((c) => companyByCode.get(c))
        .filter((x): x is CompanyItem => !!x),
    [selectedCompanies, companyByCode],
  );

  // 主区域模式
  const mode =
    selectedCompanies.length === 0
      ? 'list'
      : selectedCompanies.length === 1
        ? 'single'
        : 'compare';
  const activeCode = selectedCompanies[0] ?? null;

  // 主表格行点击：跟随当前单选/多选模式
  const handleTableSelect = (code: string) =>
    companyMultiSelect ? toggleCompany(code) : selectCompany(code);

  const stats = useMemo(() => {
    const deep = tagFiltered.filter(
      (i) => i.zone.zone === 'deep_undervalued',
    ).length;
    const low = tagFiltered.filter((i) => i.zone.zone === 'undervalued').length;
    const anchor = tagFiltered.filter((i) => i.targetMarketCapYi).length;
    const update = tagFiltered.filter((i) => i.needsUpdate === true).length;
    const hasUpdate = tagFiltered.filter(
      (i) => (i.updateCount ?? 0) > 0,
    ).length;
    const avgChg = (() => {
      const list = tagFiltered
        .map((i) => i.quote.changePct)
        .filter((v): v is number => v != null);
      if (list.length === 0) return null;
      return +(list.reduce((a, b) => a + b, 0) / list.length).toFixed(2);
    })();
    return {
      total: tagFiltered.length,
      deep,
      low,
      anchor,
      update,
      hasUpdate,
      avgChg,
    };
  }, [tagFiltered]);

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': '17rem',
          '--sidebar-width-icon': '2.5rem',
        } as CSSProperties
      }
    >
      {/* ===== 左面板：ICON 列（并排于行业列表左侧，仅图标，hover tooltip）+ 行业/标签；收起时保留 ICON 列 ===== */}
      <Sidebar collapsible="icon">
        <div className="flex h-full min-h-0 w-full">
          <AppIconRail className="h-full" />
          <SidebarContent className="group-data-[collapsible=icon]:hidden min-w-0 flex-1">
            <TagSidebar tags={tagStats} />
          </SidebarContent>
        </div>
        <SidebarRail />
      </Sidebar>

      {/* 右侧：header 固定 + 内容区占满视口剩余高度，整页不滚动 */}
      <div className="flex h-dvh min-w-0 w-full flex-col overflow-hidden">
        <header className="px-4 py-2 flex items-center justify-between border-b">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="-ml-2" />
            <div>
              <h1 className="text-xl font-bold">估值追踪系统</h1>
              <div className="text-xs text-text-muted mt-2">
                基于投研 Agent 产出 · 市值 vs 安全边际监控 ·
                综合分为系统加权计算
              </div>
            </div>
          </div>
          <DonateDialog />
        </header>
        {/* ===== 右侧内容区：公司列表 | 主内容（resizable 分割）===== */}
        {/* min-h-0：允许 SidebarInset 收缩到剩余高度，min-w-0 防止 Group 撑出横向溢出 */}
        <SidebarInset className="min-h-0 min-w-0">
          <ResizablePanelGroup
            id="dashboard"
            orientation="horizontal"
            defaultLayout={DEFAULT_LAYOUT}
            onLayoutChanged={onLayoutChanged}
          >
            {/* 公司列表 */}
            <ResizablePanel
              id="companies"
              defaultSize="14"
              minSize="12"
              maxSize="24"
            >
              <CompanySidebar
                items={tagFiltered}
                mode={selectedTags.length > 0 ? 'tag' : 'all'}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />

            {/* 主内容：面板内独立滚动 */}
            <ResizablePanel id="main" defaultSize="86" minSize="40">
              <div className="h-full min-h-0 overflow-y-auto p-4">
                {error && (
                <div className="status-bar" style={{ marginBottom: 12 }}>
                  <span className="dot err" />
                  <span style={{ color: 'var(--accent-danger)' }}>{error}</span>
                </div>
              )}

              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="text-sm">
                  {selectedTags.length > 0 ? (
                    <span>
                      标签：
                      {selectedTags.map((t) => (
                        <span key={t} className="badge badge-primary mr-1">
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">全部公司</span>
                  )}
                  {selectedCompanies.length > 0 && (
                    <span className="ml-2">
                      已选 {selectedCompanies.length} 家：
                      {selectedItems.map((it) => (
                        <span
                          key={it.thscode}
                          className="badge badge-primary ml-1"
                        >
                          {it.name}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                  <span>
                    <span className="dot ok" />
                    {new Date(lastUpdated).toLocaleTimeString('zh-CN')}
                  </span>
                  <span>每 60s 刷新</span>
                </div>
              </div>

              {mode === 'list' && (
                <>
                  <div className="summary-grid">
                    <div className="summary-card">
                      <div className="label">篮子公司</div>
                      <div className="value">{stats.total}</div>
                    </div>
                    <div className="summary-card">
                      <div className="label">平均涨跌</div>
                      <div
                        className="value"
                        style={{
                          color:
                            stats.avgChg != null
                              ? stats.avgChg > 0
                                ? 'var(--fin-up)'
                                : stats.avgChg < 0
                                  ? 'var(--fin-down)'
                                  : undefined
                              : undefined,
                        }}
                      >
                        {stats.avgChg != null
                          ? `${stats.avgChg > 0 ? '+' : ''}${stats.avgChg.toFixed(2)}%`
                          : '—'}
                      </div>
                    </div>
                    <div className="summary-card">
                      <div className="label">深度低估 🟢</div>
                      <div className="value down">{stats.deep}</div>
                    </div>
                    <div className="summary-card">
                      <div className="label">低估区间</div>
                      <div className="value down">{stats.low}</div>
                    </div>
                    <div className="summary-card">
                      <div className="label">有估值锚点</div>
                      <div className="value">{stats.anchor}</div>
                    </div>
                    <div className="summary-card">
                      <div className="label">基本面需更新 ⚠️</div>
                      <div className="value warn">{stats.update}</div>
                    </div>
                    <div className="summary-card">
                      <div className="label">有基本面更新</div>
                      <div className="value">{stats.hasUpdate}</div>
                    </div>
                  </div>
                  <WatchlistTable
                    items={tagFiltered}
                    selectedCodes={selectedCompanies}
                    onSelect={handleTableSelect}
                  />
                </>
              )}

              {mode === 'single' && activeCode && (
                <CompanyDashboard thscode={activeCode} onClose={clearCompanies} />
              )}

              {mode === 'compare' && <CompareTable items={selectedItems} />}

              <footer
                style={{
                  marginTop: 40,
                  paddingTop: 16,
                  borderTop: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                }}
              >
                数据仅供研究参考，不构成投资建议。综合分按
                .trae/scripts/valuation/composite.ts 权重加权计算。
              </footer>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
