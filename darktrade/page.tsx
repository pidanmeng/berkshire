'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Database, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDarkTradeStore } from '@/lib/store/useDarkTradeStore';

import type { DarkTradeItem, SortKey, SortDir, DarkTradeStats as StatsData } from './types';
import { SORT_KEY_MAP } from './types';
import { fetchAllPages } from './api';
import { DarkTradeToolbar } from './components/DarkTradeToolbar';
import { DarkTradeStats } from './components/DarkTradeStats';
import { DarkTradeTable } from './components/DarkTradeTable';

// ========== 主页面 ==========

export default function DarkTradePage() {
  const store = useDarkTradeStore();
  const hasCache = store.cachedData.length > 0;

  const [dateInput, setDateInput] = useState(
    hasCache ? store.cachedDateInput : format(new Date(), 'yyyy-MM-dd')
  );
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [allData, setAllData] = useState<DarkTradeItem[]>(hasCache ? store.cachedData : []);
  const [actualDate, setActualDate] = useState(hasCache ? store.cachedDate : '');
  const [totalPages, setTotalPages] = useState(hasCache ? store.cachedTotalPages : 0);

  // 分页 & 排序
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  /** 记录用户是否手动排过序，用于刷新后决定是否重置默认排序 */
  const userSortedRef = useRef(false);

  // ========== 派生数据 ==========

  const filteredData = useMemo(() => {
    if (!filter.trim()) return allData;
    const kw = filter.trim().toLowerCase();
    return allData.filter(
      (d) =>
        d['4'].includes(kw) ||
        d['16'].toLowerCase().includes(kw) ||
        d['17'].toLowerCase().includes(kw) ||
        d['18'].toLowerCase().includes(kw)
    );
  }, [allData, filter]);

  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    const field = SORT_KEY_MAP[sortKey];
    return [...filteredData].sort((a, b) => {
      const va = a[field];
      const vb = b[field];
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [filteredData, sortKey, sortDir]);

  const totalPagesClient = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const safePage = Math.min(currentPage, totalPagesClient);

  const pageData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, safePage, pageSize]);

  const stats: StatsData = useMemo(() => {
    const inflow = allData.filter((d) => d['6'] > 0);
    const outflow = allData.filter((d) => d['6'] < 0);
    return {
      total: allData.length,
      inflowCount: inflow.length,
      outflowCount: outflow.length,
      inflowAmount: inflow.reduce((s, d) => s + d['6'], 0),
      outflowAmount: outflow.reduce((s, d) => s + d['6'], 0),
    };
  }, [allData]);

  const pageRange = useMemo(() => {
    const pages: (number | '...')[] = [];
    const total = totalPagesClient;
    const cur = safePage;
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (cur > 3) pages.push('...');
      const start = Math.max(2, cur - 1);
      const end = Math.min(total - 1, cur + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (cur < total - 2) pages.push('...');
      pages.push(total);
    }
    return pages;
  }, [totalPagesClient, safePage]);

  // ========== 事件处理 ==========

  const handleSort = useCallback((key: SortKey) => {
    userSortedRef.current = true;
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return key;
      }
      setSortDir('desc');
      return key;
    });
    setCurrentPage(1);
  }, []);

  const handleFilterChange = useCallback((val: string) => {
    setFilter(val);
    setCurrentPage(1);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  }, []);

  const handleFetch = useCallback(async () => {
    if (!dateInput) { toast.error('请先选择日期'); return; }
    setLoading(true);
    setAllData([]); setActualDate(''); setTotalPages(0);
    setProgressMsg(''); setCurrentPage(1);
    try {
      const dateParam = dateInput.replace(/-/g, '');
      const { data, actualDate: ad, pages, stockPageMap } = await fetchAllPages(dateParam, 7, setProgressMsg);
      setAllData(data); setActualDate(ad); setTotalPages(pages);

      // 写入全局缓存
      store.setStockPageMap(stockPageMap);
      store.setLastQueryDate(ad);
      store.setCache(data, ad, pages, dateInput);

      // 用户未手动排序时，默认按主力净流入降序
      if (!userSortedRef.current) {
        setSortKey('mainNet');
        setSortDir('desc');
      }

      toast.success(`加载完成：${data.length} 条数据，共 ${pages} 页`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false); setProgressMsg('');
    }
  }, [dateInput, store]);

  // ========== 初始化：有缓存则直接使用，无缓存则自动拉取当天数据 ==========
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (!hasCache) {
      // 无缓存，延迟一帧后自动执行一次查询（避免 effect 内同步 setState 级联告警）
      const t = setTimeout(() => handleFetch(), 0);
      return () => clearTimeout(t);
    } else {
      // 有缓存，延迟一帧后默认排序
      const t = setTimeout(() => {
        setSortKey('mainNet');
        setSortDir('desc');
      }, 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========== 渲染 ==========

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="max-w-350 mx-auto space-y-4">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-center gap-4 bg-card p-4 rounded-xl shadow-sm border">
          <div>
            <h1 className="text-2xl font-bold text-indigo-600 flex items-center">
              <Database className="w-6 h-6 mr-2" />
              暗盘资金监控
              <Badge variant="secondary" className="ml-2 text-xs">原型</Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">东方财富暗盘资金数据查询与分析</p>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              返回监控
            </Button>
          </Link>
        </header>

        {/* Toolbar */}
        <DarkTradeToolbar
          dateInput={dateInput}
          onDateChange={setDateInput}
          filter={filter}
          onFilterChange={handleFilterChange}
          loading={loading}
          progressMsg={progressMsg}
          onFetch={handleFetch}
        />

        {/* Stats */}
        {actualDate && (
          <DarkTradeStats
            actualDate={actualDate}
            totalPages={totalPages}
            stats={stats}
          />
        )}

        {/* Table */}
        <DarkTradeTable
          allData={allData}
          pageData={pageData}
          loading={loading}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          totalAllData={allData.length}
          filteredTotal={sortedData.length}
          hasFilter={!!filter}
          currentPage={safePage}
          totalPages={totalPagesClient}
          pageSize={pageSize}
          pageRange={pageRange}
          onPageChange={setCurrentPage}
          onPageSizeChange={handlePageSizeChange}
        />
      </div>
    </main>
  );
}
