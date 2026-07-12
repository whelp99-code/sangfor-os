export type NotificationChannel = 'email' | 'slack' | 'in_app'
export type NotificationEventType = 
  | 'approval_required' | 'approval_completed' 
  | 'renewal_reminder' | 'vendor_request_update'
  | 'poc_completed' | 'sla_breach'
  | 'review_required' | 'handoff_received'

export interface NotificationPayload {
  eventType: NotificationEventType
  title: string
  message: string
  recipientId: string
  channel: NotificationChannel
  link?: string
  metadata?: Record<string, unknown>
}

export class NotificationService {
  // In-memory notification store (would use DB in production)
  private notifications: NotificationPayload[] = []
  
  async send(payload: NotificationPayload): Promise<void> {
    this.notifications.push(payload)
    
    switch (payload.channel) {
      case 'email':
        await this.sendEmail(payload)
        break
      case 'slack':
        await this.sendSlack(payload)
        break
      case 'in_app':
        // Stored in memory, returned via API
        break
    }
  }
  
  private async sendEmail(payload: NotificationPayload): Promise<void> {
    // Log email sending (would use SendGrid/SES in production)
    console.log(`[Email] To: ${payload.recipientId}, Subject: ${payload.title}`)
  }
  
  private async sendSlack(payload: NotificationPayload): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL
    if (!webhookUrl) {
      console.log('[Slack] No webhook URL configured')
      return
    }
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `*${payload.title}*\n${payload.message}` })
      })
    } catch (err) {
      console.error('[Slack] Failed to send:', err)
    }
  }
  
  getNotifications(forRecipient?: string): NotificationPayload[] {
    if (forRecipient) return this.notifications.filter(n => n.recipientId === forRecipient)
    return [...this.notifications]
  }
  
  clear() {
    this.notifications = []
  }
}
