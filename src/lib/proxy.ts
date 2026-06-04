import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

type ProxyOptions = RequestInit & {
    /**
     * If true, returns a plain text response instead of JSON.
     * Useful for backward compatibility with plain text downstream APIs.
     */
    textResponse?: boolean;

    /**
     * If true, skips the internal authentication check (e.g. for cookie deletion which uses middleware).
     */
    skipAuth?: boolean;

    /**
     * If true, requires the authenticated user to be an admin.
     */
    requireAdmin?: boolean;

    /**
     * Maximum bytes to buffer for JSON/text proxy responses.
     */
    maxResponseBytes?: number;
};

const DEFAULT_JSON_RESPONSE_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_TEXT_RESPONSE_LIMIT_BYTES = 256 * 1024;
const ERROR_RESPONSE_LIMIT_BYTES = 4096;

/**
 * A centralized utility to proxy requests from the Next.js frontend to the internal StreamServ API.
 * This handles authentication, environment variable validation, header forwarding, and standard error handling.
 *
 * @param req The incoming NextRequest
 * @param internalPath The path to append to INTERNAL_API_URL (e.g. '/api/config')
 * @param options Fetch options and custom proxy options
 */
export async function proxyRequest(req: NextRequest, internalPath: string, options: ProxyOptions = {}) {
    try {
        const { textResponse, skipAuth, requireAdmin, maxResponseBytes, ...fetchOptions } = options;

        // 1. Authentication Check
        if (!skipAuth) {
            const user = await getCurrentUser();
            if (!user) {
                return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
            }
            if (requireAdmin && user.role !== 'admin') {
                return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
            }
        }

        // 2. Environment Verification
        const API_SECRET = process.env.INTERNAL_API_SECRET;
        const INTERNAL_API_URL = process.env.INTERNAL_API_URL;
        const WAF_BYPASS_HEADER = process.env.WAF_BYPASS_HEADER;

        if (!API_SECRET || !INTERNAL_API_URL) {
            console.error('Missing environment variables for internal API proxy');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // 3. Prepare Request
        // Ensure headers exist and merge the Auth token
        const headers = new Headers(fetchOptions.headers || {});
        headers.set('Authorization', `Bearer ${API_SECRET}`);
        applyWafBypassHeader(headers, WAF_BYPASS_HEADER);

        // Build the target URL, ensuring no double slashes if INTERNAL_API_URL has a trailing slash
        const baseUrl = INTERNAL_API_URL.endsWith('/') ? INTERNAL_API_URL.slice(0, -1) : INTERNAL_API_URL;
        const targetPath = internalPath.startsWith('/') ? internalPath : `/${internalPath}`;
        const targetUrl = `${baseUrl}${targetPath}`;

        // Prepare finalized fetch options
        const finalOptions: RequestInit = {
            ...fetchOptions,
            headers
        };

        // 4. Execute Proxy Request
        const response = await fetch(targetUrl, finalOptions);

        // 5. Error Handling
        if (!response.ok) {
            const { text: errorText, truncated } = await readResponseTextWithLimit(response, ERROR_RESPONSE_LIMIT_BYTES);
            const safeErrorText = truncated ? `${errorText}... [truncated]` : errorText;

            // Special case for 404s (e.g. specific cookie not found)
            if (response.status === 404) {
                return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
            }

            console.error(`Internal API returned ${response.status} for ${internalPath}: ${safeErrorText}`);

            if (textResponse) {
                return new NextResponse(safeErrorText, { status: response.status });
            }

            return NextResponse.json(
                { error: `Upstream Error: ${response.statusText} - ${safeErrorText}` },
                { status: response.status }
            );
        }

        // 6. Success Response Format
        if (textResponse) {
            const { text, truncated } = await readResponseTextWithLimit(
                response,
                maxResponseBytes ?? DEFAULT_TEXT_RESPONSE_LIMIT_BYTES
            );
            if (truncated) {
                return NextResponse.json({ error: 'Upstream text response too large' }, { status: 502 });
            }
            return new NextResponse(text, {
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
            });
        }

        const { text: jsonText, truncated } = await readResponseTextWithLimit(
            response,
            maxResponseBytes ?? DEFAULT_JSON_RESPONSE_LIMIT_BYTES
        );
        if (truncated) {
            return NextResponse.json({ error: 'Upstream JSON response too large' }, { status: 502 });
        }
        const data = JSON.parse(jsonText);
        return NextResponse.json(data);

    } catch (error) {
        console.error(`Proxy error for ${internalPath}:`, error);
        return NextResponse.json(
            { error: `Internal Proxy Error: ${error instanceof Error ? error.message : String(error)}` },
            { status: 500 }
        );
    }
}

export async function proxyPassthroughRequest(req: NextRequest, internalPath: string, options: ProxyOptions = {}) {
    try {
        const { skipAuth, requireAdmin, maxResponseBytes: _maxResponseBytes, ...fetchOptions } = options;

        if (!skipAuth) {
            const user = await getCurrentUser();
            if (!user) {
                return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
            }
            if (requireAdmin && user.role !== 'admin') {
                return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
            }
        }

        const API_SECRET = process.env.INTERNAL_API_SECRET;
        const INTERNAL_API_URL = process.env.INTERNAL_API_URL;
        const WAF_BYPASS_HEADER = process.env.WAF_BYPASS_HEADER;

        if (!API_SECRET || !INTERNAL_API_URL) {
            console.error('Missing environment variables for internal API proxy');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const headers = new Headers(fetchOptions.headers || {});
        headers.set('Authorization', `Bearer ${API_SECRET}`);
        applyWafBypassHeader(headers, WAF_BYPASS_HEADER);

        const baseUrl = INTERNAL_API_URL.endsWith('/') ? INTERNAL_API_URL.slice(0, -1) : INTERNAL_API_URL;
        const targetPath = internalPath.startsWith('/') ? internalPath : `/${internalPath}`;
        const targetUrl = `${baseUrl}${targetPath}`;

        const response = await fetch(targetUrl, {
            ...fetchOptions,
            headers,
        });

        if (!response.ok) {
            const { text: errorText, truncated } = await readResponseTextWithLimit(response, ERROR_RESPONSE_LIMIT_BYTES);
            const safeErrorText = truncated ? `${errorText}... [truncated]` : errorText;
            console.error(`Internal API returned ${response.status} for ${internalPath}: ${safeErrorText}`);
            return new NextResponse(safeErrorText || response.statusText, { status: response.status });
        }

        const passthroughHeaders = new Headers();
        for (const headerName of ['content-type', 'content-length', 'content-disposition', 'cache-control']) {
            const value = response.headers.get(headerName);
            if (value) {
                passthroughHeaders.set(headerName, value);
            }
        }

        return new NextResponse(response.body, {
            status: response.status,
            headers: passthroughHeaders,
        });
    } catch (error) {
        console.error(`Proxy passthrough error for ${internalPath}:`, error);
        return NextResponse.json(
            { error: `Internal Proxy Error: ${error instanceof Error ? error.message : String(error)}` },
            { status: 500 }
        );
    }
}

function applyWafBypassHeader(headers: Headers, rawHeader?: string) {
    const normalized = rawHeader?.trim();
    if (!normalized) {
        return;
    }

    const separatorIndex = normalized.indexOf(':');
    if (separatorIndex > 0) {
        const name = normalized.slice(0, separatorIndex).trim();
        const value = normalized.slice(separatorIndex + 1).trim();
        if (name && value) {
            headers.set(name, value);
        }
        return;
    }

    headers.set('x-bypass-waf', normalized);
}

async function readResponseTextWithLimit(response: Response, limitBytes: number) {
    if (!response.body) {
        return { text: '', truncated: false };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let truncated = false;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            if (totalBytes + value.byteLength > limitBytes) {
                const remaining = Math.max(limitBytes - totalBytes, 0);
                if (remaining > 0) {
                    chunks.push(value.slice(0, remaining));
                    totalBytes += remaining;
                }
                truncated = true;
                await reader.cancel();
                break;
            }

            chunks.push(value);
            totalBytes += value.byteLength;
        }
    } finally {
        reader.releaseLock();
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return {
        text: new TextDecoder().decode(merged),
        truncated,
    };
}
