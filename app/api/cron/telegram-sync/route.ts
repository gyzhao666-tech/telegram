/**
 * Vercel Cron Job - 每分钟同步 Telegram 群组/频道消息
 * 
 * 使用 GramJS (telegram) 库以用户身份登录
 * 只同步你已加入的群组和频道
 * 图片上传到阿里云 OSS
 */

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { uploadBufferToOSS, isOSSConfigured } from '@/lib/oss'

export const runtime = 'nodejs'
export const maxDuration = 60 // 1分钟超时

// 每个 chat 最多拉取的新消息数
const MAX_MESSAGES_PER_CHAT = 50

// 延迟函数
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function GET(request: Request) {
  const startTime = Date.now()
  
  // 检查是否强制全量同步
  const url = new URL(request.url)
  const forceFullSync = url.searchParams.get('full') === 'true'
  if (forceFullSync) {
    console.log(`🔄 强制全量同步模式`)
  }
  
  // 检查 OSS 配置
  const ossEnabled = isOSSConfigured()
  console.log(`📦 OSS 存储: ${ossEnabled ? '已启用' : '未配置'}`)
  
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
    
    // 配置代理（本地开发用）
    const proxyPort = process.env.PROXY_PORT || '7897'
    const useProxy = process.env.USE_PROXY === 'true'
    
    const clientOptions: any = {
      connectionRetries: 5,
      timeout: 30,
    }
    
    // 如果配置了代理
    if (useProxy) {
      console.log(`🌐 使用代理: socks5://127.0.0.1:${proxyPort}`)
      clientOptions.proxy = {
        ip: '127.0.0.1',
        port: parseInt(proxyPort),
        socksType: 5,
      }
    }
    
    const client = new TelegramClient(stringSession, apiId, apiHash, clientOptions)

    await client.connect()
    console.log('✅ Telegram 客户端已连接')

    // 获取所有对话（群组/频道）
    const dialogs = await client.getDialogs({ limit: 100 })
    console.log(`📋 找到 ${dialogs.length} 个对话`)

    // 只处理指定的频道（可配置）
    const ALLOWED_CHANNELS = process.env.ALLOWED_CHANNELS?.split(',') || ['财联社VIP文章分享']
    
    // 过滤出群组和频道
    const targetDialogs = dialogs.filter(d => {
      const entity = d.entity as any
      const title = d.title || entity?.title || ''
      
      // 只处理允许列表中的频道
      const isAllowed = ALLOWED_CHANNELS.some(name => title.includes(name.trim()))
      if (!isAllowed) return false
      
      // 包含群组、超级群组、频道
      return entity?.className === 'Channel' || 
             entity?.className === 'Chat' ||
             (entity?.megagroup === true) ||
             (entity?.broadcast === true)
    })

    console.log(`📱 筛选出 ${targetDialogs.length} 个群组/频道 (只处理: ${ALLOWED_CHANNELS.join(', ')})`)

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

        // 拉取消息
        const lastMessageId = chatRecord.last_message_id || 0
        const oldestMessageId = chatRecord.oldest_message_id || 0
        console.log(`  📊 数据库状态: last=${lastMessageId}, oldest=${oldestMessageId}`)
        
        let messages: any[] = []
        
        if (forceFullSync) {
          // 强制全量模式：向后翻页获取历史消息
          if (oldestMessageId > 0) {
            // 有 oldest_message_id，从这里向后翻页
            console.log(`  📍 向后翻页: offsetId=${oldestMessageId}`)
            messages = await client.getMessages(entity, {
              limit: MAX_MESSAGES_PER_CHAT,
              offsetId: oldestMessageId,
            })
          } else if (lastMessageId > 0) {
            // 有 last_message_id 但没有 oldest_message_id，从最新消息开始向后
            console.log(`  📍 从最新消息向后翻页: offsetId=${lastMessageId + 1}`)
            messages = await client.getMessages(entity, {
              limit: MAX_MESSAGES_PER_CHAT,
              offsetId: lastMessageId + 1,
            })
          } else {
            // 都没有，获取最新消息
            console.log(`  📍 首次同步`)
            messages = await client.getMessages(entity, {
              limit: MAX_MESSAGES_PER_CHAT,
            })
          }
        } else if (lastMessageId > 0) {
          // 增量同步：获取 last_message_id 之后的新消息
          console.log(`  📍 增量同步: minId=${lastMessageId}`)
          messages = await client.getMessages(entity, {
            limit: MAX_MESSAGES_PER_CHAT,
            minId: lastMessageId,
          })
        } else {
          // 首次同步：获取最新的消息
          console.log(`  📍 首次同步`)
          messages = await client.getMessages(entity, {
            limit: MAX_MESSAGES_PER_CHAT,
          })
        }

        if (messages.length === 0) {
          console.log(`  📭 无${forceFullSync ? '更多历史' : '新'}消息`)
          continue
        }

        console.log(`  📨 找到 ${messages.length} 条消息`)

        let maxMsgId = lastMessageId
        let minMsgId = oldestMessageId || Number.MAX_SAFE_INTEGER
        let savedCount = 0

        for (const msg of messages) {
          // 跳过空消息
          if (!msg.message && !msg.media) continue

          const messageId = msg.id
          if (messageId > maxMsgId) maxMsgId = messageId
          if (messageId < minMsgId) minMsgId = messageId

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

          // 检查媒体类型并上传到 OSS
          let hasMedia = false
          let mediaType: string | null = null
          let mediaUrl: string | null = null

          if (msg.media) {
            hasMedia = true
            mediaType = msg.media.className || 'unknown'
            
            // 只处理图片类型的媒体
            if (ossEnabled && (
              mediaType === 'MessageMediaPhoto' ||
              (mediaType === 'MessageMediaDocument' && 
               (msg.media as any)?.document?.mimeType?.startsWith('image/'))
            )) {
              try {
                // 下载媒体
                const buffer = await client.downloadMedia(msg.media, {
                  workers: 1,
                })
                
                if (buffer && Buffer.isBuffer(buffer)) {
                  // 确定文件扩展名
                  let ext = 'jpg'
                  if (mediaType === 'MessageMediaDocument') {
                    const mimeType = (msg.media as any)?.document?.mimeType || ''
                    if (mimeType.includes('png')) ext = 'png'
                    else if (mimeType.includes('gif')) ext = 'gif'
                    else if (mimeType.includes('webp')) ext = 'webp'
                  }
                  
                  // 上传到 OSS
                  mediaUrl = await uploadBufferToOSS(buffer, chatId, messageId, ext)
                  if (mediaUrl) {
                    console.log(`  📷 ${messageId} -> OSS (${Math.round(buffer.length / 1024)}KB)`)
                  }
                }
              } catch (downloadError: any) {
                console.log(`  ⚠️ 下载媒体失败: ${downloadError.message}`)
              }
            }
          }

          // 提取 entities 用于链接和 hashtag
          const entities = msg.entities?.map((e: any) => ({
            type: e.className,
            offset: e.offset,
            length: e.length,
            url: e.url || null,
          })) || []

          // 提取 reply_markup 中的按钮
          let buttons: any[] = []
          if (msg.replyMarkup && (msg.replyMarkup as any).rows) {
            buttons = (msg.replyMarkup as any).rows.flatMap((row: any) =>
              row.buttons?.map((btn: any) => ({
                text: btn.text,
                url: btn.url || null,
              })) || []
            )
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
              media_url: mediaUrl,
              reply_to_message_id: msg.replyTo?.replyToMsgId || null,
              raw_data: {
                entities,
                buttons,
                views: msg.views || 0,
                forwards: msg.forwards || 0,
                forward_from: msg.fwdFrom?.fromName || null,
              },
            }, {
              onConflict: 'chat_id,message_id',
              ignoreDuplicates: false, // 允许更新（可能需要补充图片）
            })

          if (msgError) {
            console.log(`  ⚠️ 保存消息失败: ${JSON.stringify(msgError)}`)
          } else {
            savedCount++
          }
        }

        // 更新 chat 的 last_message_id 和 oldest_message_id
        const updateData: any = { 
          last_synced_at: new Date().toISOString(),
        }
        // 只有获取到更新的消息才更新 last_message_id
        if (maxMsgId > lastMessageId) {
          updateData.last_message_id = maxMsgId
        }
        // 只有获取到更早的消息才更新 oldest_message_id
        if (minMsgId < (oldestMessageId || Number.MAX_SAFE_INTEGER)) {
          updateData.oldest_message_id = minMsgId
          console.log(`  📝 更新 oldest_message_id: ${oldestMessageId} -> ${minMsgId}`)
        }
        
        const { error: updateError } = await supabase
          .from('telegram_chats')
          .update(updateData)
          .eq('chat_id', chatRecord.chat_id)
        
        if (updateError) {
          console.error(`  ⚠️ 更新 chat 失败: ${updateError.message}`)
        }

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
    ossEnabled,
    error: errorMessage,
  })
}
