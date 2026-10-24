// Phone-number and SMS-text helpers. Full numbers never leave the server; everything shown in the UI is masked.

/**
 * Normalize user input to E.164. Accepts North American numbers with or without +1
 * ("416-555-0123", "(647) 555 0199", "+1 416 555 0123") and other +E.164 numbers.
 * Returns null when the input is not a plausible phone number.
 */
export function normalizePhone(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const plus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (plus && !digits.startsWith('1')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  let nanp = digits;
  if (nanp.length === 11 && nanp.startsWith('1')) nanp = nanp.slice(1);
  if (nanp.length !== 10) return null;
  // NANP: area code and exchange can't start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(nanp)) return null;
  return `+1${nanp}`;
}

/** "+14165550123" → "+1 (416) •••-0123"; other countries keep only the last 4 digits. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const d = e164.replace(/\D/g, '');
  if (e164.startsWith('+1') && d.length === 11) return `+1 (${d.slice(1, 4)}) •••-${d.slice(-4)}`;
  return `+${d.slice(0, 2)} ••• ${d.slice(-4)}`;
}

// GSM 03.38 basic character set (+ extension table). Anything else forces UCS-2,
// which cuts a segment from 160 to 70 characters and doubles the cost.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';

/** Replace typographic characters with GSM-safe equivalents so each message stays one cheap segment. */
export function toSmsText(s: string): string {
  return s
    .replace(/[–—−]/g, '-') // en/em dash, minus
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[•·]/g, '-')
    .replace(/ /g, ' ')
    .split('')
    .filter((c) => GSM_BASIC.includes(c) || GSM_EXT.includes(c))
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Number of SMS segments the text will use (GSM-7 assumed after toSmsText). */
export function smsSegments(s: string): number {
  const units = [...s].reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0);
  return units <= 160 ? 1 : Math.ceil(units / 153);
}
