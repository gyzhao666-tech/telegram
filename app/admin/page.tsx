'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// 检查 Supabase 是否已配置
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const isConfigured = supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder')

// 客户端 Supabase（使用 anon key）
let supabase: SupabaseClient | null = null
if (isConfigured) {
  supabase = createClient(supabaseUrl!, supabaseKey!)
}

interface Chat {
  chat_id: string
  title: string
  type: string
  username: string | null
  member_count: number | null
  is_megagroup: boolean
  is_broadcast: boolean
  last_synced_at: string | null
  last_message_id: number
}

interface MessageEntity {
  type: string
  offset: number
  length: number
  url: string | null
}

interface MessageButton {
  text: string
  url: string
}

interface MessageRaw {
  entities?: MessageEntity[]
  buttons?: MessageButton[]
  mediaType?: string | null
  mediaData?: string | null  // base64 data URL
}

interface Message {
  chat_id: string
  message_id: number
  sender_id: string | null
  sender_name: string | null
  text: string
  date: string
  has_media: boolean
  views?: number
  forwards?: number
  raw?: MessageRaw | null
}

interface SyncRun {
  id: string
  started_at: string
  finished_at: string | null
  status: string
  chats_synced: number
  messages_synced: number
  error_message: string | null
}

export default function AdminDashboard() {
  const router = useRouter()
  const [chats, setChats] = useState<Chat[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([])
  const [selectedChat, setSelectedChat] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [stats, setStats] = useState({ totalChats: 0, totalMessages: 0, lastSync: '' })

  // 加载数据
  useEffect(() => {
    if (isConfigured) {
      loadData()
    } else {
      setLoading(false)
    }
  }, [])

  // 当选中 chat 变化时加载消息
  useEffect(() => {
    if (selectedChat && isConfigured) {
      loadMessages(selectedChat)
    }
  }, [selectedChat])

  async function loadData() {
    if (!supabase) return
    setLoading(true)
    try {
      // 加载 chats
      const { data: chatsData } = await supabase
        .from('telegram_chats')
        .select('*')
        .order('last_synced_at', { ascending: false })

      if (chatsData) {
        setChats(chatsData)
        setStats(s => ({ ...s, totalChats: chatsData.length }))
      }

      // 加载最近同步记录
      const { data: runsData } = await supabase
        .from('telegram_sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(10)

      if (runsData) {
        setSyncRuns(runsData)
        if (runsData[0]?.finished_at) {
          setStats(s => ({ ...s, lastSync: runsData[0].finished_at }))
        }
      }

      // 统计消息总数
      const { count } = await supabase
        .from('telegram_messages')
        .select('*', { count: 'exact', head: true })

      if (count) {
        setStats(s => ({ ...s, totalMessages: count }))
      }

    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadMessages(chatId: string) {
    if (!supabase) return
    const { data } = await supabase
      .from('telegram_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('date', { ascending: false })
      .limit(100)

    if (data) {
      setMessages(data)
    }
  }

  async function triggerSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/cron/telegram-sync')
      const data = await res.json()
      console.log('同步结果:', data)
      // 重新加载数据
      await loadData()
    } catch (error) {
      console.error('同步失败:', error)
    } finally {
      setSyncing(false)
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/auth', { method: 'DELETE' })
    router.push('/admin/login')
    router.refresh()
  }

  const filteredMessages = searchTerm.trim() 
    ? messages.filter(msg => 
        msg.text?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        msg.sender_name?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : messages

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // 渲染带链接的消息文本
  const renderMessageText = (msg: Message) => {
    const text = msg.text || ''
    const entities = msg.raw?.entities || []
    
    // 过滤出需要特殊处理的实体（链接 + 标签）
    const specialEntities = entities.filter(e => 
      e.type === 'MessageEntityTextUrl' || 
      e.type === 'MessageEntityUrl' ||
      e.type === 'MessageEntityHashtag'
    ).sort((a, b) => a.offset - b.offset)
    
    if (specialEntities.length === 0) {
      return <span className="whitespace-pre-wrap">{text}</span>
    }
    
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    
    specialEntities.forEach((entity, i) => {
      // 添加实体前的文本
      if (entity.offset > lastIndex) {
        parts.push(
          <span key={`text-${i}`} className="whitespace-pre-wrap">
            {text.substring(lastIndex, entity.offset)}
          </span>
        )
      }
      
      const entityText = text.substring(entity.offset, entity.offset + entity.length)
      
      if (entity.type === 'MessageEntityHashtag') {
        // 标签 - 链接到同花顺搜索
        const stockName = entityText.replace('#', '')
        const searchUrl = `https://www.iwencai.com/unifiedwap/result?w=${encodeURIComponent(stockName)}`
        parts.push(
          <a 
            key={`tag-${i}`}
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-600 hover:text-orange-800 font-medium"
          >
            {entityText}
          </a>
        )
      } else {
        // 普通链接
        const url = entity.url || entityText
        parts.push(
          <a 
            key={`link-${i}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline"
          >
            {entityText}
          </a>
        )
      }
      
      lastIndex = entity.offset + entity.length
    })
    
    // 添加最后一部分文本
    if (lastIndex < text.length) {
      parts.push(
        <span key="text-last" className="whitespace-pre-wrap">
          {text.substring(lastIndex)}
        </span>
      )
    }
    
    return <>{parts}</>
  }

  // 渲染按钮链接
  const renderButtons = (msg: Message) => {
    const buttons = msg.raw?.buttons || []
    if (buttons.length === 0) return null
    
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        {buttons.map((btn, i) => (
          <a
            key={i}
            href={btn.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm rounded-full transition"
          >
            {btn.text}
            <svg className="w-3 h-3 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ))}
      </div>
    )
  }

  // 渲染媒体（图片）
  const renderMedia = (msg: Message) => {
    const mediaData = msg.raw?.mediaData
    if (!mediaData) return null
    
    return (
      <div className="mt-3">
        <img 
          src={mediaData} 
          alt="消息图片"
          className="max-w-full max-h-96 rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition"
          onClick={() => window.open(mediaData, '_blank')}
        />
      </div>
    )
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'channel': return '📢'
      case 'supergroup': return '👥'
      case 'group': return '💬'
      default: return '📱'
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    )
  }

  // 未配置 Supabase 时显示设置指南
  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="max-w-2xl w-full">
          <div className="card p-8">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 mb-4">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">配置 Telegram Sync</h1>
              <p className="text-gray-500 mt-2">请完成以下配置步骤</p>
            </div>

            <div className="space-y-6">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <h3 className="font-semibold text-amber-800 mb-2">⚠️ 需要配置环境变量</h3>
                <p className="text-amber-700 text-sm">请在 <code className="bg-amber-100 px-1 rounded">.env.local</code> 文件中配置以下内容：</p>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">1️⃣ Supabase 配置</h4>
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
{`NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-2">2️⃣ Telegram API 配置</h4>
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
{`TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your-api-hash
TELEGRAM_SESSION=your-session-string`}
                  </pre>
                  <p className="text-gray-500 text-sm mt-2">
                    从 <a href="https://my.telegram.org/apps" target="_blank" className="text-blue-500 hover:underline">my.telegram.org/apps</a> 获取 API ID 和 Hash
                  </p>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-2">3️⃣ 生成 Telegram Session</h4>
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
{`npx tsx scripts/generate-session.ts`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-2">4️⃣ 初始化数据库</h4>
                  <p className="text-gray-600 text-sm">在 Supabase SQL Editor 中执行 <code className="bg-gray-100 px-1 rounded">supabase/schema.sql</code></p>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <button 
                  onClick={() => window.location.reload()} 
                  className="btn btn-primary w-full"
                >
                  配置完成，刷新页面
                </button>
              </div>
            </div>
          </div>

          <div className="text-center mt-4">
            <button onClick={handleLogout} className="text-gray-500 hover:text-gray-700 text-sm">
              退出登录
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Telegram Sync</h1>
                <p className="text-xs text-gray-500">消息同步仪表盘</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={triggerSync}
                disabled={syncing}
                className="btn btn-primary"
              >
                {syncing ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    同步中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    立即同步
                  </>
                )}
              </button>
              <button onClick={handleLogout} className="btn btn-secondary">
                退出
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-500">群组/频道</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalChats}</p>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-500">消息总数</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalMessages.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-500">上次同步</p>
                <p className="text-lg font-semibold text-gray-900">
                  {stats.lastSync ? formatDate(stats.lastSync) : '从未'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chat List */}
          <div className="lg:col-span-1">
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">群组/频道列表</h2>
              </div>
              <div className="max-h-[600px] overflow-y-auto">
                {chats.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <p>暂无数据</p>
                    <p className="text-sm mt-2">点击"立即同步"开始</p>
                  </div>
                ) : (
                  chats.map(chat => (
                    <button
                      key={chat.chat_id}
                      onClick={() => setSelectedChat(chat.chat_id)}
                      className={`w-full text-left p-4 border-b border-gray-50 hover:bg-gray-50 transition ${
                        selectedChat === chat.chat_id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xl">{getTypeIcon(chat.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{chat.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="badge badge-info text-xs">{chat.type}</span>
                            {chat.member_count && (
                              <span className="text-xs text-gray-400">{chat.member_count} 成员</span>
                            )}
                          </div>
                          {chat.last_synced_at && (
                            <p className="text-xs text-gray-400 mt-1">
                              最后同步: {formatDate(chat.last_synced_at)}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="lg:col-span-2">
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">
                  {selectedChat ? '消息列表' : '请选择一个群组/频道'}
                </h2>
                {selectedChat && (
                  <input
                    type="text"
                    placeholder="搜索消息..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="input w-64"
                  />
                )}
              </div>
              <div className="max-h-[600px] overflow-y-auto">
                {!selectedChat ? (
                  <div className="p-16 text-center text-gray-400">
                    <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p>从左侧选择一个群组/频道查看消息</p>
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <p>暂无消息</p>
                  </div>
                ) : (
                  filteredMessages.map(msg => (
                    <div key={`${msg.chat_id}-${msg.message_id}`} className="message-card">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                          {msg.sender_name?.[0] || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900 text-sm">
                              {msg.sender_name || '未知用户'}
                            </span>
                            <span className="text-xs text-gray-400">
                              {formatDate(msg.date)}
                            </span>
                            {msg.has_media && (
                              <span className="badge badge-warning text-xs">📎 媒体</span>
                            )}
                          </div>
                          <div className="text-gray-700 text-sm break-words">
                            {msg.text ? renderMessageText(msg) : '(无文本内容)'}
                          </div>
                          {renderButtons(msg)}
                          {renderMedia(msg)}
                          {msg.views && msg.views > 0 && (
                            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                              <span>👁 {msg.views.toLocaleString()}</span>
                              {msg.forwards && msg.forwards > 0 && (
                                <span>↗ {msg.forwards.toLocaleString()}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Recent Sync Runs */}
        <div className="mt-8">
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">最近同步记录</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">群组数</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">消息数</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">错误</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {syncRuns.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        暂无同步记录
                      </td>
                    </tr>
                  ) : (
                    syncRuns.map(run => (
                      <tr key={run.id}>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {formatDate(run.started_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge ${
                            run.status === 'success' ? 'badge-success' :
                            run.status === 'failed' ? 'badge-error' :
                            'badge-warning'
                          }`}>
                            {run.status === 'success' ? '成功' :
                             run.status === 'failed' ? '失败' : '运行中'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{run.chats_synced}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{run.messages_synced}</td>
                        <td className="px-4 py-3 text-sm text-red-500 truncate max-w-xs">
                          {run.error_message || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

