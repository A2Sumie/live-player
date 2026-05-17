'use client';

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ProtectedOutboundLinkProps = {
  linkId: string;
  children: ReactNode;
  className?: string;
  confirmMessage?: string;
  title?: string;
  newTab?: boolean;
  popoverPlacement?: 'left' | 'bottom';
  dismissAfterMs?: number;
  fadeAfterMs?: number;
};

export default function ProtectedOutboundLink({
  linkId,
  children,
  className,
  confirmMessage = '加入百合鸥谢谢喵\n最好的22/7中文群组谢谢喵',
  title,
  newTab = true,
  popoverPlacement = 'left',
  dismissAfterMs = 3000,
  fadeAfterMs = 1000,
}: ProtectedOutboundLinkProps) {
  const [opening, setOpening] = useState(false);
  const [popoverVisible, setPopoverVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLButtonElement | null>(null);
  const normalizedMessage = useMemo(
    () => String(confirmMessage || '').replace(/\\n/g, '\n'),
    [confirmMessage]
  );
  const messageLines = useMemo(
    () => normalizedMessage.split(/\r?\n/).filter((line, index, lines) => line.length > 0 || index < lines.length - 1),
    [normalizedMessage]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!popoverVisible || !containerRef.current) {
      return;
    }

    const updatePopoverStyle = () => {
      const anchor = containerRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const desiredWidth = Math.min(288, Math.max(220, viewportWidth - 32));
      let left = rect.left + rect.width / 2 - desiredWidth / 2;
      let top = rect.bottom + 12;

      if (popoverPlacement === 'left') {
        left = rect.left - desiredWidth - 14;
        top = rect.top + rect.height / 2 - 48;
        if (left < 16) {
          left = Math.min(viewportWidth - desiredWidth - 16, rect.right + 14);
        }
      }

      left = Math.max(16, Math.min(left, viewportWidth - desiredWidth - 16));
      top = Math.max(16, Math.min(top, viewportHeight - 120));
      setPopoverStyle({ top, left, width: desiredWidth });
    };

    updatePopoverStyle();
    window.addEventListener('resize', updatePopoverStyle);
    window.addEventListener('scroll', updatePopoverStyle, true);

    return () => {
      window.removeEventListener('resize', updatePopoverStyle);
      window.removeEventListener('scroll', updatePopoverStyle, true);
    };
  }, [popoverPlacement, popoverVisible]);

  useEffect(() => {
    if (!popoverVisible) {
      setFading(false);
      return;
    }

    const fadeTimer = window.setTimeout(() => {
      setFading(true);
    }, Math.max(0, fadeAfterMs));
    const closeTimer = window.setTimeout(() => {
      setPopoverVisible(false);
    }, Math.max(0, dismissAfterMs));

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(closeTimer);
    };
  }, [dismissAfterMs, fadeAfterMs, popoverVisible]);

  useEffect(() => {
    if (!popoverVisible) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target)
        && !popoverRef.current?.contains(target)
      ) {
        setPopoverVisible(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [popoverVisible]);

  const openLink = async (preopenedWindow?: Window | null) => {
    if (opening) {
      return;
    }

    setOpening(true);
    try {
      const response = await fetch(`/api/outbound-links/${encodeURIComponent(linkId)}`, {
        method: 'POST',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('获取跳转地址失败');
      }

      const payload = (await response.json()) as { url?: string };
      if (!payload.url) {
        throw new Error('跳转地址为空');
      }

      if (newTab) {
        if (preopenedWindow && !preopenedWindow.closed) {
          preopenedWindow.opener = null;
          preopenedWindow.location.replace(payload.url);
        } else {
          window.open(payload.url, '_blank', 'noopener,noreferrer');
        }
      } else {
        window.location.assign(payload.url);
      }
    } catch (error) {
      if (preopenedWindow && !preopenedWindow.closed) {
        preopenedWindow.close();
      }
      window.alert(error instanceof Error ? error.message : '打开入口失败');
    } finally {
      setOpening(false);
    }
  };

  const popover = mounted && popoverVisible && popoverStyle ? createPortal(
    <button
      ref={popoverRef}
      type="button"
      onClick={() => {
        setPopoverVisible(false);
        const preopenedWindow = null;
        void openLink(preopenedWindow);
      }}
      className={`fixed z-[9999] rounded-2xl border border-white/85 bg-white/95 px-4 py-3 text-left shadow-2xl shadow-slate-950/20 backdrop-blur-xl transition-[opacity,transform] duration-[1200ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
        fading ? 'translate-y-0.5 scale-[0.985] opacity-0' : 'translate-y-0 scale-100 opacity-100'
      }`}
      style={{
        top: popoverStyle.top,
        left: popoverStyle.left,
        width: popoverStyle.width,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-sm font-medium leading-6 text-slate-800">
          {messageLines.map((line, index) => (
            <span key={`${index}-${line}`} className="block">
              {line || '\u00A0'}
            </span>
          ))}
        </div>
        <img
          src="/logo.png"
          alt="N2NJ Logo"
          className="h-11 w-auto shrink-0 opacity-90"
        />
      </div>
    </button>,
    document.body
  ) : null;

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setPopoverVisible((value) => !value)}
        title={title}
        disabled={opening}
        className={className}
      >
        {children}
      </button>
      {popover}
    </span>
  );
}
