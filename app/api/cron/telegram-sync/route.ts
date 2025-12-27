/**
 * Vercel Cron Job - 每分钟同步 Telegram 群组/频道消息
 * 
 * 使用 GramJS (telegram) 库以用户身份登录
 * 只同步你已加入的群组和频道
 */

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60 // 1分钟超时

// 每个 chat 最多拉取的新消息数
const MAX_MESSAGES_PER_CHAT = 50

// 延迟函数
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function GET(request: Request) {
  const startTime = Date.now()
  
  // 创建同步记录
  const { data: syncRun, error: syncRunError } = await supabase
    .from('telegram_sync_runs')
    .insert({ status: 'running' })
    .select()
    .single()

  if (syncRunError) {
    console.error('Failed to create sync run:', syncRunError)
    return NextResponse.json({ error: 'Failed to create sync run' }, { status: 500 })
  }

  const syncRunId = syncRun.id
  let chatsSynced = 0
  let messagesSynced = 0
  let errorMessage: string | null = null

  try {
    // 检查必要的环境变量
    const apiId = parseInt(process.env.TELEGRAM_API_ID || '0')
    const apiHash = process.env.TELEGRAM_API_HASH || ''
    const sessionString = process.env.TELEGRAM_SESSION || ''

    if (!apiId || !apiHash) {
      throw new Error('缺少 TELEGRAM_API_ID 或 TELEGRAM_API_HASH 环境变量')
    }

    if (!sessionString) {
      throw new Error('缺少 TELEGRAM_SESSION 环境变量，请先运行 scripts/generate-session.ts 生成')
    }

    // 动态导入 telegram 库（避免在非 Node 环境报错）
    const { TelegramClient } = await import('telegram')
    const { StringSession } = await import('telegram/sessions')

    const stringSession = new StringSession(sessionString)
    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 3,
    })

    await client.connect()
    console.log('✅ Telegram 客户端已连接')

    // 获取所有对话（群组/频道）
    const dialogs = await client.getDialogs({ limit: 100 })
    console.log(`📋 找到 ${dialogs.length} 个对话`)

    // 过滤出群组和频道
    const targetDialogs = dialogs.filter(d => {
      const entity = d.entity as any
      // 包含群组、超级群组、频道
      return entity?.className === 'Channel' || 
             entity?.className === 'Chat' ||
             (entity?.megagroup === true) ||
             (entity?.broadcast === true)
    })

    console.log(`📱 筛选出 ${targetDialogs.length} 个群组/频道`)

    for (const dialog of targetDialogs) {
      try {
        const entity = dialog.entity as any
        const chatId = entity.id?.toString() || ''
        const title = dialog.title || entity.title || '未命名'
        const username = entity.username || null
        const memberCount = entity.participantsCount || null
        
        // 判断类型
        let chatType: 'group' | 'supergroup' | 'channel' | 'private' = 'group'
        if (entity.broadcast) {
          chatType = 'channel'
        } else if (entity.megagroup || entity.className === 'Channel') {
          chatType = 'supergroup'
        }

        console.log(`\n📡 处理: ${title} (${chatType})`)

        // 查询或创建 chat 记录
        let { data: chatRecord } = await supabase
          .from('telegram_chats')
          .select('*')
          .eq('chat_id', chatId)
          .single()

        if (!chatRecord) {
          // 创建新记录（适配实际表结构）
          const { data: newChat, error: insertError } = await supabase
            .from('telegram_chats')
            .insert({
              chat_id: chatId,
              title,
              type: chatType,
              username,
              member_count: memberCount,
              is_megagroup: entity.megagroup || false,
              is_broadcast: entity.broadcast || false,
              last_message_id: 0,
            })
            .select()
            .single()

          if (insertError) {
            console.error(`  ❌ 创建 chat 记录失败:`, insertError)
            continue
          }
          chatRecord = newChat
          console.log(`  ✓ 新建 chat 记录`)
        } else {
          // 更新基本信息
          await supabase
            .from('telegram_chats')
            .update({ title, username, member_count: memberCount })
            .eq('chat_id', chatRecord.chat_id)
        }

        // 拉取新消息（增量：只拉 last_message_id 之后的）
        const lastMessageId = chatRecord.last_message_id || 0
        
        const messages = await client.getMessages(entity, {
          limit: MAX_MESSAGES_PER_CHAT,
          minId: lastMessageId,
        })

        if (messages.length === 0) {
          console.log(`  📭 无新消息`)
          continue
        }

        console.log(`  📨 找到 ${messages.length} 条新消息`)

        let maxMsgId = lastMessageId
        let savedCount = 0

        for (const msg of messages) {
          // 跳过空消息
          if (!msg.message && !msg.media) continue

          const messageId = msg.id
          if (messageId > maxMsgId) maxMsgId = messageId

          // 获取发送者信息
          let senderId: string | null = null
          let senderName: string | null = null
          
          if (msg.senderId) {
            senderId = msg.senderId.toString()
            try {
              const sender = await msg.getSender()
              if (sender) {
                senderName = (sender as any).firstName || 
                            (sender as any).title || 
                            (sender as any).username || 
                            null
              }
            } catch {
              // 忽略获取发送者失败的情况
            }
          }

          // 检查媒体类型
          let hasMedia = false
          let mediaType: string | null = null
          if (msg.media) {
            hasMedia = true
            mediaType = msg.media.className || 'unknown'
          }

          // 插入消息
          const { error: msgError } = await supabase
            .from('telegram_messages')
            .upsert({
              chat_id: chatId,
              message_id: messageId,
              sender_id: senderId,
              sender_name: senderName,
              text: msg.message || '',
              date: new Date((msg.date || 0) * 1000).toISOString(),
              has_media: hasMedia,
              media_type: mediaType,
              reply_to_message_id: msg.replyTo?.replyToMsgId || null,
              forward_from: msg.fwdFrom?.fromName || null,
            }, {
              onConflict: 'chat_id,message_id',
              ignoreDuplicates: true,
            })

          if (!msgError) {
            savedCount++
          }
        }

        // 更新 chat 的 last_message_id
        await supabase
          .from('telegram_chats')
          .update({ 
            last_message_id: maxMsgId,
            last_synced_at: new Date().toISOString(),
          })
          .eq('chat_id', chatRecord.chat_id)

        console.log(`  ✅ 保存 ${savedCount} 条消息`)
        messagesSynced += savedCount
        chatsSynced++

        // 避免请求过快
        await delay(300)

      } catch (chatError: any) {
        console.error(`  ❌ 处理失败:`, chatError.message)
      }
    }

    // 断开连接
    await client.disconnect()
    console.log('\n🔌 Telegram 客户端已断开')

  } catch (error: any) {
    console.error('❌ 同步失败:', error)
    errorMessage = error.message
  }

  // 更新同步记录
  const duration = Date.now() - startTime
  await supabase
    .from('telegram_sync_runs')
    .update({
      finished_at: new Date().toISOString(),
      status: errorMessage ? 'failed' : 'success',
      chats_synced: chatsSynced,
      messages_synced: messagesSynced,
      error_message: errorMessage,
    })
    .eq('id', syncRunId)

  console.log(`\n📊 同步完成: ${chatsSynced} 个群组, ${messagesSynced} 条消息, 耗时 ${duration}ms`)

  return NextResponse.json({
    success: !errorMessage,
    chatsSynced,
    messagesSynced,
    duration,
    error: errorMessage,
  })
}

