/**
 * Minimal Outlook webhook leaf handler (U007).
 * Network-free: validates clientState/resourceData and awaits handler in order.
 */

export type OutlookMailResource = {
  id?: string;
  [key: string]: unknown;
};

export type OutlookNotification = {
  clientState?: unknown;
  resourceData?: OutlookMailResource | null;
  [key: string]: unknown;
};

export type OutlookNotificationBody = {
  value?: OutlookNotification[];
  [key: string]: unknown;
};

export class OutlookWebhookHandler {
  readonly clientState: string;
  readonly handler: (mail: OutlookMailResource) => Promise<void>;

  constructor(
    clientState: string,
    handler: (mail: OutlookMailResource) => Promise<void>,
  ) {
    if (typeof clientState !== "string" || clientState.length === 0) {
      throw new TypeError("OutlookWebhookHandler: clientState must be nonempty string");
    }
    if (typeof handler !== "function") {
      throw new TypeError("OutlookWebhookHandler: handler must be async function");
    }
    this.clientState = clientState;
    this.handler = handler;
  }

  /**
   * Validate the full notification array first. If any item is mismatched or
   * malformed, reject with zero handler callbacks. Valid mails are awaited
   * exactly once each in input order; handler failures propagate.
   */
  async handleNotification(body: OutlookNotificationBody): Promise<void> {
    const notifications = Array.isArray(body?.value) ? body.value : null;
    if (!notifications || notifications.length === 0) {
      return;
    }

    /** @type {OutlookMailResource[]} */
    const mails: OutlookMailResource[] = [];
    for (const item of notifications) {
      if (!item || typeof item !== "object") {
        return; // malformed → callback 0
      }
      if (item.clientState !== this.clientState) {
        return; // mismatched → callback 0
      }
      const rd = item.resourceData;
      if (!rd || typeof rd !== "object" || Array.isArray(rd)) {
        return; // malformed resourceData → callback 0
      }
      mails.push(rd);
    }

    for (const mail of mails) {
      await this.handler(mail);
    }
  }
}
