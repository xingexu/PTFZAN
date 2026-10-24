// Real guest messaging. One send() call; the provider is chosen from configuration:
//   twilio    → real SMS from a Twilio number (needs an upgraded account for custom text)
//   httpsms   → real SMS sent by YOUR Android phone, from your own number (httpSMS app)
//   mac       → real iMessage/SMS sent by the Messages app on the Mac running this server (your Apple ID / number)
//   ntfy      → real push notification to the ntfy app on one phone (free, not SMS) — stage fallback
//   simulated → nothing leaves the server; shown on screen only
// Twilio can't send from a personal number (verified numbers are caller ID for calls only), which is why
// sending "from my own number" means having your own phone or Mac do the sending.
// Delivery status is tracked (Twilio is polled until delivered/failed) so the stage screen can show it live.
import { execFile } from 'node:child_process';
import type { DeliveryRecord, DeliveryStatus, MessagingProvider, MessagingStatus, NotificationKind } from '../../shared/types.js';
import type { MessagingConfig, ProviderName } from './env.js';
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

const DEFAULT_ORDER: ProviderName[] = ['twilio', 'httpsms', 'mac', 'ntfy'];

// AppleScript for the Messages app. Arguments are passed via argv (never interpolated) so message text can't
// inject script. Newer macOS uses account/participant; older versions use service/buddy.
const MAC_SCRIPT_MODERN = `on run argv
  set targetPhone to item 1 of argv
  set targetMessage to item 2 of argv
  tell application "Messages"
    if (item 3 of argv) is "sms" then
      set targetAccount to 1st account whose service type = SMS
    else
      set targetAccount to 1st account whose service type = iMessage
    end if
    send targetMessage to participant targetPhone of targetAccount
  end tell
end run`;
const MAC_SCRIPT_LEGACY = `on run argv
  set targetPhone to item 1 of argv
  set targetMessage to item 2 of argv
  tell application "Messages"
    if (item 3 of argv) is "sms" then
      set targetService to 1st service whose service type = SMS
    else
      set targetService to 1st service whose service type = iMessage
    end if
    send targetMessage to buddy targetPhone of targetService
  end tell
end run`;

function macError(raw: string): string {
  if (/-1743|not authori[sz]ed/i.test(raw))
    return 'macOS blocked the server from controlling Messages. Allow it in System Settings → Privacy & Security → Automation (Terminal → Messages), then try again.';
  if (/-1728|can.t get .*(account|service)/i.test(raw))
    return 'Messages has no matching account. For SMS, turn on Text Message Forwarding for this Mac on your iPhone; or set MAC_MESSAGES=imessage.';
  if (/ENOENT/.test(raw)) return 'osascript was not found — MAC_MESSAGES only works when the server runs on a Mac.';
  return `Messages could not send: ${raw.replace(/\s+/g, ' ').trim().slice(0, 200)}`;
}

const defaultRunAppleScript = (script: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile('osascript', ['-e', script, ...args], { timeout: 15000 }, (err, _stdout, stderr) =>
      err ? reject(new Error(String(stderr || '').trim() || err.message)) : resolve(),
    );
  });

export interface MessengerDeps {
  fetch?: typeof fetch;
  runAppleScript?: (script: string, args: string[]) => Promise<void>;
  platform?: NodeJS.Platform;
}

export class Messenger {
  readonly records: DeliveryRecord[] = [];
  private sent: { at: number; guest: string }[] = [];
  private seq = 0;
  private fetchImpl: typeof fetch;
  private runAppleScript: (script: string, args: string[]) => Promise<void>;
  private platform: NodeJS.Platform;

  constructor(
    private cfg: MessagingConfig,
    private onUpdate: (r: DeliveryRecord) => void = () => undefined,
    deps: MessengerDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? ((...a) => fetch(...a));
    this.runAppleScript = deps.runAppleScript ?? defaultRunAppleScript;
    this.platform = deps.platform ?? process.platform;
  }

  private get order(): ProviderName[] {
    const p = this.cfg.preferred;
    return p ? [p, ...DEFAULT_ORDER.filter((x) => x !== p)] : DEFAULT_ORDER;
  }

  private configured(p: ProviderName) {
    return !!this.cfg[p];
  }

