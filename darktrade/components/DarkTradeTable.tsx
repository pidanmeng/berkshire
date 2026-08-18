import React from 'react';
import { Activity, Search } from 'lucide-react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DarkTradeItem, SortKey, SortDir } from '../types';
import { fmtMoney, fmtPct, fmtPrice, valColor } from '../formatter';
import { SortableHead } from './SortableHead';
import { Pagination } from './Pagination';

interface DarkTradeTableProps {
  allData: DarkTradeItem[];
  pageData: DarkTradeItem[];
  loading: boolean;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  // 分页
  totalAllData: number;
  filteredTotal: number;
  hasFilter: boolean;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageRange: (number | '...')[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function DarkTradeTable({
  allData,
  pageData,
  loading,
  sortKey,
  sortDir,
  onSort,
  totalAllData,
  filteredTotal,
  hasFilter,
  currentPage,
  totalPages,
  pageSize,
  pageRange,
  onPageChange,
  onPageSizeChange,
}: DarkTradeTableProps) {
  if (allData.length === 0 && !loading) {
    return (
      <section className="bg-card rounded-xl shadow-sm border overflow-hidden">
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/60 space-y-3">
          <Activity className="w-14 h-14 opacity-30" />
          <p className="text-sm">选择日期后点击「查询」获取暗盘数据</p>
        </div>
      </section>
    );
  }

  if (pageData.length === 0 && !loading && filteredTotal === 0) {
    return (
      <section className="bg-card rounded-xl shadow-sm border overflow-hidden">
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/60 space-y-3">
          <Search className="w-14 h-14 opacity-30" />
          <p className="text-sm">无匹配数据</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-card rounded-xl shadow-sm border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <SortableHead label="代码" sortKey="code" currentSort={sortKey} currentDir={sortDir} onSort={onSort} align="left" />
            <SortableHead label="名称" sortKey="name" currentSort={sortKey} currentDir={sortDir} onSort={onSort} align="left" />
            <SortableHead label="暗盘资金" sortKey="darkFund" currentSort={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortableHead label="明盘资金" sortKey="brightFund" currentSort={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortableHead label="主力净流入" sortKey="mainNet" currentSort={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortableHead label="暗盘活跃度" sortKey="activity" currentSort={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortableHead label="股价(元)" sortKey="price" currentSort={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortableHead label="涨幅" sortKey="change" currentSort={sortKey} currentDir={sortDir} onSort={onSort} />
            <TableHead className="text-left">板块</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageData.map((d, i) => {
            const tags = [d['17'], d['18']].filter(Boolean);
            return (
              <TableRow key={`${d['4']}-${i}`}>
                <TableCell className="font-mono text-xs text-muted-foreground">{d['4']}</TableCell>
                <TableCell className="font-medium">
                  <Link
                    href={`/darktrade/${d['4']}`}
                    className="text-indigo-600 hover:text-indigo-800 hover:underline transition-colors"
                  >
                    {d['16']}
                  </Link>
                </TableCell>
                <TableCell className={cn('text-right font-mono tabular-nums', valColor(d['6']))}>
                  {fmtMoney(d['6'])}
                </TableCell>
                <TableCell className={cn('text-right font-mono tabular-nums', valColor(d['7']))}>
                  {fmtMoney(d['7'])}
                </TableCell>
                <TableCell className={cn('text-right font-mono tabular-nums', valColor(d['8']))}>
                  {fmtMoney(d['8'])}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtPct(d['11'])}%
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtPrice(d['13'])}
                </TableCell>
                <TableCell className={cn('text-right font-mono tabular-nums font-medium', valColor(d['14']))}>
                  {d['14'] > 0 ? '+' : ''}{fmtPct(d['14'])}%
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {tags.map((t, ti) => (
                      <Badge key={ti} variant="secondary" className="text-[11px] px-1.5 py-0 font-normal">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Pagination
        totalItems={totalAllData}
        filteredTotal={filteredTotal}
        hasFilter={hasFilter}
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        pageRange={pageRange}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </section>
  );
}
