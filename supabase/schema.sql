-- Telegram 同步数据库表结构
-- 在 Supabase SQL Editor 中执行此脚本

-- ========================================
-- 1. telegram_chats 表（群组/频道信息）
-- ========================================
CREATE TABLE IF NOT EXISTS telegram_chats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,           -- Telegram chat ID (可能是负数)
  title TEXT NOT NULL,                     -- 群组/频道名称
  type TEXT NOT NULL CHECK (type IN ('group', 'supergroup', 'channel', 'private')),
  username TEXT,                           -- @username（如果有）
  member_count INTEGER,                    -- 成员数
  is_active BOOLEAN DEFAULT true,          -- 是否继续同步
  last_message_id BIGINT DEFAULT 0,        -- 上次同步到的消息ID（用于增量）
  last_synced_at TIMESTAMPTZ,              -- 上次同步时间
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_chats_chat_id ON telegram_chats(chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_chats_is_active ON telegram_chats(is_active);
CREATE INDEX IF NOT EXISTS idx_telegram_chats_last_synced ON telegram_chats(last_synced_at DESC);

-- ========================================
-- 2. telegram_messages 表（消息内容）
-- ========================================
CREATE TABLE IF NOT EXISTS telegram_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id TEXT NOT NULL,                   -- 关联的 chat_id
  message_id BIGINT NOT NULL,              -- Telegram 消息ID
  sender_id TEXT,                          -- 发送者ID
  sender_name TEXT,                        -- 发送者名称
  text TEXT,                               -- 消息文本
  date TIMESTAMPTZ NOT NULL,               -- 消息时间
  has_media BOOLEAN DEFAULT false,         -- 是否包含媒体
  media_type TEXT,                         -- 媒体类型
  media_url TEXT,                          -- 媒体 URL（阿里云 OSS）
  reply_to_message_id BIGINT,              -- 回复的消息ID
  forward_from TEXT,                       -- 转发来源
  raw_data JSONB,                          -- 原始数据（可选）
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_chat_id ON telegram_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_date ON telegram_messages(date DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_message_id ON telegram_messages(message_id DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_text ON telegram_messages USING gin(to_tsvector('simple', coalesce(text, '')));

-- ========================================
-- 3. telegram_sync_runs 表（同步记录）
-- ========================================
CREATE TABLE IF NOT EXISTS telegram_sync_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  chats_synced INTEGER DEFAULT 0,
  messages_synced INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_sync_runs_started ON telegram_sync_runs(started_at DESC);

-- ========================================
-- 4. RLS 策略（默认禁用公开访问）
-- ========================================
ALTER TABLE telegram_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_sync_runs ENABLE ROW LEVEL SECURITY;

-- 只允许 service_role 访问（用于 Vercel Cron）
DROP POLICY IF EXISTS "Service role only - chats" ON telegram_chats;
CREATE POLICY "Service role only - chats" ON telegram_chats
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role only - messages" ON telegram_messages;
CREATE POLICY "Service role only - messages" ON telegram_messages
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role only - sync_runs" ON telegram_sync_runs;
CREATE POLICY "Service role only - sync_runs" ON telegram_sync_runs
  FOR ALL USING (auth.role() = 'service_role');

-- ========================================
-- 5. 更新时间触发器
-- ========================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telegram_chats_updated_at ON telegram_chats;
CREATE TRIGGER telegram_chats_updated_at
  BEFORE UPDATE ON telegram_chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

