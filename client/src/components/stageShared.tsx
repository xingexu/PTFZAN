import { useState } from 'react';
import type { DeliveryRecord, StageState } from '../../../shared/types';

export function latestFor(s: StageState, kind: DeliveryRecord['kind']) {
  const msg = s.messages.find((m) => m.kind === kind);
  return msg ? s.deliveries.find((d) => d.notificationId === msg.id) : undefined;
}

export function PinDialog({ onSubmit, onCancel }: { onSubmit: (pin: string) => void; onCancel: () => void }) {
  const [pin, setPin] = useState('');
  return (
    <div className="drawer-backdrop center" onClick={onCancel}>
      <form
        className="card card-pad pin-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Enter stage PIN"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.trim()) onSubmit(pin.trim());
        }}
      >
        <h2 style={{ margin: 0 }}>Stage PIN</h2>
        <p className="muted" style={{ margin: '6px 0 12px' }}>This server protects the stage controls because they send real texts.</p>
        <input className="input" type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN" />
        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary">Unlock</button>
        </div>
      </form>
    </div>
  );
}
