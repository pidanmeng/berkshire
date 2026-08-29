'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CompanyItem, CompanyStaticItem, CompanyStaticDetail, StaticCompaniesData } from '@/lib/api';
import { fetchQuotesThrottled } from '@/lib/market-data';
import { classifyCapZone } from '@/server/lib/safety';
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
import { useFavorites } from '@/hooks/use-favorites';
import { useIsMobile } from '@/hooks/use-mobile';

/** 右侧分割（公司列表 | 主内容）宽度布局持久化 key */
const SPLIT_LAYOUT_KEY = 'valuation-split-layout';

/** 默认右侧分割（flexGrow）：公司列表 / 主内容 */
const DEFAULT_LAYOUT: Layout = { companies: 14, main: 86 };

/** 移动端（<768px）上下堆叠：公司列表在上 / 主内容在下 */
const MOBILE_LAYOUT: Layout = { companies: 38, main: 62 };

/** 静态条目 → 完整 CompanyItem（quote/zone 等实时字段先置空，等待客户端行情合并） */
function toCompanyItem(it: CompanyStaticItem): CompanyItem {
  return {
    ...it,
    quote: {
      price: null,
      changePct: null,
      marketCap: null,
      peTtm: null,
      pbMrq: null,
      psTtm: null,
      pcfTtm: null,
    },
    zone: classifyCapZone(null, it.targetMarketCapYi),
    marketCapYi: null,
    needsUpdate: null,
    latestReportDate: null,
    fundamentalItems: undefined,
  };
}

