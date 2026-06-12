// api/checkout.ts
// Step 1 of the vendor flow: create a PayPal order for a featured-event listing.
// POST body: { event: {...}, price?: number }
// Response: { orderID, approveUrl } — the app opens approveUrl for the vendor to pay.

import { PAYPAL_BASE, paypalToken, paypalConfigured, cors } from './_paypal';
import { kvSet, rateLimitOk, clientIp } from './_store';

const FEATURE_PRICE = 10; // USD per featured event

export default async function handler(req: any, res: any){
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!paypalConfigured()) { res.status(503).json({ error: 'PayPal not configured. Set PAYPAL_CLIENT_ID / PAYPAL_SECRET in Vercel.' }); return; }
  if (!(await rateLimitOk('checkout:' + clientIp(req), 10))) { res.status(429).json({ error: 'Too many requests — try again in a minute.' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const event = body.event || {};
    const price = Number(body.price) || FEATURE_PRICE;
    if (!event.title) { res.status(400).json({ error: 'event.title is required' }); return; }

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
