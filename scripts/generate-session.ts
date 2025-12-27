/**
 * 生成 Telegram Session 字符串
 * 
 * 运行方式: npx tsx scripts/generate-session.ts
 * 
 * 这个脚本会引导你登录 Telegram 账号，登录成功后会输出 TELEGRAM_SESSION
 * 把这个值复制到 .env.local 文件中即可
 */

import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'

// 加载 .env.local
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=')
      if (key && !key.startsWith('#') && valueParts.length > 0) {
        const value = valueParts.join('=').trim()
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value
        }
      }
    })
  }
}
loadEnv()

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║       📱 Telegram Session 生成器                          ║
╠══════════════════════════════════════════════════════════╣
║  这个脚本会帮你生成 TELEGRAM_SESSION                      ║
║  用于 Vercel Cron 定时同步你的 Telegram 消息             ║
╚══════════════════════════════════════════════════════════╝
`)

  const apiId = parseInt(process.env.TELEGRAM_API_ID || '0')
  const apiHash = process.env.TELEGRAM_API_HASH || ''

  if (!apiId || !apiHash) {
    console.log('❌ 错误：缺少 TELEGRAM_API_ID 或 TELEGRAM_API_HASH')
    console.log('')
    console.log('📋 获取步骤：')
    console.log('   1. 访问 https://my.telegram.org/apps')
    console.log('   2. 使用你的 Telegram 账号登录')
    console.log('   3. 创建一个新的应用（名称随意）')
    console.log('   4. 复制 api_id 和 api_hash')
    console.log('   5. 在项目根目录创建 .env.local 文件，添加：')
    console.log('')
    console.log('      TELEGRAM_API_ID=你的api_id')
    console.log('      TELEGRAM_API_HASH=你的api_hash')
    console.log('')
    console.log('   6. 重新运行此脚本')
    return
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve)
    })
  }

  // 使用空 session 开始
  const stringSession = new StringSession('')
  
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  })

  try {
    console.log('🔄 正在连接 Telegram...')
    
    await client.start({
      phoneNumber: async () => {
        return await question('📱 请输入你的手机号码 (格式: +86xxxxxxxxxx): ')
      },
      password: async () => {
        return await question('🔐 请输入两步验证密码 (如果没有设置，直接回车): ')
      },
      phoneCode: async () => {
        return await question('📨 请输入收到的验证码: ')
      },
      onError: (err) => {
        console.error('❌ 错误:', err.message)
      },
    })

    console.log('')
    console.log('✅ 登录成功！')
    console.log('')

    // 获取 session 字符串
    const session = client.session.save() as unknown as string

    console.log('═'.repeat(60))
    console.log('')
    console.log('📋 请将以下内容添加到你的 .env.local 文件：')
    console.log('')
    console.log(`TELEGRAM_SESSION=${session}`)
    console.log('')
    console.log('═'.repeat(60))
    console.log('')
    console.log('⚠️  重要提示：')
    console.log('   • 这个 Session 就像你的登录凭证，请妥善保管')
    console.log('   • 不要把它分享给任何人')
    console.log('   • 不要把它提交到 Git 仓库')
    console.log('')

    // 测试获取对话列表
    console.log('🔍 测试获取你的群组/频道列表...')
    const dialogs = await client.getDialogs({ limit: 20 })
    
    const groups = dialogs.filter(d => {
      const entity = d.entity as any
      return entity?.className === 'Channel' || 
             entity?.className === 'Chat' ||
             entity?.megagroup === true ||
             entity?.broadcast === true
    })

    console.log('')
    console.log(`📋 找到 ${groups.length} 个群组/频道：`)
    groups.forEach((d, i) => {
      const entity = d.entity as any
      const type = entity.broadcast ? '📢频道' : '👥群组'
      console.log(`   ${i + 1}. ${type} ${d.title}`)
    })
    console.log('')

  } catch (error: any) {
    console.error('❌ 登录失败:', error.message)
  } finally {
    rl.close()
    await client.disconnect()
  }
}

main()

