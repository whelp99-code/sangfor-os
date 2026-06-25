export class MetricsRegistry {
  private counters = new Map<string, number>()
  private gauges = new Map<string, number>()
  private histograms = new Map<string, number[]>()

  private labelKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return name
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",")
    return `${name}{${labelStr}}`
  }

  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = this.labelKey(name, labels)
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1)
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value)
  }

  observeHistogram(name: string, value: number): void {
    const bucket = this.histograms.get(name) ?? []
    bucket.push(value)
    this.histograms.set(name, bucket)
  }

  getMetrics(): string {
    const lines: string[] = []

    for (const [key, value] of this.counters) {
      const name = key.includes("{") ? key.split("{")[0] : key
      lines.push(`# HELP ${name} Counter metric`)
      lines.push(`# TYPE ${name} counter`)
      lines.push(`${key} ${value}`)
    }

    for (const [key, value] of this.gauges) {
      lines.push(`# HELP ${key} Gauge metric`)
      lines.push(`# TYPE ${key} gauge`)
      lines.push(`${key} ${value}`)
    }

    for (const [name, values] of this.histograms) {
      lines.push(`# HELP ${name} Histogram metric`)
      lines.push(`# TYPE ${name} histogram`)
      const sorted = [...values].sort((a, b) => a - b)
      const count = sorted.length
      const sum = sorted.reduce((a, b) => a + b, 0)
      lines.push(`${name}_count ${count}`)
      lines.push(`${name}_sum ${sum}`)
      if (count > 0) {
        const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
        let cumulative: number
        for (const b of buckets) {
          cumulative = sorted.filter((v) => v <= b).length
          lines.push(`${name}_bucket{le="${b}"} ${cumulative}`)
        }
        lines.push(`${name}_bucket{le="+Inf"} ${count}`)
      }
    }

    return lines.join("\n") + "\n"
  }

  reset(): void {
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
  }
}

export const metrics = new MetricsRegistry()
