import React from 'react';
import { Layers, Database, TrendingUp, TrendingDown } from 'lucide-react';
import type { DarkTradeStats as StatsData } from '../types';
import { fmtMoneyShort } from '../formatter';

interface DarkTradeStatsProps {
  actualDate: string;
  totalPages: number;
  stats: StatsData;
}

export function DarkTradeStats({ actualDate, totalPages, stats }: DarkTradeStatsProps) {
  return (
    <section className="bg-card p-3 px-4 rounded-xl shadow-sm border">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Layers className="w-4 h-4 text-indigo-500" />
          实际日期：<span className="font-bold text-indigo-600">{actualDate}</span>
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Database className="w-4 h-4 text-indigo-500" />
          共 <span className="font-bold text-foreground">{stats.total}</span> 只
          <span className="text-border mx-1">|</span>{totalPages} 页
        </span>
        <span className="flex items-center gap-1.5 text-red-500">
          <TrendingUp className="w-4 h-4" />
          流入 {stats.inflowCount} 只
          <span className="font-semibold">({fmtMoneyShort(stats.inflowAmount)})</span>
        </span>
        <span className="flex items-center gap-1.5 text-emerald-500">
          <TrendingDown className="w-4 h-4" />
          流出 {stats.outflowCount} 只
          <span className="font-semibold">({fmtMoneyShort(stats.outflowAmount)})</span>
        </span>
      </div>
    </section>
  );
}
