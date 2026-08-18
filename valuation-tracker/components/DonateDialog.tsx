"use client";

import { useCallback, useEffect, useRef } from "react";
import { Coffee } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OPEN_ANIM_MS = 240;
const CLOSE_ANIM_MS = 280;

type DonateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * 「请我喝杯咖啡」打赏弹窗（受控组件）
 * 二维码图片路径约定：public/donate/wechat-pay.png（收款码）、wechat-friend.png（加好友）
 * 动效：打开时从按钮位置放大，关闭时缩放回按钮位置（Web Animations API，无新依赖）
 */
export default function DonateDialog({ open, onOpenChange }: DonateDialogProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  const closeWithAnimation = useCallback(() => {
    if (closingRef.current || !open) return;
    closingRef.current = true;

    const content = contentRef.current;
    const button = buttonRef.current;
    if (!content || !button) {
      closingRef.current = false;
      onOpenChange(false);
      return;
    }

    const contentRect = content.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const dx =
      buttonRect.left + buttonRect.width / 2 - (contentRect.left + contentRect.width / 2);
    const dy =
      buttonRect.top + buttonRect.height / 2 - (contentRect.top + contentRect.height / 2);
    const scale = buttonRect.width / contentRect.width;

    const anim = content.animate(
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})`,
          opacity: 0,
        },
      ],
      { duration: CLOSE_ANIM_MS, easing: "cubic-bezier(0.4, 0, 1, 1)" },
    );
    anim.onfinish = () => {
      closingRef.current = false;
      onOpenChange(false);
    };
    anim.oncancel = () => {
      closingRef.current = false;
    };
  }, [open, onOpenChange]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true);
      } else {
        closeWithAnimation();
      }
    },
    [closeWithAnimation, onOpenChange],
  );

  const handleDontRemind = () => {
    localStorage.setItem("donate-dont-remind", "1");
    closeWithAnimation();
  };

  useEffect(() => {
    if (!open) return;
    const content = contentRef.current;
    const button = buttonRef.current;
    if (!content || !button) return;

    const contentRect = content.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const dx =
      buttonRect.left + buttonRect.width / 2 - (contentRect.left + contentRect.width / 2);
    const dy =
      buttonRect.top + buttonRect.height / 2 - (contentRect.top + contentRect.height / 2);

    const anim = content.animate(
      [
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.15)`,
          opacity: 0.3,
        },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
      ],
      { duration: OPEN_ANIM_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" },
    );
    return () => anim.cancel();
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        className="donate-btn"
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="请我喝杯咖啡"
      >
        <Coffee className="donate-icon size-4" />
        请我喝杯咖啡
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          ref={contentRef}
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