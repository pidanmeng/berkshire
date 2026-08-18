import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { PAGE_SIZE_OPTIONS } from '../types';

interface PaginationProps {
  totalItems: number;
  filteredTotal: number;
  hasFilter: boolean;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageRange: (number | '...')[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function Pagination({
  totalItems,
  filteredTotal,
  hasFilter,
  currentPage,
  totalPages,
  pageSize,
  pageRange,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-3 px-4 border-t bg-muted/30">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          共 <span className="font-semibold text-foreground">{filteredTotal}</span> 条
          {hasFilter && totalItems !== filteredTotal && (
            <span className="text-muted-foreground/60"> / 原始 {totalItems} 条</span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          每页
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v))}
          >
            <SelectTrigger className="w-18 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((s) => (
                <SelectItem key={s} value={String(s)}>{s} 条</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline" size="icon" className="w-7 h-7"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(1)}
        >
          <ChevronsLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="outline" size="icon" className="w-7 h-7"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        {pageRange.map((p, idx) =>
          p === '...' ? (
            <span key={`dots-${idx}`} className="px-1 text-muted-foreground/50 text-sm">…</span>
          ) : (
            <Button
              key={p}
              variant={p === currentPage ? 'default' : 'outline'}
              size="icon"
              className={cn('w-7 h-7 text-xs', p === currentPage && 'bg-indigo-600 hover:bg-indigo-700')}
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          )
        )}

        <Button
          variant="outline" size="icon" className="w-7 h-7"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button
          variant="outline" size="icon" className="w-7 h-7"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(totalPages)}
        >
          <ChevronsRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
