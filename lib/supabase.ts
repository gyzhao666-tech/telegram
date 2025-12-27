import { createClient } from '@supabase/supabase-js'

// Supabase 客户端（服务端使用 Service Role Key）
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// 类型定义
export interface TelegramChat {
  id: string
  chat_id: string
  title: string
  type: 'group' | 'supergroup' | 'channel' | 'private'
  username: string | null
  member_count: number | null
  is_active: boolean
  last_message_id: number
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface TelegramMessage {
  id: string
  chat_id: string
  message_id: number
  sender_id: string | null
  sender_name: string | null
  text: string
  date: string
  has_media: boolean
  media_type: string | null
  reply_to_message_id: number | null
  forward_from: string | null
  raw_data: any
  created_at: string
}

export interface TelegramSyncRun {
  id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'success' | 'failed'
  chats_synced: number
  messages_synced: number
  error_message: string | null
}

