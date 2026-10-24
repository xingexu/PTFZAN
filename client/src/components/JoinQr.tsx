import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { GUEST_TAB, LINKS } from '../links';
import { Icon } from './Icon';

export function JoinQr() {
  const url = `${LINKS.guestQr}/join`;
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 256, color: { dark: '#14213D', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [url]);
  return (
    <div className="card qr-card">
      {src ? <img src={src} alt={`QR code to ${url}`} /> : <div style={{ width: 92, height: 92 }} />}
      <div style={{ minWidth: 0 }}>
        <h3>Be a wedding guest</h3>
        <p>Scan to open the guest app: check in online, see when your room will be ready, and get a message the moment it is.</p>
        <a href={`${LINKS.guest}/join`} target={GUEST_TAB} style={{ fontSize: 12.5, fontWeight: 700, wordBreak: 'break-all', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          {url.replace(/^https?:\/\//, '')} <Icon name="external" size={12} />
        </a>
      </div>
    </div>
  );
}
