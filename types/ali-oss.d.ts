declare module 'ali-oss' {
  interface OSSOptions {
    region?: string
    accessKeyId: string
    accessKeySecret: string
    bucket?: string
    endpoint?: string
    secure?: boolean
  }

  interface PutResult {
    name: string
    url: string
    res: {
      status: number
      statusCode: number
      headers: Record<string, string>
    }
  }

  class OSS {
    constructor(options: OSSOptions)
    put(name: string, file: Buffer | string, options?: { headers?: Record<string, string> }): Promise<PutResult>
    get(name: string): Promise<{ content: Buffer; res: unknown }>
    delete(name: string): Promise<unknown>
    list(query?: { prefix?: string; marker?: string; 'max-keys'?: number }): Promise<{
      objects: Array<{ name: string; url: string; lastModified: string; etag: string; size: number }>
      prefixes: string[]
      isTruncated: boolean
      nextMarker: string
    }>
  }

  export = OSS
}

