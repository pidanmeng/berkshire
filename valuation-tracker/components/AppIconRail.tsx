"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid } from "lucide-react";
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
                    "flex size-8 items-center justify-center rounded-md transition-colors hover:bg-muted/40",
                    active
                      ? "bg-[rgba(212,175,55,0.12)] text-[var(--accent-primary)]"
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
