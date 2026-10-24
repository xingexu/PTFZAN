import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { GUEST_TAB, LINKS } from '../links';

export function JoinQr() {
  const url = `${LINKS.guestQr}/join`;
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 256, color: { dark: '#0b1222', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [url]);
  return (
    <a className="qr" href={`${LINKS.guest}/join`} target={GUEST_TAB} title={url}>
      {src ? <img src={src} alt={`QR code to ${url}`} /> : <span className="qr-blank" />}
      <span>
        <b>Be a wedding guest</b>
        <span>Scan to join on your phone</span>
      </span>
    </a>
  );
}
