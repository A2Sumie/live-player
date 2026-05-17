'use client';

import { useEffect, useRef } from 'react';

const OBFUSCATE_SALT = 0x3A;
const FONT_FAMILY = '"Hiragino Sans GB", "Yu Gothic UI", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif';

type ObfuscatedVariant = 'default' | 'cardTitle' | 'cardBody' | 'pageTitle' | 'pageBody';

type VariantStyle = {
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    wrapperClassName: string;
    prefixClassName: string;
    canvasClassName: string;
};

const VARIANT_STYLES: Record<ObfuscatedVariant, VariantStyle> = {
    default: {
        fontSize: 16,
        fontWeight: 600,
        lineHeight: 24,
        wrapperClassName: 'inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1',
        prefixClassName: 'leading-6',
        canvasClassName: 'max-w-full shrink min-w-0',
    },
    cardTitle: {
        fontSize: 19,
        fontWeight: 700,
        lineHeight: 28,
        wrapperClassName: 'inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1',
        prefixClassName: 'leading-7',
        canvasClassName: 'max-w-full shrink min-w-0',
    },
    cardBody: {
        fontSize: 14,
        fontWeight: 600,
        lineHeight: 22,
        wrapperClassName: 'inline-flex max-w-full flex-wrap items-start gap-x-1 gap-y-1',
        prefixClassName: 'leading-[1.55]',
        canvasClassName: 'max-w-full shrink min-w-0',
    },
    pageTitle: {
        fontSize: 22,
        fontWeight: 700,
        lineHeight: 32,
        wrapperClassName: 'inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-1',
        prefixClassName: 'leading-8',
        canvasClassName: 'max-w-full shrink min-w-0',
    },
    pageBody: {
        fontSize: 15,
        fontWeight: 600,
        lineHeight: 24,
        wrapperClassName: 'inline-flex max-w-full flex-wrap items-start gap-x-1.5 gap-y-1',
        prefixClassName: 'leading-6',
        canvasClassName: 'max-w-full shrink min-w-0',
    },
};

function joinClassNames(...parts: Array<string | undefined>) {
    return parts.filter(Boolean).join(' ');
}

/** Decodes a §-prefixed obfuscated string back to plain text. */
export function decodeObfuscated(encoded: string): string {
    if (!encoded.startsWith('§')) return encoded;
    return encoded.slice(1).split(',').map(n => String.fromCharCode(parseInt(n, 10) ^ OBFUSCATE_SALT)).join('');
}

/** Renders text that may contain a §-obfuscated segment. Non-§ text renders normally.
 *  Text like "【ON AIR】§65,66,67" renders the prefix as a span and the encoded
 *  part on a canvas element so it never appears as a DOM text node. */
export default function ObfuscatedText({
    text,
    className,
    playerId,
    variant = 'default',
}: {
    text?: string | null;
    className?: string;
    playerId?: string;
    variant?: ObfuscatedVariant;
}) {
    if (!text) {
        return null;
    }

    const sepIdx = text.indexOf('§');
    const hasEncoded = sepIdx !== -1;
    const prefix = hasEncoded ? text.slice(0, sepIdx) : text;
    const encodedPart = hasEncoded ? text.slice(sepIdx + 1) : '';
    const plainText = hasEncoded
        ? encodedPart.split(',').map(n => String.fromCharCode(parseInt(n, 10) ^ OBFUSCATE_SALT)).join('')
        : '';
    const style = VARIANT_STYLES[variant];

    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!hasEncoded) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = typeof window !== 'undefined' ? Math.max(window.devicePixelRatio || 1, 1) : 1;
        const font = `${style.fontWeight} ${style.fontSize}px ${FONT_FAMILY}`;

        ctx.font = font;
        const metrics = ctx.measureText(plainText);
        const textWidth = Math.max(Math.ceil(metrics.width), style.fontSize);
        const ascent = Math.ceil(metrics.actualBoundingBoxAscent || style.fontSize * 0.82);
        const descent = Math.ceil(metrics.actualBoundingBoxDescent || style.fontSize * 0.28);
        const width = textWidth + 6;
        const height = Math.max(style.lineHeight, ascent + descent + 4);

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.font = font;
        ctx.fillStyle = getComputedStyle(canvas).color || '#111827';
        ctx.textBaseline = 'alphabetic';

        const textY = Math.min(height - 2, ascent + Math.max(2, Math.floor((height - ascent - descent) / 2)));
        ctx.fillText(plainText, 3, textY);
    }, [hasEncoded, plainText, style.fontSize, style.fontWeight, style.lineHeight]);

    if (!hasEncoded) {
        return <span className={className}>{text}</span>;
    }
    return (
        <span className={joinClassNames(style.wrapperClassName, className)}>
            {prefix && <span className={style.prefixClassName}>{playerId ? `${prefix} ${playerId}` : prefix}</span>}
            {!prefix && playerId && <span className={style.prefixClassName}>{playerId}</span>}
            <canvas
                ref={canvasRef}
                aria-label="channel name"
                className={style.canvasClassName}
                style={{ display: 'inline-block', verticalAlign: 'middle' }}
            />
        </span>
    );
}
