export interface FormatOptions {
  nullValue?: string
  tabularPad?: number
}

export function formatKRW(amount: number | null, options: FormatOptions = {}): string {
  if (amount === null || amount === undefined) return options.nullValue ?? ''
  const formatted = new Intl.NumberFormat('ko-KR').format(Math.round(amount))
  const withWon = `${formatted}원`
  if (options.tabularPad) {
    return withWon.padStart(options.tabularPad)
  }
  return withWon
}

export function formatKRWCompact(amount: number | null): string {
  if (amount === null || amount === undefined) return ''
  if (amount >= 100000000) return `${Math.round(amount / 100000000)}억`
  if (amount >= 1000000) return `${Math.round(amount / 1000000)}백만`
  if (amount >= 10000) return `${Math.round(amount / 10000)}만`
  return `${Math.round(amount)}원`
}
