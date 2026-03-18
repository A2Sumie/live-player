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
};

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
        const { textResponse, skipAuth, ...fetchOptions } = options;

        // 1. Authentication Check
        if (!skipAuth) {
            const user = await getCurrentUser();
            if (!user) {
                return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
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
            const errorText = await response.text();

            // Special case for 404s (e.g. specific cookie not found)
            if (response.status === 404) {
                return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
            }

            console.error(`Internal API returned ${response.status} for ${internalPath}: ${errorText}`);

            if (textResponse) {
                return new NextResponse(errorText, { status: response.status });
            }

            return NextResponse.json(
                { error: `Upstream Error: ${response.statusText} - ${errorText}` },
                { status: response.status }
            );
        }

        // 6. Success Response Format
        if (textResponse) {
            const text = await response.text();
            return new NextResponse(text, {
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
            });
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error(`Proxy error for ${internalPath}:`, error);
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
