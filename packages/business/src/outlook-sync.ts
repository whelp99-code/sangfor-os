import { prisma } from '@sangfor/db'

export interface OutlookConfig {
  clientId: string
  clientSecret: string
  tenantId: string
}

export class OutlookSyncService {
  private config: OutlookConfig | null = null
  private accessToken: string | null = null

  constructor() {
    this.config = this.loadConfig()
  }

  isConfigured(): boolean {
    return !!this.config?.clientId && !!this.config?.clientSecret && !!this.config?.tenantId
  }

  private loadConfig(): OutlookConfig | null {
    const clientId = process.env.OUTLOOK_CLIENT_ID || process.env.AZURE_CLIENT_ID
    const clientSecret = process.env.OUTLOOK_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET
    const tenantId = process.env.OUTLOOK_TENANT_ID || process.env.AZURE_TENANT_ID
    if (!clientId || !clientSecret || !tenantId) return null
    return { clientId, clientSecret, tenantId }
  }

  async getAccessToken(): Promise<string | null> {
    if (this.accessToken) return this.accessToken
    if (!this.config) return null
    try {
      const res = await fetch(`https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      })
      const data = await res.json() as { access_token?: string; expires_in?: number }
      this.accessToken = data.access_token ?? null
      if (data.access_token && data.expires_in) {
        setTimeout(() => { this.accessToken = null }, (data.expires_in - 300) * 1000)
      }
      return this.accessToken
    } catch {
      return null
    }
  }

  async fetchMessages(top: number = 50): Promise<any[]> {
    const token = await this.getAccessToken()
    if (!token) return []
    try {
      const res = await fetch(`https://graph.microsoft.com/v1.0/me/messages?$top=${top}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,importance,isRead,hasAttachments`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json() as { value?: any[] }
      return data.value || []
    } catch {
      return []
    }
  }

  async syncToDatabase(): Promise<{ synced: number }> {
    const token = await this.getAccessToken()
    if (!token) return { synced: 0 }

    const messages = await this.fetchMessages()
    if (messages.length === 0) return { synced: 0 }

    let account = await prisma.mailAccount.findFirst({ where: { provider: 'outlook' } })
    if (!account) {
      const project = await prisma.project.findFirst()
      account = await prisma.mailAccount.create({
        data: {
          projectId: project?.id || 'default',
          provider: 'outlook',
          email: 'outlook@office365.com',
          status: 'connected',
        },
      })
    }

    let synced = 0
    for (const msg of messages) {
      const existing = await prisma.mailMessage.findFirst({ where: { subject: msg.subject, fromEmail: msg.from?.emailAddress?.address } })
      if (!existing) {
        await prisma.mailMessage.create({
          data: {
            accountId: account.id,
            subject: msg.subject || '(no subject)',
            fromEmail: msg.from?.emailAddress?.address || 'unknown',
            bodyPreview: msg.bodyPreview || msg.body?.content?.substring(0, 200) || '',
            groupKey: msg.from?.emailAddress?.address?.split('@')[1] || 'general',
          },
        })
        synced++
      }
    }

    return { synced }
  }

  async getStatus(): Promise<{
    configured: boolean
    connected: boolean
    hasMailPermission: boolean
    hasUserPermission: boolean
    error?: string
    accountCount: number
    messageCount: number
  }> {
    const configured = this.isConfigured()
    const token = await this.getAccessToken()
    const connected = !!token

    let hasMailPermission = false
    let hasUserPermission = false
    let error: string | undefined

    if (token) {
      // Test delegated mail access
      const meTest = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=1', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const meData: any = await meTest.json()
      if (meData.value) {
        hasMailPermission = true
        hasUserPermission = true
      } else {
        const msg = meData.error?.message || ''
        if (msg.includes('delegated')) {
          error = 'App-only mode: /me requires delegated auth. Trying users/{id}/messages...'
          // Try app-only user mail access
          const usersRes = await fetch('https://graph.microsoft.com/v1.0/users?$top=1&$select=id', {
            headers: { Authorization: `Bearer ${token}` },
          })
          const usersData: any = await usersRes.json()
          if (usersData.value?.[0]) {
            hasUserPermission = true
            const userId = usersData.value[0].id
            const mailRes = await fetch(`https://graph.microsoft.com/v1.0/users/${userId}/messages?$top=1`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            hasMailPermission = mailRes.ok
            if (!hasMailPermission) {
              error = 'App registered but missing Mail.Read + User.Read.All API permissions. Grant admin consent in Azure Portal.'
            }
          } else {
            error = 'App registered but missing User.Read.All permission. Grant admin consent in Azure Portal.'
          }
        } else if (msg.includes('Insufficient privileges')) {
          error = 'App registered but missing required API permissions. Grant admin consent in Azure Portal.'
        } else {
          error = msg
        }
      }
    }

    const accountCount = await prisma.mailAccount.count()
    const messageCount = await prisma.mailMessage.count()
    return { configured, connected, hasMailPermission, hasUserPermission, error, accountCount, messageCount }
  }
}
