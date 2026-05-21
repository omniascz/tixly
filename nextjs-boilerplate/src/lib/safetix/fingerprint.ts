/**
 * Lightweight client-side device fingerprint.
 *
 * Skládá z: userAgent + screen dimensions + timezone + canvas hash.
 * SHA-256 v browseru. Pro SafeTix device binding (first-view lock).
 *
 * Není anti-fingerprint resistant ale stačí jako "casual" replay barrier.
 */
export async function computeDeviceFingerprint(): Promise<string> {
  const parts: string[] = [
    navigator.userAgent,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.hardwareConcurrency?.toString() ?? '?',
  ];

  // Canvas fingerprint
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#069';
      ctx.fillText('tixly-fp', 2, 2);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('tixly-fp', 4, 4);
      parts.push(canvas.toDataURL().slice(-100));
    }
  } catch {
    parts.push('no-canvas');
  }

  const data = parts.join('|');
  const buf = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
