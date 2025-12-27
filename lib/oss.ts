/**
 * 阿里云 OSS 工具 - Telegram 图片存储
 */
import OSS from 'ali-oss'
import crypto from 'crypto'

// OSS 客户端（延迟初始化）
let ossClient: OSS | null = null

/**
 * 检查 OSS 是否已配置
 */
export function isOSSConfigured(): boolean {
  return !!(
    process.env.OSS_ACCESS_KEY_ID &&
    process.env.OSS_ACCESS_KEY_SECRET &&
    process.env.OSS_BUCKET
  )
}

/**
 * 获取 OSS 客户端
 */
function getOSSClient(): OSS {
  if (!ossClient) {
    ossClient = new OSS({
      region: process.env.OSS_REGION || 'oss-cn-beijing',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
      bucket: process.env.OSS_BUCKET!,
    })
  }
  return ossClient
}

/**
 * 上传 Buffer 到 OSS
 * @param buffer 图片 Buffer
 * @param chatId 群组/频道 ID
 * @param messageId 消息 ID
 * @param ext 文件扩展名
 * @returns OSS 图片 URL
 */
export async function uploadBufferToOSS(
  buffer: Buffer,
  chatId: string,
  messageId: number,
  ext: string = 'jpg'
): Promise<string | null> {
  if (!isOSSConfigured()) {
    console.log('  ⚠️ OSS 未配置，跳过图片上传')
    return null
  }

  try {
    // 生成唯一文件名
    const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8)
    const fileName = `telegram/${chatId}/${messageId}_${hash}.${ext}`

    // 确定 Content-Type
    const contentType = ext === 'png' ? 'image/png'
      : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
      : 'image/jpeg'

    // 上传到 OSS
    const client = getOSSClient()
    await client.put(fileName, buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'max-age=31536000', // 缓存一年
      },
    })

    // 返回公网访问 URL
    const region = process.env.OSS_REGION || 'oss-cn-beijing'
    const ossUrl = `https://${process.env.OSS_BUCKET}.${region}.aliyuncs.com/${fileName}`
    return ossUrl

  } catch (error: any) {
    console.log(`  ⚠️ OSS 上传失败: ${error.message}`)
    return null
  }
}

