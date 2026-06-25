export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export class StructuredLogger {
  private level: LogLevel = 'info'

  setLevel(level: LogLevel): void {
    this.level = level
  }

  getLevel(): LogLevel {
    return this.level
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.level]
  }

  private log(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
    }
    if (data && Object.keys(data).length > 0) {
      entry.data = data
    }
    const output = JSON.stringify(entry)
    switch (level) {
      case 'error':
        console.error(output)
        break
      case 'warn':
        console.warn(output)
        break
      default:
        console.log(output)
    }
  }

  debug(context: string, message: string, data?: Record<string, unknown>): void {
    this.log('debug', context, message, data)
  }

  info(context: string, message: string, data?: Record<string, unknown>): void {
    this.log('info', context, message, data)
  }

  warn(context: string, message: string, data?: Record<string, unknown>): void {
    this.log('warn', context, message, data)
  }

  error(context: string, message: string, data?: Record<string, unknown>): void {
    this.log('error', context, message, data)
  }
}

export const logger = new StructuredLogger()