export default function Dashboard({
  initial,
}: {
  initial: {
    list: CompanyStaticItem[];
    docsIndex?: StaticCompaniesData["docsIndex"];
    fetchedAt: number;
  };
}) {
  const [items, setItems] = useState<CompanyItem[]>(() => initial.list.map(toCompanyItem));
  const [lastUpdated, setLastUpdated] = useState<number>(initial.fetchedAt);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 静态 thscode 列表（构建期固定；轮询合并实时行情用）
  const codesRef = useRef<string[]>(initial.list.map((it) => it.thscode));

  // 移动端：<768px 时左侧 Sidebar 渲染为抽屉，右侧公司列表/主内容改为上下堆叠
  const isMobile = useIsMobile();

  // 首次访问自动弹出「请我喝杯咖啡」，勾选「不再提醒」后不再弹出
  const [donateOpen, setDonateOpen] = useState(false);

  useEffect(() => {
    let dontRemind = false;
    try {
      dontRemind = window.localStorage.getItem('donate-dont-remind') === '1';
    } catch {
      // 存储不可用时忽略
    }
    if (dontRemind) return;
    const donateTimer = window.setTimeout(() => setDonateOpen(true), 700);
    return () => window.clearTimeout(donateTimer);
  }, []);

  const handleDonateChange = useCallback((open: boolean) => {
    setDonateOpen(open);
  }, []);

  // 选择状态（标签 / 公司 / 单选多选模式）由 zustand store 统一管理
  const selectedTags = useDashboardStore((s) => s.selectedTags);
  const selectedCompanies = useDashboardStore((s) => s.selectedCompanies);
  const companyMultiSelect = useDashboardStore((s) => s.companyMultiSelect);
  const watchlistOnly = useDashboardStore((s) => s.watchlistOnly);
  const toggleCompany = useDashboardStore((s) => s.toggleCompany);
  const selectCompany = useDashboardStore((s) => s.selectCompany);
  const clearCompanies = useDashboardStore((s) => s.clearCompanies);

  // 自选股收藏提升到 Dashboard 统一持有（TagSidebar 计数 + 列表过滤 + CompanySidebar 星标共享同一状态）
  const { favorites, favoriteSet, toggleFavorite } = useFavorites();

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

  // 60s 轮询刷新行情（浏览器直连东财/同花顺，节流在 market-data 内 ≥60s；页面隐藏时暂停）
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const quotes = await fetchQuotesThrottled(codesRef.current);
        if (cancelled) return;
        setItems((prev) =>
          prev.map((it) => {
            const q = quotes.get(it.thscode);
            const marketCap = q?.marketCap ?? null;
            const marketCapYi = marketCap != null ? marketCap / 1e8 : null;
            return {
              ...it,
              quote: {
                price: q?.price ?? null,
                changePct: q?.changePct ?? null,
                marketCap,
                peTtm: q?.peTtm ?? null,
                pbMrq: q?.pbMrq ?? null,
                psTtm: q?.psTtm ?? null,
                pcfTtm: q?.pcfTtm ?? null,
              },
              zone: classifyCapZone(marketCapYi, it.targetMarketCapYi),
              marketCapYi,
            };
          }),
        );
        setLastUpdated(Date.now());
        setError(null);
      } catch {
        setError('实时行情刷新失败（东财直连不可用）');
      }
    };
    poll();
    timerRef.current = setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const tagStats = useMemo(() => buildTagStats(items), [items]);

  // 自选股过滤（开关开启时只显示收藏公司），再叠加 tag 过滤
  const watchlistFiltered = useMemo(
    () =>
      watchlistOnly
        ? items.filter((it) => favoriteSet.has(it.thscode))
        : items,
    [items, watchlistOnly, favoriteSet],
  );

  // 按 tag 过滤后的公司（无 tag 选中 = 全部）
  const tagFiltered = useMemo(
    () =>
      selectedTags.length === 0
        ? watchlistFiltered
        : watchlistFiltered.filter((it) => selectedTags.every((t) => it.tags.includes(t))),
    [watchlistFiltered, selectedTags],
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

  // 内嵌看板静态详情：直接复用构建期注入的 list + docsIndex（SSG），不请求 companies.json
  const activeDetail = useMemo<CompanyStaticDetail | undefined>(() => {
    if (!activeCode) return undefined;
    const note = initial.list.find((it) => it.thscode === activeCode);
    if (!note) return undefined;
    const idx = initial.docsIndex?.[activeCode];
    return {
      note,
      docs: {
        deepReads: idx?.deepReads ?? [],
        annualReports: idx?.annualReports ?? [],
      },
      updates: idx?.updates ?? [],
    };
  }, [activeCode, initial]);

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
          {/* 桌面保留 ICON 列；移动端抽屉内隐藏，由右侧页面级左列统一承担（全站一致） */}
          <AppIconRail className="hidden h-full md:flex" />
          <SidebarContent className="group-data-[collapsible=icon]:hidden min-w-0 flex-1">
            <TagSidebar tags={tagStats} favorites={favorites} favoriteSet={favoriteSet} />
          </SidebarContent>
        </div>
        <SidebarRail />
      </Sidebar>

      {/* 右侧：header 固定 + 内容区占满视口剩余高度，整页不滚动 */}
      <div className="flex h-dvh min-w-0 w-full flex-col overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-2">
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
          <div className="flex items-center gap-2">
            <DonateDialog open={donateOpen} onOpenChange={handleDonateChange} />
          </div>
        </header>
        {/* ===== 右侧内容区：移动端左侧固定 40px 页面导航列 + 面板（桌面由 Sidebar 提供）===== */}
        <div className="flex min-h-0 min-w-0 flex-1">
          <AppIconRail className="h-full md:hidden" />
          {/* min-h-0：允许 SidebarInset 收缩到剩余高度，min-w-0 防止 Group 撑出横向溢出 */}
          <SidebarInset className="min-h-0 min-w-0">
            <ResizablePanelGroup
              id="dashboard"
              key={isMobile ? 'dashboard-v' : 'dashboard-h'}
              orientation={isMobile ? 'vertical' : 'horizontal'}
              defaultLayout={isMobile ? MOBILE_LAYOUT : DEFAULT_LAYOUT}
              onLayoutChanged={onLayoutChanged}
            >
              {/* 公司列表（移动端在上方，桌面在左侧） */}
              <ResizablePanel
                id="companies"
                defaultSize={isMobile ? '38' : '14'}
                minSize={isMobile ? '25' : '12'}
                maxSize={isMobile ? '55' : '24'}
              >
                <CompanySidebar
                  items={tagFiltered}
                  mode={selectedTags.length > 0 ? 'tag' : 'all'}
                  favoriteSet={favoriteSet}
                  toggleFavorite={toggleFavorite}
                />
              </ResizablePanel>
              {/* 窄屏隐藏拖拽条：移动端为固定上下堆叠 */}
              {!isMobile && <ResizableHandle withHandle />}

              {/* 主内容：面板内独立滚动 */}
              <ResizablePanel id="main" defaultSize={isMobile ? '62' : '86'} minSize={isMobile ? '45' : '40'}>
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
                    {lastUpdated > 0
                      ? new Date(lastUpdated).toLocaleTimeString('zh-CN')
                      : '—'}
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
                <CompanyDashboard
                  key={activeCode}
                  thscode={activeCode}
                  onClose={clearCompanies}
                  initial={activeDetail}
                />
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
                数据仅供研究参考，不构成投资建议。
              </footer>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
