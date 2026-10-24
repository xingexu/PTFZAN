// Real guest messaging. One send() call; the provider is chosen from configuration:
//   twilio    → real SMS (needs an upgraded Twilio account for custom text)
//   ntfy      → real push notification to the ntfy app on one phone (free, no account) — stage fallback
//   simulated → nothing leaves the server; shown on screen only
// Delivery status is tracked (Twilio is polled until delivered/failed) so the stage screen can show it live.
import type { DeliveryRecord, DeliveryStatus, MessagingProvider, MessagingStatus, NotificationKind } from '../../shared/types.js';
import type { MessagingConfig } from './env.js';
import { maskPhone, toSmsText } from './phone.js';

export interface OutboundMessage {
  guestCode: string;
  notificationId?: string;
  kind: NotificationKind | 'test';
  /** E.164 phone number. Required for SMS. */
  to?: string | null;
  title: string;
  body: string;
  clickUrl?: string;
  /** "guest": SMS only (never push a demo guest's text to the presenter's ntfy topic). "stage": SMS, else ntfy. */
  audience: 'guest' | 'stage';
  /** Rehearsal: force simulated delivery even when a provider is configured. */
  simulate?: boolean;
}

const MAX_RECORDS = 300;

const TWILIO_STATUS: Record<string, DeliveryStatus> = {
  accepted: 'queued',
  scheduled: 'queued',
  queued: 'queued',
  sending: 'sending',
  sent: 'sent',
  delivered: 'delivered',
  read: 'delivered',
  undelivered: 'undelivered',
  failed: 'failed',
  canceled: 'failed',
};

const TERMINAL: DeliveryStatus[] = ['delivered', 'undelivered', 'failed', 'simulated'];

/** Plain-language explanations for the Twilio errors a demo is most likely to hit. */
const TWILIO_ERRORS: Record<number, string> = {
  20003: 'Twilio rejected the credentials (check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).',
  21211: 'That phone number is not valid.',
  21408: 'Your Twilio account is not enabled to send to this country (Messaging Geo Permissions).',
  21606: 'TWILIO_FROM is not an SMS-capable number on this Twilio account.',
  21608: 'Trial accounts can only text verified numbers. Verify this number in Twilio or upgrade.',
  21610: 'This number replied STOP and has opted out.',
  21612: 'Twilio cannot route a message between these two numbers.',
  21614: 'The destination is not a mobile number.',
  21659: 'TWILIO_FROM is not a Twilio phone number on this account.',
  30003: 'The phone is unreachable (off or no signal).',
  30005: 'Unknown destination number.',
  30006: 'The destination is a landline or cannot receive SMS.',
  30007: 'The carrier filtered the message as spam.',
  30008: 'The carrier reported an unknown delivery error.',
  30034: 'The sender number is not registered for this traffic (US A2P 10DLC).',
};

function twilioError(json: { code?: number; message?: string; error_code?: number | null; error_message?: string | null }, status?: number) {
  const code = json.code ?? json.error_code ?? undefined;
  const friendly = code ? TWILIO_ERRORS[code] : undefined;
  const raw = json.message ?? json.error_message ?? (status ? `HTTP ${status}` : 'Unknown error');
  return friendly ? `${friendly} (Twilio ${code})` : code ? `${raw} (Twilio ${code})` : raw;
}

const asciiHeader = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').slice(0, 120);

export class Messenger {
  readonly records: DeliveryRecord[] = [];
  private sent: { at: number; guest: string }[] = [];
  private seq = 0;

