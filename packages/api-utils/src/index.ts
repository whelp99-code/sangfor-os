export class OutlookWebhookHandler {
  constructor(clientState: string, handler: (mail: any) => Promise<void>) {}
  async handleNotification(body: any): Promise<void> {}
}