  get status(): MessagingStatus {
    const primary = this.order.find((p) => this.configured(p));
    const allowGuests = this.cfg.allowGuestTextsFromPersonalNumber;
    switch (primary) {
      case 'twilio': {
        const t = this.cfg.twilio!;
        return {
          provider: 'twilio',
          smsEnabled: true,
          personalNumber: false,
          sender: t.trialTemplate ? 'Twilio trial number' : t.from ? maskPhone(t.from) : 'Twilio Messaging Service',
          trialTemplate: t.trialTemplate ?? null,
          note: t.trialTemplate
            ? `Twilio trial mode: messages use Twilio's "${t.trialTemplate}" template text and only reach verified numbers.`
            : 'Real SMS via Twilio.',
        };
      }
      case 'httpsms':
        return {
          provider: 'httpsms',
          smsEnabled: allowGuests,
          personalNumber: true,
          sender: maskPhone(this.cfg.httpsms!.from),
          trialTemplate: null,
          note: `Real SMS sent by your own Android phone (httpSMS app), from ${maskPhone(this.cfg.httpsms!.from)}.${allowGuests ? '' : ' Audience guests are not texted, so your number stays private.'}`,
        };
      case 'mac': {
        const sms = this.cfg.mac!.service === 'sms';
        const onMac = this.platform === 'darwin';
        return {
          provider: 'mac',
          smsEnabled: allowGuests && onMac,
          personalNumber: true,
          sender: 'this Mac’s Messages app',
          trialTemplate: null,
          note: onMac
            ? `Real ${sms ? 'SMS (through your iPhone’s Text Message Forwarding)' : 'iMessage'} sent by the Messages app on this Mac, from your Apple ID / phone number.${allowGuests ? '' : ' Audience guests are not texted.'}`
            : 'MAC_MESSAGES is set, but this server is not running on a Mac — messages will fail. Run the server on the Mac signed in to Messages.',
        };
      }
      case 'ntfy':
        return {
          provider: 'ntfy',
          smsEnabled: false,
          personalNumber: false,
          sender: 'ntfy push',
          trialTemplate: null,
          note: 'Real push notification to the ntfy app on the presenter’s phone (free, not SMS).',
        };
      default:
        return {
          provider: 'simulated',
          smsEnabled: false,
          personalNumber: false,
          sender: null,
          trialTemplate: null,
          note: 'No messaging configured — messages are simulated and shown on screen only.',
        };
    }
  }

  /** Which provider a message will actually use. */
  resolve(msg: OutboundMessage): MessagingProvider {
    if (msg.simulate) return 'simulated';
    const stage = msg.audience === 'stage';
    const personalOk = stage || this.cfg.allowGuestTextsFromPersonalNumber;
    for (const p of this.order) {
      if (p === 'twilio' && this.cfg.twilio && msg.to) return 'twilio';
      if (p === 'httpsms' && this.cfg.httpsms && msg.to && personalOk) return 'httpsms';
      if (p === 'mac' && this.cfg.mac && msg.to && personalOk) return 'mac';
      if (p === 'ntfy' && this.cfg.ntfy && stage) return 'ntfy';
    }
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
      from: provider === 'httpsms' ? maskPhone(this.cfg.httpsms!.from) : provider === 'mac' ? 'your Messages app' : undefined,
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

    const job =
      provider === 'twilio'
        ? this.sendTwilio(rec, msg.to!, text)
        : provider === 'httpsms'
          ? this.sendHttpSms(rec, msg.to!, text)
          : provider === 'mac'
            ? this.sendMac(rec, msg.to!, text)
            : this.sendNtfy(rec, msg, text);
    job.catch((e: unknown) => this.update(rec, 'failed', e instanceof Error ? e.message : String(e)));
    return rec;
  }

  /** Resolves when the record reaches a final status (used by tests). */
  async settle(id: string, timeoutMs = 5000): Promise<DeliveryRecord> {
    const start = Date.now();
    for (;;) {
      const r = this.records.find((x) => x.id === id);
      if (!r) throw new Error('unknown record');
      if (TERMINAL.includes(r.status) || (r.provider !== 'twilio' && r.status === 'sent')) return r;
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

  /** Your Android phone sends the SMS from its own SIM (httpSMS app + API). */
  private async sendHttpSms(rec: DeliveryRecord, to: string, text: string) {
    const h = this.cfg.httpsms!;
    this.update(rec, 'sending');
    const res = await this.fetchImpl(`${h.apiBase}/v1/messages/send`, {
      method: 'POST',
      headers: { 'x-api-key': h.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ from: h.from, to, content: text }),
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.status === 401) throw new Error('httpSMS rejected the API key (check HTTPSMS_API_KEY).');
    if (!res.ok) throw new Error(`httpSMS: ${json.message ?? `HTTP ${res.status}`}. Check that HTTPSMS_FROM is the number registered in the httpSMS app and the phone is online.`);
    // Accepted: the httpSMS app on your phone now sends it over your carrier.
    this.update(rec, 'sent');
  }

  /** The Messages app on this Mac sends it — iMessage, or SMS through the iPhone's Text Message Forwarding. */
  private async sendMac(rec: DeliveryRecord, to: string, text: string) {
    if (this.platform !== 'darwin') throw new Error(macError('ENOENT'));
    const args = [to, text, this.cfg.mac!.service];
    this.update(rec, 'sending');
    try {
      await this.runAppleScript(MAC_SCRIPT_MODERN, args);
    } catch (modern) {
      try {
        await this.runAppleScript(MAC_SCRIPT_LEGACY, args);
      } catch (legacy) {
        throw new Error(macError(`${(modern as Error).message} | ${(legacy as Error).message}`));
      }
    }
    this.update(rec, 'sent');
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
