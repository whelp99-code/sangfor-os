/**
 * Delegated (auth-code) OAuth against Microsoft Graph for a personal or work
 * Outlook mailbox. Tokens are persisted on the single `outlook` MailAccount row
 * so the connection survives restarts and refreshes automatically.
 *
 * App-only (client_credentials) sync still lives in
 * `@sangfor/business` OutlookSyncService; this module is the delegated path used
 * when a user clicks "Connect Outlook".
 */
import { prisma } from "@sangfor/db";

const AUTH_HOST = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";

// Personal Microsoft accounts (outlook.com) require the `common` (or `consumers`)
// authority. `common` also covers work/school accounts.
export function getOutlookOAuthConfig() {
  const clientId = process.env.OUTLOOK_CLIENT_ID || process.env.AZURE_CLIENT_ID || "";
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || "";
  const tenantId = process.env.OUTLOOK_TENANT_ID || process.env.AZURE_TENANT_ID || "common";
  const redirectUri =
    process.env.OUTLOOK_REDIRECT_URI || "http://localhost:3101/api/mail/oauth/callback";
  return { clientId, clientSecret, tenantId, redirectUri };
}

export const OUTLOOK_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/User.Read",
];

export function isOutlookOAuthConfigured(): boolean {
  const { clientId, clientSecret } = getOutlookOAuthConfig();
  return Boolean(clientId && clientSecret);
}

