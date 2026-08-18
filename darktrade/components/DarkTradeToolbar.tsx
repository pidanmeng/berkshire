import React from 'react';
import { Calendar, Search, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DarkTradeToolbarProps {
  dateInput: string;
  onDateChange: (val: string) => void;
  filter: string;
  onFilterChange: (val: string) => void;
  loading: boolean;
  progressMsg: string;
  onFetch: () => void;
}

export function DarkTradeToolbar({
  dateInput,
  onDateChange,
  filter,
  onFilterChange,
  loading,
  progressMsg,
  onFetch,
}: DarkTradeToolbarProps) {
  return (
    <section className="bg-card p-4 rounded-xl shadow-sm border space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-500" />
          <input
            type="date"
            value={dateInput}
            onChange={(e) => onDateChange(e.target.value)}
            disabled={loading}
            className="px-3 py-1.5 bg-muted border rounded-md text-sm font-mono focus:ring-2 focus:ring-ring outline-none disabled:opacity-50 h-9"
          />
        </div>
        <div className="relative flex-1 min-w-50 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="股票代码 / 名称 / 板块标签…"
            className="pl-9 h-9"
          />
        </div>
        <Button onClick={onFetch} disabled={loading} className="h-9 px-6">
          {loading ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />刷新中…</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-2" />刷新</>
          )}
        </Button>
      </div>
      {loading && progressMsg && (
        <div className="text-xs text-indigo-500 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />{progressMsg}
        </div>
      )}
    </section>
  );
}