  constructor(
    private cfg: MessagingConfig,
    private onUpdate: (r: DeliveryRecord) => void = () => undefined,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  get status(): MessagingStatus {
    const t = this.cfg.twilio;
    if (t) {
      return {
        provider: 'twilio',
        smsEnabled: true,
        sender: t.trialTemplate ? 'Twilio trial number' : t.from ? maskPhone(t.from) : 'Twilio Messaging Service',
        trialTemplate: t.trialTemplate ?? null,
        note: t.trialTemplate
          ? `Twilio trial mode: messages use Twilio's "${t.trialTemplate}" template text and only reach verified numbers.`
          : 'Real SMS via Twilio.',
      };
    }
    if (this.cfg.ntfy) {
      return {
        provider: 'ntfy',
        smsEnabled: false,
        sender: 'ntfy push',
        trialTemplate: null,
        note: 'Real push notification to the ntfy app on the presenter’s phone (free, not SMS).',
      };
    }
    return { provider: 'simulated', smsEnabled: false, sender: null, trialTemplate: null, note: 'No messaging credentials configured — messages are simulated and shown on screen only.' };
  }

  /** Which provider a message will actually use. */
  resolve(msg: OutboundMessage): MessagingProvider {
    if (msg.simulate) return 'simulated';
    if (this.cfg.twilio && msg.to) return 'twilio';
    if (msg.audience === 'stage' && this.cfg.ntfy) return 'ntfy';
    return 'simulated';
  }

  /** Queue a message. Returns immediately; status updates arrive through onUpdate. */
  send(msg: OutboundMessage): DeliveryRecord {
    const provider = this.resolve(msg);
    const text = toSmsText(msg.body);
    const now = Date.now();
    const status: DeliveryStatus = provider === 'simulated' ? 'simulated' : 'queued';
    const rec: DeliveryRecord = {
      id: `D-${++this.seq}`,
      guestCode: msg.guestCode,
      notificationId: msg.notificationId,
      kind: msg.kind,
      provider,
      toMasked: provider === 'ntfy' ? 'ntfy app' : msg.to ? maskPhone(msg.to) : 'on-screen only',
      status,
      body: provider === 'twilio' && this.cfg.twilio?.trialTemplate ? `[Twilio template: ${this.cfg.twilio.trialTemplate}]` : text,
      createdAt: now,
      updatedAt: now,
      history: [{ status, at: now }],
    };
    this.records.unshift(rec);
    if (this.records.length > MAX_RECORDS) this.records.pop();

    if (provider === 'simulated') {
      console.log(`[messaging] simulated → ${rec.toMasked}: ${text}`);
      this.onUpdate(rec);
      return rec;
    }

    const limited = this.limitReason(msg.guestCode);
    if (limited) {
      this.update(rec, 'failed', limited);
      return rec;
    }
    this.sent.push({ at: now, guest: msg.guestCode });
    this.onUpdate(rec);

    const job = provider === 'twilio' ? this.sendTwilio(rec, msg.to!, text) : this.sendNtfy(rec, msg, text);
    job.catch((e: unknown) => this.update(rec, 'failed', e instanceof Error ? e.message : String(e)));
    return rec;
  }

  /** Resolves when the record reaches a final status (used by tests). */
  async settle(id: string, timeoutMs = 5000): Promise<DeliveryRecord> {
    const start = Date.now();
    for (;;) {
      const r = this.records.find((x) => x.id === id);
      if (!r) throw new Error('unknown record');
      if (TERMINAL.includes(r.status) || (r.provider === 'ntfy' && r.status === 'sent')) return r;
      if (Date.now() - start > timeoutMs) return r;
      await new Promise((res) => setTimeout(res, 20));
    }
  }

  // ───────────────────────── providers ─────────────────────────
  private async sendTwilio(rec: DeliveryRecord, to: string, text: string) {
    const t = this.cfg.twilio!;
    const base = `${t.apiBase}/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages`;
    const auth = 'Basic ' + Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64');
    const form = new URLSearchParams({ To: to, Body: t.trialTemplate ?? text });
    if (!t.trialTemplate) {
      if (t.messagingServiceSid) form.set('MessagingServiceSid', t.messagingServiceSid);
      else if (t.from) form.set('From', t.from);
    }
    this.update(rec, 'sending');
    const res = await this.fetchImpl(`${base}.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; code?: number; message?: string };
    if (!res.ok) throw new Error(twilioError(json, res.status));
    this.update(rec, TWILIO_STATUS[json.status ?? 'queued'] ?? 'queued');
    if (json.sid) await this.pollTwilio(rec, `${base}/${encodeURIComponent(json.sid)}.json`, auth);
  }

  private async pollTwilio(rec: DeliveryRecord, url: string, auth: string) {
    const deadline = Date.now() + this.cfg.pollTimeoutMs;
    while (Date.now() < deadline && !TERMINAL.includes(rec.status)) {
      await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs));
      try {
        const res = await this.fetchImpl(url, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const j = (await res.json()) as { status?: string; error_code?: number | null; error_message?: string | null };
        const st = TWILIO_STATUS[j.status ?? ''] ?? rec.status;
        const err = st === 'failed' || st === 'undelivered' ? twilioError(j) : undefined;
        this.update(rec, st, err);
      } catch {
        /* transient network error — keep polling */
      }
    }
  }

  private async sendNtfy(rec: DeliveryRecord, msg: OutboundMessage, text: string) {
    const n = this.cfg.ntfy!;
    const headers: Record<string, string> = {
      Title: asciiHeader(msg.title),
      Priority: msg.kind === 'ready' || msg.kind === 'test' ? 'high' : 'default',
      Tags: msg.kind === 'ready' ? 'white_check_mark' : msg.kind === 'test' ? 'bell' : 'hourglass_flowing_sand',
    };
    if (msg.clickUrl) headers.Click = msg.clickUrl;
    this.update(rec, 'sending');
    const res = await this.fetchImpl(`${n.server}/${encodeURIComponent(n.topic)}`, {
      method: 'POST',
      headers,
      body: text,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`ntfy rejected the message (HTTP ${res.status})`);
    this.update(rec, 'sent');
  }

  // ───────────────────────── helpers ─────────────────────────
  private limitReason(guest: string): string | null {
    const hourAgo = Date.now() - 3600_000;
    this.sent = this.sent.filter((s) => s.at > hourAgo);
    if (this.sent.length >= this.cfg.maxPerHour) return `Hourly limit of ${this.cfg.maxPerHour} messages reached (protects your SMS credit).`;
    if (this.sent.filter((s) => s.guest === guest).length >= this.cfg.maxPerGuestPerHour)
      return `Limit of ${this.cfg.maxPerGuestPerHour} messages per guest per hour reached.`;
    return null;
  }

  private update(rec: DeliveryRecord, status: DeliveryStatus, error?: string) {
    const now = Date.now();
    if (rec.status === status && rec.error === error) return;
    // Never move backwards (e.g. a late "sent" poll after "delivered").
    const order: DeliveryStatus[] = ['queued', 'sending', 'sent', 'delivered'];
    if (order.includes(status) && order.includes(rec.status) && order.indexOf(status) < order.indexOf(rec.status)) return;
    rec.status = status;
    if (error) rec.error = error;
    rec.updatedAt = now;
    rec.history.push({ status, at: now });
    if (rec.latencyMs === undefined && (status === 'sent' || status === 'delivered')) rec.latencyMs = now - rec.createdAt;
    this.onUpdate(rec);
  }
}
