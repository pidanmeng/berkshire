"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, Home, LayoutGrid, MessageSquare } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 最左侧页面导航 ICON 列：仅展示图标，hover 显示 tooltip，点击跳转对应页面 */
const NAV_ICONS = [
  { href: "/", label: "首页", Icon: Home },
  { href: "/screener", label: "全市场初筛", Icon: LayoutGrid },
  { href: "/darktrade", label: "暗盘追踪", Icon: Activity },
  { href: "/docs", label: "文档", Icon: BookOpen },
  { href: "/messages", label: "留言板", Icon: MessageSquare },
];

export default function AppIconRail({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <TooltipProvider delayDuration={100}>
      <nav
        className={cn(
          "flex w-10 shrink-0 flex-col items-center gap-2 border-r border-border bg-background py-2",
          className,
        )}
        aria-label="页面导航"
      >
        {NAV_ICONS.map(({ href, label, Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Tooltip key={href}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  className={cn(
                    "flex size-8 items-center justify-center transition-colors hover:bg-muted/40",
                    active
                      ? "bg-[rgba(242,193,78,0.12)] text-[var(--accent-primary)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-label={label}
                >
                  <Icon className="size-4.5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}