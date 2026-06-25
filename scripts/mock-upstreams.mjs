#!/usr/bin/env node
/**
 * AIOSv2 Upstream Mock Servers
 * Starts lightweight HTTP servers that mock external upstream services
 * for development and testing.
 */

import http from 'http'

const MOCKS = [
  { name: 'AIOS v1', port: 3101, response: { status: 'ok', service: 'aios-v1' } },
  { name: 'F-AIOS-v3', port: 3201, response: { status: 'ok', service: 'f-aios-v3' } },
  { name: 'Sangfor MCP', port: 3500, response: { status: 'ok', service: 'sangfor-mcp' } },
  { name: 'Vibe Coding OS', port: 4000, response: { status: 'ok', service: 'vibe-coding-os' } },
  { name: 'Mail Intelligence', port: 3010, response: { status: 'ok', service: 'mail-intelligence' } },
  { name: 'whelp99 MCP', port: 3600, response: { status: 'ok', tools: [] } },
  { name: 'CFO AIOS', port: 4100, response: { status: 'ok', service: 'cfo-aios' } },
]

const servers = MOCKS.map(mock => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(mock.response))
  })
  server.listen(mock.port, () => {
    console.log(`🟢 ${mock.name} mock on :${mock.port}`)
  })
  server.on('error', (err) => {
    console.log(`🔴 ${mock.name} mock on :${mock.port} — ${err.message}`)
  })
  return server
})

process.on('SIGINT', () => {
  console.log('\nShutting down all mock servers...')
  servers.forEach(s => s.close())
  process.exit(0)
})

console.log(`🚀 Starting ${MOCKS.length} upstream mock servers...`)
