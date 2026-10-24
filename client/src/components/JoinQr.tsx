import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { GUEST_TAB, guestQrUrl, guestUrl } from '../links';

/** A QR code to the guest app, for the audience's phones. */
export function JoinQr() {
  const url = guestQrUrl();
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 256, color: { dark: '#0b1222', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [url]);
  return (
    <a className="qr glass" href={guestUrl('/')} target={GUEST_TAB} title={url}>
      {src ? <img src={src} alt={`QR code to ${url}`} /> : <span className="qr-blank" />}
      <span>
        <b>Be a wedding guest</b>
        <span>Scan to register on your phone</span>
      </span>
    </a>
  );
}
