'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, Activity, Calendar } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDarkTradeStore } from '@/lib/store/useDarkTradeStore';
import { fetchStockHistory, type StockHistoryItem } from '../api';
import { fmtMoney, fmtMoneyShort, fmtPct, fmtPrice, valColor } from '../formatter';
import { HistoryChart } from './components/HistoryChart';

const HISTORY_START_DATE = '20260511';

export default function DarkTradeDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const stockPageMap = useDarkTradeStore((s) => s.stockPageMap);
  const lastQueryDate = useDarkTradeStore((s) => s.lastQueryDate);
  const updateStockPage = useDarkTradeStore((s) => s.updateStockPage);

  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [history, setHistory] = useState<StockHistoryItem[]>([]);
  const [stockName, setStockName] = useState('');

  const pageHint = stockPageMap[code] ?? 1;
  const endDate = lastQueryDate || '';

  const handleFetch = useCallback(async () => {
    if (!endDate) {
      toast.error('请先在列表页查询一次数据，以获取回退起始日期');
      return;
    }
    setLoading(true);
    setHistory([]);
    setProgressMsg('');
    try {
      const result = await fetchStockHistory(
        code,
        pageHint,
        endDate,
        HISTORY_START_DATE,
        setProgressMsg,
        (newPage) => updateStockPage(code, newPage),
      );
      setHistory(result);
      if (result.length > 0) {
        setStockName(result[0].item['16']);
      }
      toast.success(`加载完成：获取 ${result.length} 个交易日数据`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  }, [code, pageHint, endDate, updateStockPage]);

  // 页面加载时自动拉取
  useEffect(() => {
    if (endDate) {
      handleFetch();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 统计
  const latestItem = history.length > 0 ? history[history.length - 1] : null;
  const totalDarkFund = history.reduce((s, h) => s + h.item['6'], 0);
  const totalMainNet = history.reduce((s, h) => s + h.item['8'], 0);

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="max-w-350 mx-auto space-y-4">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-center gap-4 bg-card p-4 rounded-xl shadow-sm border">
          <div>
            <h1 className="text-2xl font-bold text-indigo-600 flex items-center">
              <Activity className="w-6 h-6 mr-2" />
              {stockName || code}
              <Badge variant="secondary" className="ml-2 text-xs font-mono">{code}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              暗盘资金历史走势（{HISTORY_START_DATE.slice(0, 4)}-{HISTORY_START_DATE.slice(4, 6)}-{HISTORY_START_DATE.slice(6, 8)} 至今）
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!endDate && (
              <Badge variant="destructive" className="text-xs">未设置起始日期，请先查询列表页</Badge>
            )}
            <Link href="/darktrade">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-1" />
                返回列表
              </Button>
            </Link>
          </div>
        </header>

        {/* 统计摘要 */}
        {history.length > 0 && (
          <section className="bg-card p-3 px-4 rounded-xl shadow-sm border">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="w-4 h-4 text-indigo-500" />
                共 <span className="font-bold text-foreground">{history.length}</span> 个交易日
              </span>
              <span className={cn('flex items-center gap-1.5', valColor(totalDarkFund))}>
                <TrendingUp className="w-4 h-4" />
                暗盘资金累计
                <span className="font-semibold">{fmtMoneyShort(totalDarkFund)}</span>
              </span>
              <span className={cn('flex items-center gap-1.5', valColor(totalMainNet))}>
                <TrendingDown className="w-4 h-4" />
                主力净流入累计
                <span className="font-semibold">{fmtMoneyShort(totalMainNet)}</span>
              </span>
              {latestItem && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  最新：{fmtPrice(latestItem.item['13'])} 元
                  <span className={cn('font-semibold', valColor(latestItem.item['14']))}>
                    {latestItem.item['14'] > 0 ? '+' : ''}{fmtPct(latestItem.item['14'])}%
                  </span>
                </span>
              )}
            </div>
          </section>
        )}

        {/* 加载进度 */}
        {loading && (
          <section className="bg-card p-3 px-4 rounded-xl shadow-sm border">
            <div className="flex items-center gap-2 text-sm text-indigo-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              {progressMsg}
            </div>
          </section>
        )}

        {/* 图表 */}
        {history.length > 0 && !loading && (
          <HistoryChart data={history} />
        )}

        {/* 空状态 */}
        {history.length === 0 && !loading && (
          <section className="bg-card rounded-xl shadow-sm border">
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/60 space-y-3">
              <Activity className="w-14 h-14 opacity-30" />
              <p className="text-sm">
                {endDate ? '点击重新加载以获取历史数据' : '请先在列表页查询一次数据'}
              </p>
              {endDate && (
                <Button onClick={handleFetch} size="sm">
                  加载历史数据
                </Button>
              )}
            </div>
          </section>
        )}

        {/* 历史数据明细表 */}
        {history.length > 0 && !loading && (
          <section className="bg-card rounded-xl shadow-sm border overflow-hidden">
            <div className="p-3 px-4 border-b bg-muted/30">
              <h3 className="text-sm font-semibold">历史数据明细</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">日期</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">暗盘资金</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">明盘资金</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">主力净流入</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">活跃度</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">股价</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">涨幅</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map(({ date, item }) => (
                    <tr key={date} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{date}</td>
                      <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', valColor(item['6']))}>
                        {fmtMoney(item['6'])}
                      </td>
                      <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', valColor(item['7']))}>
                        {fmtMoney(item['7'])}
                      </td>
                      <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', valColor(item['8']))}>
                        {fmtMoney(item['8'])}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {fmtPct(item['11'])}%
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {fmtPrice(item['13'])}
                      </td>
                      <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums font-medium', valColor(item['14']))}>
                        {item['14'] > 0 ? '+' : ''}{fmtPct(item['14'])}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