export function buildAuthorizationUrl(state: string): string {
  const { clientId, tenantId, redirectUri } = getOutlookOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: OUTLOOK_SCOPES.join(" "),
    state,
  });
  return `${AUTH_HOST}/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface RawToken {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

async function tokenRequest(body: Record<string, string>): Promise<RawToken> {
  const { tenantId } = getOutlookOAuthConfig();
  const res = await fetch(`${AUTH_HOST}/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`Microsoft token endpoint ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as RawToken;
}

export async function exchangeCodeForToken(code: string): Promise<RawToken> {
  const { clientId, clientSecret, redirectUri } = getOutlookOAuthConfig();
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: OUTLOOK_SCOPES.join(" "),
  });
}

async function refreshAccessToken(refreshToken: string): Promise<RawToken> {
  const { clientId, clientSecret } = getOutlookOAuthConfig();
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: OUTLOOK_SCOPES.join(" "),
  });
}

type MailAccountRow = Awaited<ReturnType<typeof prisma.mailAccount.findFirst>>;

/** Returns a valid access token, refreshing + persisting when within 5 min of expiry. */
async function getValidAccessToken(account: NonNullable<MailAccountRow>): Promise<string> {
  if (!account.refreshToken) {
    throw new Error("Mail account is not OAuth-connected");
  }
  const expiresSoon =
    !account.tokenExpiresAt || account.tokenExpiresAt.getTime() - 5 * 60 * 1000 < Date.now();
  if (account.accessToken && !expiresSoon) {
    return account.accessToken;
  }
  const t = await refreshAccessToken(account.refreshToken);
  await prisma.mailAccount.update({
    where: { id: account.id },
    data: {
      accessToken: t.access_token,
      refreshToken: t.refresh_token || account.refreshToken,
      tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
      tokenScope: t.scope ?? account.tokenScope,
    },
  });
  return t.access_token;
}

async function fetchGraphMe(
  accessToken: string,
): Promise<{ mail?: string; userPrincipalName?: string; displayName?: string }> {
  const res = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Graph /me ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Persist freshly issued tokens onto the single `outlook` MailAccount (created if absent). */
export async function connectOutlookAccount(tokens: RawToken): Promise<{ id: string; email: string }> {
  const me = await fetchGraphMe(tokens.access_token);
  const email = me.mail || me.userPrincipalName || "outlook-user";
  const { tenantId } = getOutlookOAuthConfig();
  const data = {
    email,
    status: "connected",
    tenantId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    tokenScope: tokens.scope ?? null,
  };
  const existing = await prisma.mailAccount.findFirst({ where: { provider: "outlook" } });
  if (existing) {
    const updated = await prisma.mailAccount.update({ where: { id: existing.id }, data });
    return { id: updated.id, email: updated.email };
  }
  const project = await prisma.project.findFirst();
  const created = await prisma.mailAccount.create({
    data: { projectId: project?.id || "default", provider: "outlook", ...data },
  });
  return { id: created.id, email: created.email };
}

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  conversationId?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
}

const GRAPH_PAGE_SIZE = 100;
const DEFAULT_MAX_MESSAGES = 5000;

/**
 * Strip characters that break Postgres jsonb / Prisma JSON serialization:
 * C0 control chars (incl. null bytes) and unpaired UTF-16 surrogates. Real email
 * subjects/bodies contain both, which otherwise crash the learning pipeline.
 */
export function sanitizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

// Page through an entire mail folder via @odata.nextLink (Inbox or Sent Items).
async function fetchFolderMessages(
  token: string,
  folder: "inbox" | "sentitems",
  maxMessages: number,
): Promise<GraphMessage[]> {
  const select = "id,subject,from,toRecipients,bodyPreview,receivedDateTime,conversationId";
  let url: string | null = `${GRAPH}/me/mailFolders/${folder}/messages?$top=${GRAPH_PAGE_SIZE}&$select=${select}&$orderby=receivedDateTime desc`;
  const out: GraphMessage[] = [];
  while (url && out.length < maxMessages) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Graph ${folder} ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { value?: GraphMessage[]; "@odata.nextLink"?: string };
    out.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return out.slice(0, maxMessages);
}

/**
 * Pull the full mailbox — every Inbox (received) and Sent Items (sent) message —
 * and upsert by Graph message id. Sent + received are tagged with `direction`
 * and share a `conversationId` so they can be learned as one thread.
 */
export async function syncDelegatedOutlook(
  opts: { maxMessages?: number } = {},
): Promise<{ synced: number; inbox: number; sent: number; account?: string }> {
  const maxMessages = opts.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const account = await prisma.mailAccount.findFirst({
    where: { provider: "outlook", refreshToken: { not: null } },
  });
  if (!account) return { synced: 0, inbox: 0, sent: 0 };

  const token = await getValidAccessToken(account);
  // Drop legacy rows captured before external-id dedup existed.
  await prisma.mailMessage.deleteMany({ where: { accountId: account.id, externalId: null } });

  const inbox = await fetchFolderMessages(token, "inbox", maxMessages);
  const sent = await fetchFolderMessages(token, "sentitems", maxMessages);
  const items: Array<{ msg: GraphMessage; direction: "inbound" | "outbound" }> = [
    ...inbox.map((msg) => ({ msg, direction: "inbound" as const })),
    ...sent.map((msg) => ({ msg, direction: "outbound" as const })),
  ];

  let synced = 0;
  for (const { msg, direction } of items) {
    const fromEmail = sanitizeText(msg.from?.emailAddress?.address) || "unknown";
    const toEmail = sanitizeText(msg.toRecipients?.[0]?.emailAddress?.address) || null;
    const conversationId = msg.conversationId || msg.id;
    const base = {
      accountId: account.id,
      subject: sanitizeText(msg.subject) || "(no subject)",
      fromEmail,
      toEmail,
      bodyPreview: sanitizeText(msg.bodyPreview),
      conversationId,
      direction,
      receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
      groupKey: conversationId,
    };
    await prisma.mailMessage.upsert({
      where: { externalId: msg.id },
      create: { externalId: msg.id, ...base },
      update: base,
    });
    synced++;
  }
  await prisma.mailAccount.update({ where: { id: account.id }, data: { lastSyncedAt: new Date() } });
  return { synced, inbox: inbox.length, sent: sent.length, account: account.email };
}

export async function getDelegatedConnection(): Promise<{
  connected: boolean;
  email?: string;
  lastSyncedAt?: Date | null;
}> {
  const account = await prisma.mailAccount.findFirst({ where: { provider: "outlook" } });
  if (account?.refreshToken) {
    return { connected: true, email: account.email, lastSyncedAt: account.lastSyncedAt };
  }
  return { connected: false };
}

interface GraphCalendarEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  organizer?: { emailAddress?: { address?: string; name?: string } };
  attendees?: Array<{ emailAddress?: { address?: string; name?: string } }>;
}

function domainOfEmail(email?: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1]?.toLowerCase() ?? null;
}

/**
 * P7 #5: collect Outlook calendar events (`/me/calendarView`) as MeetingNotes.
 *
 * Scoped mode (`opportunityId`) attaches every event in the window to that deal.
 * Global mode matches each event to an opportunity by attendee/organizer email
 * domain → Customer.domain → that customer's most recent opportunity. Calendar
 * events are real meetings, so they are stored `status="confirmed"`. Idempotent:
 * an existing (opportunityId, source=calendar, title, occurredAt) note is skipped.
 */
export async function syncCalendarMeetings(
  opts: { opportunityId?: string; daysBack?: number; daysAhead?: number } = {},
): Promise<{ fetched: number; created: number; matched: number }> {
  const account = await prisma.mailAccount.findFirst({
    where: { provider: "outlook", refreshToken: { not: null } },
  });
  if (!account) return { fetched: 0, created: 0, matched: 0 };
  if (account.tokenScope && !account.tokenScope.includes("Calendars.Read")) {
    throw new Error("Connected mailbox is missing the Calendars.Read scope — reconnect Outlook.");
  }

  const token = await getValidAccessToken(account);
  const start = new Date(Date.now() - (opts.daysBack ?? 120) * 86400000).toISOString();
  const end = new Date(Date.now() + (opts.daysAhead ?? 30) * 86400000).toISOString();
  const url =
    `${GRAPH}/me/calendarView?startDateTime=${start}&endDateTime=${end}` +
    `&$top=100&$orderby=start/dateTime desc` +
    `&$select=id,subject,bodyPreview,start,end,organizer,attendees`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!res.ok) {
    throw new Error(`Graph /me/calendarView ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { value?: GraphCalendarEvent[] };
  const events = data.value ?? [];

  let created = 0;
  let matched = 0;
  for (const ev of events) {
    const occurredAt = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
    const title = sanitizeText(ev.subject) || "(no subject)";
    const attendeeEmails = [
      ev.organizer?.emailAddress?.address,
      ...(ev.attendees ?? []).map((a) => a.emailAddress?.address),
    ].filter((e): e is string => Boolean(e));

    let opportunityId = opts.opportunityId ?? null;
    if (!opportunityId) {
      const domains = Array.from(new Set(attendeeEmails.map(domainOfEmail).filter((d): d is string => Boolean(d))));
      for (const domain of domains) {
        const customer = await prisma.customer.findFirst({
          where: { domain },
          select: { opportunities: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
        });
        const oppId = customer?.opportunities[0]?.id;
        if (oppId) {
          opportunityId = oppId;
          break;
        }
      }
    }
    if (!opportunityId) continue;
    matched++;

    const exists = await prisma.meetingNote.findFirst({
      where: { opportunityId, source: "calendar", title, occurredAt },
      select: { id: true },
    });
    if (exists) continue;

    await prisma.meetingNote.create({
      data: {
        opportunityId,
        title,
        occurredAt,
        attendees: attendeeEmails.map((e) => sanitizeText(e)),
        bodyMarkdown: sanitizeText(ev.bodyPreview) || title,
        source: "calendar",
        status: "confirmed",
      },
    });
    created++;
  }

  return { fetched: events.length, created, matched };
}
