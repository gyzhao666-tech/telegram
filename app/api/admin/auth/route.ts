import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

// 管理员密码（从环境变量获取）
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

// Token 有效期（7天）
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000

export async function POST(request: Request) {
  try {
    const { password } = await request.json()

    if (password === ADMIN_PASSWORD) {
      // 生成简单的 token
      const token = Buffer.from(`admin:${Date.now()}:${Math.random()}`).toString('base64')
      
      // 设置 cookie
      const cookieStore = await cookies()
      cookieStore.set('admin_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: TOKEN_EXPIRY / 1000,
        path: '/'
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: '密码错误' })
  } catch {
    return NextResponse.json({ success: false, error: '验证失败' }, { status: 500 })
  }
}

// 登出
export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete('admin_token')
  return NextResponse.json({ success: true })
}

