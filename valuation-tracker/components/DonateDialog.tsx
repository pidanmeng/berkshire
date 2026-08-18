"use client";

import { Coffee } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * 「请我喝杯咖啡」打赏弹窗
 * 二维码图片约定路径：public/donate/wechat-pay.png（收款码）、wechat-friend.png（加好友）
 */
export default function DonateDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="flex items-center gap-1.5 border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]"
          aria-label="请我喝杯咖啡"
        >
          <Coffee className="size-3.5" />
          请我喝杯咖啡
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>请我喝杯咖啡</DialogTitle>
          <DialogDescription className="text-balance leading-relaxed">
            每次调研一只股票需要花费约
            <b className="mx-1 text-[var(--accent-primary)]">3 元 Token</b>
            ；网站目前服务器、域名均为
            <b className="mx-1 text-[var(--accent-primary)]">自费运营</b>。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div className="grid grid-cols-2 gap-4">
            <figure className="flex flex-col items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/donate/wechat-pay.png"
                alt="微信收款码"
                className="h-40 w-40 border border-[var(--border-subtle)] object-contain"
              />
              <figcaption className="text-xs text-[var(--text-muted)]">
                微信收款码
              </figcaption>
            </figure>
            <figure className="flex flex-col items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/donate/wechat-friend.png"
                alt="微信添加好友二维码"
                className="h-40 w-40 border border-[var(--border-subtle)] object-contain"
              />
              <figcaption className="text-xs text-[var(--text-muted)]">
                微信添加好友
              </figcaption>
            </figure>
          </div>
          <p className="text-center text-[13px] leading-relaxed text-[var(--text-secondary)]">
            打赏
            <b className="mx-1 text-[var(--accent-warning)]">3 元以上</b>
            ，备注
            <b className="mx-1">股票代码或股票名称</b>
            ，我看到后会启动调研流程。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
