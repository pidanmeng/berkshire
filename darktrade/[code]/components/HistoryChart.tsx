'use client';

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { StockHistoryItem } from '../../api';
import { fmtMoney, fmtPct } from '../../formatter';

interface HistoryChartProps {
  data: StockHistoryItem[];
}

interface ChartRow {
  date: string;
  darkFund: number;
  mainNet: number;
  brightFund: number;
  activity: number;
  change: number;
}

export function HistoryChart({ data }: HistoryChartProps) {
  const chartData: ChartRow[] = data.map(({ date, item }) => ({
    date: `${date.slice(4, 6)}/${date.slice(6, 8)}`,
    darkFund: item['6'],
    mainNet: item['8'],
    brightFund: item['7'],
    activity: item['11'],
    change: item['14'],
  }));

  return (
    <div className="space-y-6">
      {/* 资金走势 */}
      <section className="bg-card rounded-xl shadow-sm border p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">暗盘资金 / 主力净流入走势</h3>
        <ResponsiveContainer width="100%" height={360}>
          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="gradDark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradMain" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              className="text-muted-foreground"
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => fmtMoney(v)}
              tick={{ fontSize: 11 }}
              className="text-muted-foreground"
              width={80}
            />
            <Tooltip
              formatter={(value) => fmtMoney(Number(value))}
              labelStyle={{ fontSize: 12, fontWeight: 600 }}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="darkFund"
              name="暗盘资金"
              stroke="#6366f1"
              fill="url(#gradDark)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              type="monotone"
              dataKey="mainNet"
              name="主力净流入"
              stroke="#f59e0b"
              fill="url(#gradMain)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* 涨幅走势 */}
      <section className="bg-card rounded-xl shadow-sm border p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">涨幅走势 (%)</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="gradChange" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              className="text-muted-foreground"
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => `${fmtPct(v)}%`}
              tick={{ fontSize: 11 }}
              className="text-muted-foreground"
              width={60}
            />
            <Tooltip
              formatter={(value) => `${fmtPct(Number(value))}%`}
              labelStyle={{ fontSize: 12, fontWeight: 600 }}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="change"
              name="涨幅"
              stroke="#ef4444"
              fill="url(#gradChange)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
