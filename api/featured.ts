// api/featured.ts
// Returns the active paid/featured events for the app (VIP tab + top of Discover).
// GET -> { events: [...] }

import { kvGet } from './_store';
import { cors } from './_paypal';

export default async function handler(req: any, res: any){
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const list = (await kvGet<any[]>('featured_events')) || [];
    const now = Date.now();
    // keep events whose start is in the future, undated, or ended within the last 24h
    const active = list.filter((e: any) => {
      const t = Date.parse(e.startsAt || '');
      return isNaN(t) || t > now - 24 * 3600 * 1000;
    });
    res.status(200).json({ events: active });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
