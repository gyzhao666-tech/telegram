import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Admin 路由保护
  if (pathname.startsWith('/admin')) {
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

    // 如果设置了 CRON_SECRET，必须验证
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // 允许本地测试
      const host = request.headers.get('host') || ''
      if (!host.includes('localhost')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/api/cron/:path*']
}

