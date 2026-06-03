// api/_store.ts
// Tiny persistence helper backed by Vercel KV / Upstash Redis REST.
// Provision: Vercel dashboard -> Storage -> KV (or Upstash) -> it injects
// KV_REST_API_URL and KV_REST_API_TOKEN env vars automatically.
// If those env vars are absent, every call is a safe no-op so the app still runs
// (featured events just won't persist until KV is connected).

const URL = process.env.KV_REST_API_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || '';

export function kvEnabled(): boolean { return !!(URL && TOKEN); }

export async function kvGet<T = any>(key: string): Promise<T | null> {
  if (!kvEnabled()) return null;
  try {
    const r = await fetch(`${URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.result == null) return null;
    try { return JSON.parse(d.result) as T; } catch { return d.result as T; }
  } catch { return null; }
}

export async function kvSet(key: string, value: any): Promise<boolean> {
  if (!kvEnabled()) return false;
  try {
    const r = await fetch(`${URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
    return r.ok;
  } catch { return false; }
}
