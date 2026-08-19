"use client";

import { Coffee } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DonateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * 「请我喝杯咖啡」打赏弹窗（受控组件）
 * 二维码图片路径约定：public/donate/wechat-pay.png（收款码）、wechat-friend.png（加好友）
 * 无动画：打开/关闭即时显示（已按需求移除 Web Animations 缩放动画）。
 */
export default function DonateDialog({ open, onOpenChange }: DonateDialogProps) {
  const handleDontRemind = () => {
    localStorage.setItem("donate-dont-remind", "1");
    onOpenChange(false);
  };

  return (
    <>
      <button
        className="donate-btn"
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="请我喝杯咖啡"
      >
        <Coffee className="donate-icon size-4" />
        <span className="hidden sm:inline">请我喝杯咖啡</span>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-md data-[state=open]:animate-none data-[state=closed]:animate-none"
        >
          <DialogHeader>
            <DialogTitle>请我喝杯咖啡</DialogTitle>
            <DialogDescription className="text-balance leading-relaxed">
              网站由我利用
              <b className="mx-1 text-[var(--accent-primary)]">业余时间</b>
              独立维护，服务器、域名均为
              <b className="mx-1 text-[var(--accent-primary)]">自费</b>
              ，每次调研还有约
              <b className="mx-1 text-[var(--accent-primary)]">3 元 Token</b>
              成本。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4">
            <div className="grid grid-cols-2 gap-4">
              <figure className="flex flex-col items-center gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/donate/wechat-pay.png"
                  alt="微信收款码"
                  className="w-50 border border-[var(--border-subtle)] object-contain"
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
                  className="w-50 border border-[var(--border-subtle)] object-contain"
                />
                <figcaption className="text-xs text-[var(--text-muted)]">
                  微信添加好友
                </figcaption>
              </figure>
            </div>
            <p className="text-center text-[13px] leading-relaxed text-[var(--text-secondary)]">
              打赏
              <b className="mx-1 text-[var(--accent-warning)]">纯属自愿</b>
              、金额随意，不打赏也完全没关系；
              想调研的股票去留言板
              <b className="mx-1">许愿公司调研</b>
              告诉我即可，我会
              <b className="mx-1 text-[var(--accent-warning)]">免费</b>
              帮你调研。
            </p>
            <button
              type="button"
              onClick={handleDontRemind}
              className="cursor-pointer border-none bg-transparent text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              不再提醒
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
