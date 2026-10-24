import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function JoinQr({ compact = false }: { compact?: boolean }) {
  const url = `${window.location.origin}/join`;
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 256, color: { dark: '#101614', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [url]);
  return (
    <div className={`card qr-card`}>
      {src ? <img src={src} alt={`QR code to ${url}`} /> : <div style={{ width: 128, height: 128 }} />}
      <div>
        <h3>Be a wedding guest</h3>
        {!compact && <p className="muted" style={{ margin: '4px 0 8px', fontSize: 14 }}>Scan with your phone. You&rsquo;ll get a live ETA and a notification the moment your room is ready.</p>}
        <a href="/join" target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13, wordBreak: 'break-all' }}>
          {url.replace(/^https?:\/\//, '')}
        </a>
      </div>
    </div>
  );
}
