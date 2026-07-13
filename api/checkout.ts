// api/checkout.ts
// Step 1 of the vendor flow: create a PayPal order for a featured-event listing.
// POST body: { event: {...}, price?: number }
// Response: { orderID, approveUrl } — the app opens approveUrl for the vendor to pay.

import { PAYPAL_BASE, paypalToken, paypalConfigured, cors } from './_paypal';
import { kvGet, kvSet, rateLimitOk, clientIp } from './_store';

// LAUNCH MODE: event posting is FREE for now — a price of 0 publishes immediately with no
// PayPal step. To start charging again, set this back to 10 (the whole PayPal flow below
// is intact and takes over automatically for any price > 0).
const FEATURE_PRICE = 0; // USD per featured event

export default async function handler(req: any, res: any){
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!(await rateLimitOk('checkout:' + clientIp(req), 10))) { res.status(429).json({ error: 'Too many requests — try again in a minute.' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const event = body.event || {};
    const price = Number(body.price) || FEATURE_PRICE;
    if (!event.title) { res.status(400).json({ error: 'event.title is required' }); return; }

    // FREE LAUNCH MODE: publish straight to the featured list, no payment step.
    if (price <= 0) {
      const freeId = 'free_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const item = { ...event, id: `vip_${freeId}`, source: 'featured', featured: true, paidAt: new Date().toISOString() };
      const list = (await kvGet<any[]>('featured_events')) || [];
      await kvSet('featured_events', [item, ...list.filter((x: any) => x.id !== item.id)].slice(0, 200));
      res.status(200).json({ ok: true, free: true, orderID: freeId, event: item });
      return;
    }

    if (!paypalConfigured()) { res.status(503).json({ error: 'PayPal not configured. Set PAYPAL_CLIENT_ID / PAYPAL_SECRET in Vercel.' }); return; }
    const token = await paypalToken();
    if (!token) { res.status(502).json({ error: 'Could not authenticate with PayPal' }); return; }

    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: price.toFixed(2) },
          description: `5to9 featured event: ${String(event.title).slice(0, 100)}`,
        }],
        application_context: { brand_name: '5to9', user_action: 'PAY_NOW' },
      }),
    });
    const data = await orderRes.json();
    if (!orderRes.ok || !data.id) { res.status(502).json({ error: 'PayPal order failed', detail: data }); return; }

    // stash the pending event so capture.ts can publish it after payment (7-day TTL — stale
    // unpaid orders should not live in Redis forever)
    await kvSet(`order_${data.id}`, { event, status: 'CREATED', price }, 7 * 24 * 3600);

    const approveUrl = (data.links || []).find((l: any) => l.rel === 'approve')?.href || null;
    res.status(200).json({ orderID: data.id, approveUrl });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
