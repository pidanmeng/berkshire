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
              <b className="mx-1 text-[var(--accent-warning)]">3 元以上</b>
              ，备注
              <b className="mx-1">股票代码或股票名称</b>
              ，我看到后会启动调研流程。
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
