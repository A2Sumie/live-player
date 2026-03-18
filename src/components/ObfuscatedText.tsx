'use client';

import { useRef, useEffect } from 'react';

const OBFUSCATE_SALT = 0x3A;

/** Decodes a §-prefixed obfuscated string back to plain text. */
export function decodeObfuscated(encoded: string): string {
    if (!encoded.startsWith('§')) return encoded;
    return encoded.slice(1).split(',').map(n => String.fromCharCode(parseInt(n, 10) ^ OBFUSCATE_SALT)).join('');
}

/** Renders text that may contain a §-obfuscated segment. Non-§ text renders normally.
 *  Text like "【ON AIR】§65,66,67" renders the prefix as a span and the encoded
 *  part on a canvas element so it never appears as a DOM text node. */
export default function ObfuscatedText({ text, className, playerId }: { text: string; className?: string; playerId?: string }) {
    const sepIdx = text.indexOf('§');
    const hasEncoded = sepIdx !== -1;
    const prefix = hasEncoded ? text.slice(0, sepIdx) : text;
    const encodedPart = hasEncoded ? text.slice(sepIdx + 1) : '';
    const plainText = hasEncoded
        ? encodedPart.split(',').map(n => String.fromCharCode(parseInt(n, 10) ^ OBFUSCATE_SALT)).join('')
        : '';

    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!hasEncoded) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const fontSize = 18;
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        const metrics = ctx.measureText(plainText);
        canvas.width = Math.ceil(metrics.width) + 4;
        canvas.height = fontSize + 8;
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.fillStyle = getComputedStyle(canvas).color || '#111827';
        ctx.fillText(plainText, 2, fontSize);
    }, [plainText, hasEncoded]);

    if (!hasEncoded) {
        return <span className={className}>{text}</span>;
    }
    return (
        <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {prefix && <span>{playerId ? `${prefix} ${playerId}` : prefix}</span>}
            {!prefix && playerId && <span>{playerId}</span>}
            <canvas ref={canvasRef} aria-label="channel name" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
        </span>
    );
}
