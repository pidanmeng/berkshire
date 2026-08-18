import React from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { SortKey, SortDir } from '../types';

interface SortableHeadProps {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey | null;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}

export function SortableHead({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  align = 'right',
}: SortableHeadProps) {
  const isActive = currentSort === sortKey;
  return (
    <TableHead
      className={cn(
        'cursor-pointer select-none group hover:bg-muted/80 transition-colors',
        align === 'right' ? 'text-right' : 'text-left'
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="inline-flex flex-col">
          {isActive ? (
            currentDir === 'asc' ? (
              <ChevronUp className="w-3.5 h-3.5 text-indigo-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-indigo-500" />
            )
          ) : (
            <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
          )}
        </span>
      </span>
    </TableHead>
  );
}
