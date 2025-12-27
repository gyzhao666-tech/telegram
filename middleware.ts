import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host') || ''
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')

  // Admin 路由保护 - 只允许本地访问
  if (pathname.startsWith('/admin')) {
    // 非本地访问直接返回 403
    if (!isLocalhost) {
      return NextResponse.json(
        { error: 'Admin panel is only accessible locally' }, 
        { status: 403 }
      )
    }

    // 登录页不需要验证
    if (pathname === '/admin/login') {
      return NextResponse.next()
    }

    // 检查 token
    const token = request.cookies.get('admin_token')
    if (!token) {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }
  }

  // Cron API 保护
  if (pathname.startsWith('/api/cron')) {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    // Vercel Cron 会带上特殊的 header
    const isVercelCron = request.headers.get('x-vercel-cron') === '1'

    // 允许 Vercel Cron 或本地测试
    if (isVercelCron || isLocalhost) {
      return NextResponse.next()
    }

    // 如果设置了 CRON_SECRET，必须验证
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/api/cron/:path*']
}

