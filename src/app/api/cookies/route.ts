
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const authHeader = req.headers.get('Authorization')

        // Internal API URL
        // Using the tunnel hostname
        const internalUrl = 'https://idol-bbq-internal.n2nj.moe/api/cookie'

        const response = await fetch(internalUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(authHeader ? { 'Authorization': authHeader } : {})
            },
            body: JSON.stringify(body)
        })

        const data = await response.text()

        return new NextResponse(data, {
            status: response.status,
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'text/plain'
            }
        })

    } catch (error) {
        console.error('Proxy error:', error)
        return new NextResponse('Internal Proxy Error', { status: 500 })
    }
}
