# Telegram Sync Dashboard

实时同步你已加入的 Telegram 群组/频道消息到 Supabase，并提供 Web 仪表盘查看。

## ✨ 功能

- 📱 **自动同步** - Vercel Cron 每分钟自动拉取新消息
- 👥 **只同步已加入的** - 仅同步你账号已加入的群组/频道
- 📊 **Web 仪表盘** - 浏览群组列表、搜索消息、查看同步记录
- 🔐 **密码保护** - 管理后台需要密码登录
- 🚀 **增量同步** - 只拉取上次同步后的新消息，避免重复
- 🖼️ **图片存储** - 自动下载图片并上传到阿里云 OSS
- 🔗 **链接解析** - 消息中的链接、标签可点击跳转

## 🚀 快速开始

### 1. 安装依赖

```bash
cd telegram-sync-dashboard
pnpm install
```

### 2. 配置 Supabase

1. 在 [Supabase](https://supabase.com) 创建一个项目
2. 在 SQL Editor 中执行 `supabase/schema.sql` 创建表
3. 复制项目的 URL 和 API Keys

### 3. 获取 Telegram API 凭证

1. 访问 https://my.telegram.org/apps
2. 使用 Telegram 账号登录
3. 创建一个新应用（名称随意，如 "My Sync App"）
4. 记下 `api_id` 和 `api_hash`

### 4. 配置环境变量

复制 `.env.example` 为 `.env.local`：

```bash
cp .env.example .env.local
```

填入你的配置：

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your-api-hash

ADMIN_PASSWORD=your-password
```

### 5. 生成 Telegram Session

运行交互式脚本登录你的 Telegram 账号：

```bash
npx tsx scripts/generate-session.ts
```

按提示输入手机号和验证码，登录成功后会输出 `TELEGRAM_SESSION=xxx`，把这个值添加到 `.env.local`。

⚠️ **注意**：Session 就像你的登录凭证，请妥善保管，不要分享给他人或提交到 Git。

### 6. 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:3000 登录管理后台。

### 7. 测试同步

在管理后台点击"立即同步"按钮，或直接访问：

```
http://localhost:3000/api/cron/telegram-sync
```

## 📦 部署到 Vercel

1. 将代码推送到 GitHub
2. 在 Vercel 导入项目
3. 配置环境变量（与 `.env.local` 相同）
4. 部署完成后，Cron Job 会自动每分钟执行

## 🗂️ 项目结构

```
telegram-sync-dashboard/
├── app/
│   ├── api/
│   │   ├── admin/auth/     # 登录接口
│   │   └── cron/telegram-sync/  # Cron 同步接口
│   ├── admin/
│   │   ├── login/          # 登录页
│   │   └── page.tsx        # 仪表盘
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── supabase.ts         # Supabase 客户端
│   └── oss.ts              # 阿里云 OSS 工具
├── scripts/
│   └── generate-session.ts # Session 生成脚本
├── supabase/
│   └── schema.sql          # 数据库表结构
├── vercel.json             # Cron 配置
└── README.md
```

## ⚙️ 配置说明

### vercel.json

```json
{
  "crons": [
    {
      "path": "/api/cron/telegram-sync",
      "schedule": "* * * * *"
    }
  ]
}
```

- `* * * * *` = 每分钟执行一次
- 可改为 `*/5 * * * *` = 每 5 分钟

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| NEXT_PUBLIC_SUPABASE_URL | ✅ | Supabase 项目 URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | ✅ | Supabase Anon Key |
| SUPABASE_SERVICE_ROLE_KEY | ✅ | Supabase Service Role Key（用于 Cron）|
| TELEGRAM_API_ID | ✅ | Telegram API ID |
| TELEGRAM_API_HASH | ✅ | Telegram API Hash |
| TELEGRAM_SESSION | ✅ | Telegram 登录 Session |
| ADMIN_PASSWORD | ❌ | 管理后台密码（默认 admin123）|
| CRON_SECRET | ❌ | Cron 接口保护密钥 |
| OSS_ACCESS_KEY_ID | ❌ | 阿里云 OSS Access Key ID（图片存储）|
| OSS_ACCESS_KEY_SECRET | ❌ | 阿里云 OSS Access Key Secret |
| OSS_BUCKET | ❌ | 阿里云 OSS Bucket 名称 |
| OSS_REGION | ❌ | 阿里云 OSS Region（默认 oss-cn-beijing）|

### 阿里云 OSS 配置（可选）

如果配置了 OSS 环境变量，同步时会自动下载 Telegram 图片并上传到阿里云 OSS，这样：
- ✅ 图片加载更快（CDN 加速）
- ✅ 不占用 Supabase 数据库空间
- ✅ 图片链接永久有效

如果不配置，图片将不会被保存。

## ⚠️ 注意事项

1. **风控风险**：频繁使用 Telegram 用户 API 可能触发风控，建议：
   - 使用专用小号
   - 不要过于频繁调用
   - 遵守 Telegram 使用条款

2. **Session 安全**：`TELEGRAM_SESSION` 就像你的登录凭证，泄露后他人可以访问你的账号。

3. **数据隐私**：同步的消息会存储在 Supabase，请确保数据库安全配置。

## 📄 License

MIT

