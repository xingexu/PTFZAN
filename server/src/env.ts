// Configuration from environment variables (optionally loaded from a local .env file).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { normalizePhone } from './phone.js';

const envFile = path.resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  try {
    // Node ≥ 20.12 — does not override variables that are already set.
    process.loadEnvFile(envFile);
  } catch (e) {
    console.warn('Could not read .env:', (e as Error).message);
  }
}

const str = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

export type ProviderName = 'twilio' | 'httpsms' | 'mac' | 'ntfy';

export interface MessagingConfig {
  /** Force one provider (SMS_PROVIDER). Otherwise: twilio → httpsms → mac → ntfy. */
  preferred?: ProviderName;
  twilio?: {
    accountSid: string;
    authToken: string;
    from?: string;
    messagingServiceSid?: string;
    /** Trial accounts can only send Twilio's canned templates — set e.g. "sms_appointment_reminders". */
    trialTemplate?: string;
    apiBase: string;
  };
  /** Your own Android phone sends the SMS, from your own number (httpSMS app). */
  httpsms?: { apiKey: string; from: string; apiBase: string };
  /** The Messages app on this Mac sends it (your Apple ID / iPhone number). Server must run on that Mac. */
  mac?: { service: 'imessage' | 'sms' };
  /** Personal-number providers only text the stage guest unless this is true (protects your number). */
  allowGuestTextsFromPersonalNumber: boolean;
  ntfy?: { server: string; topic: string };
  maxPerHour: number;
  maxPerGuestPerHour: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export function loadMessagingConfig(): MessagingConfig {
  const sid = str('TWILIO_ACCOUNT_SID');
  const token = str('TWILIO_AUTH_TOKEN');
  const from = str('TWILIO_FROM');
  const mss = str('TWILIO_MESSAGING_SERVICE_SID');
  const trialTemplate = str('TWILIO_TRIAL_TEMPLATE');
  const topic = str('NTFY_TOPIC');
  const httpsmsKey = str('HTTPSMS_API_KEY');
  const httpsmsFrom = normalizePhone(str('HTTPSMS_FROM') ?? '');
  if (httpsmsKey && !httpsmsFrom) console.warn('HTTPSMS_FROM must be the phone number registered in the httpSMS app — httpSMS disabled.');
  const macRaw = str('MAC_MESSAGES')?.toLowerCase();
  const pref = str('SMS_PROVIDER')?.toLowerCase();
  return {
    preferred: pref === 'twilio' || pref === 'httpsms' || pref === 'mac' || pref === 'ntfy' ? pref : undefined,
    httpsms: httpsmsKey && httpsmsFrom ? { apiKey: httpsmsKey, from: httpsmsFrom, apiBase: (str('HTTPSMS_API_BASE') ?? 'https://api.httpsms.com').replace(/\/$/, '') } : undefined,
    mac: macRaw && macRaw !== 'false' && macRaw !== '0' ? { service: macRaw === 'sms' ? 'sms' : 'imessage' } : undefined,
    allowGuestTextsFromPersonalNumber: ['1', 'true', 'yes'].includes((str('ALLOW_GUEST_TEXTS_FROM_PERSONAL_NUMBER') ?? '').toLowerCase()),
    twilio:
      sid && token && (from || mss || trialTemplate)
        ? { accountSid: sid, authToken: token, from, messagingServiceSid: mss, trialTemplate, apiBase: str('TWILIO_API_BASE') ?? 'https://api.twilio.com' }
        : undefined,
    ntfy: topic ? { server: (str('NTFY_SERVER') ?? 'https://ntfy.sh').replace(/\/$/, ''), topic } : undefined,
    maxPerHour: num('SMS_MAX_PER_HOUR', 60),
    maxPerGuestPerHour: num('SMS_MAX_PER_GUEST_PER_HOUR', 8),
    pollIntervalMs: 1200,
    pollTimeoutMs: 30000,
  };
}

export const STAGE = {
  name: str('STAGE_NAME') ?? 'Mike',
  phone: str('STAGE_PHONE'),
  room: str('STAGE_ROOM') ?? '504',
  pin: str('STAGE_PIN'),
  timeZone: str('HOTEL_TIME_ZONE') ?? 'America/Toronto',
};

export const PUBLIC_URL = str('PUBLIC_URL')?.replace(/\/$/, '');
