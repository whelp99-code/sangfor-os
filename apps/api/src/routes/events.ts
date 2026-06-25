import { Router } from "express";
import { getTokenManager } from "@sangfor/auth";

interface SSEConn {
  writeHead(statusCode: number, headers: Record<string, string>): void
  write(chunk: string): void
}

interface ClientInfo {
  id: string
  conn: SSEConn
  ip: string
}

class EventBus {
  private clients: Map<string, ClientInfo> = new Map()
  private ipConnectionCount: Map<string, number> = new Map()
  private maxConnPerIp = 5

  addClient(id: string, conn: SSEConn, ip: string): { success: boolean; reason?: string } {
    const current = this.ipConnectionCount.get(ip) ?? 0
    if (current >= this.maxConnPerIp) {
      return { success: false, reason: "Max SSE connections per IP reached" }
    }

    try {
      conn.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      conn.write(`data: ${JSON.stringify({ type: 'connected', clientId: id })}\n\n`)
    } catch {
      return { success: false, reason: "Failed to initiate SSE connection" }
    }

    this.clients.set(id, { id, conn, ip })
    this.ipConnectionCount.set(ip, current + 1)
    return { success: true }
  }

  removeClient(id: string): void {
    const client = this.clients.get(id)
    if (client) {
      const current = this.ipConnectionCount.get(client.ip) ?? 1
      if (current <= 1) {
        this.ipConnectionCount.delete(client.ip)
      } else {
        this.ipConnectionCount.set(client.ip, current - 1)
      }
    }
    this.clients.delete(id)
  }

  broadcast(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const [id, client] of this.clients) {
      try {
        client.conn.write(message)
      } catch {
        this.removeClient(id)
      }
    }
  }

  getClientCount(): number {
    return this.clients.size
  }
}

export const eventBus = new EventBus()

async function authenticateRequest(token: string | undefined): Promise<{ id: string; role: string } | null> {
  if (!token) return null
  try {
    const payload = await getTokenManager().verifyToken(token)
    if (!payload) return null
    return { id: payload.sub, role: (payload as { role?: string }).role ?? "USER" }
  } catch {
    return null
  }
}

export function createEventRoutes(): Router {
  const router = Router();

  router.get("/events/stream", async (req, res) => {
    const token = (req.query.token as string) || req.headers.authorization?.slice(7)
    const user = await authenticateRequest(token)

    if (!user) {
      res.status(401).json({ error: "Authentication required. Provide Bearer token or ?token= parameter." })
      return
    }

    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const ip = req.ip || req.socket.remoteAddress || "unknown"

    const result = eventBus.addClient(clientId, res, ip)
    if (!result.success) {
      res.status(429).json({ error: result.reason })
      return
    }

    const heartbeat = setInterval(() => {
      try {
        res.write(`:heartbeat\n\n`)
      } catch {
        clearInterval(heartbeat)
        eventBus.removeClient(clientId)
      }
    }, 15000)

    req.on("close", () => {
      clearInterval(heartbeat)
      eventBus.removeClient(clientId)
    })
  })

  router.post("/events/emit", async (req, res) => {
    const token = req.headers.authorization?.slice(7)
    const user = await authenticateRequest(token)

    if (!user) {
      res.status(401).json({ error: "Authentication required" })
      return
    }

    if (user.role !== "ADMIN") {
      res.status(403).json({ error: "Admin role required to emit events" })
      return
    }

    const { event, data } = req.body
    if (!event) {
      res.status(400).json({ error: "event is required" })
      return
    }

    eventBus.broadcast(event, data ?? {})
    res.json({ success: true, clientCount: eventBus.getClientCount() })
  })

  return router;
}
