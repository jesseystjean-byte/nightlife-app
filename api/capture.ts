// api/capture.ts
// Step 2 of the vendor flow: after the vendor approves payment, capture the order.
// On success, the event is published into the live "featured_events" list that the
// app reads — so a paid event shows up in VIP (and the top of Discover) immediately.
// POST body: { orderID }
// Response: { ok, event? }

import { PAYPAL_BASE, paypalToken, paypalConfigured, cors } from './_paypal';
import { kvGet, kvSet } from './_store';

type EventItem = any;

export default async function handler(req: any, res: any){
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!paypalConfigured()) { res.status(503).json({ error: 'PayPal not configured.' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const orderID = body.orderID;
    if (!orderID) { res.status(400).json({ error: 'orderID required' }); return; }

    const token = await paypalToken();
    if (!token) { res.status(502).json({ error: 'Could not authenticate with PayPal' }); return; }

    const capRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    const data = await capRes.json();
    if (data.status !== 'COMPLETED') { res.status(400).json({ ok: false, status: data.status || 'FAILED', detail: data }); return; }

    // payment captured -> publish the event
    const pending = await kvGet<{ event: EventItem }>(`order_${orderID}`);
    const ev = pending?.event;
    if (!ev) { res.status(200).json({ ok: true, event: null, note: 'Captured, but no pending event found.' }); return; }

    const item: EventItem = {
      ...ev,
      id: `vip_${orderID}`,
      source: 'featured',
      featured: true,
      paidAt: new Date().toISOString(),
    };
    const list = (await kvGet<EventItem[]>('featured_events')) || [];
    const next = [item, ...list.filter((x: EventItem) => x.id !== item.id)].slice(0, 200);
    await kvSet('featured_events', next);
    await kvSet(`order_${orderID}`, { ...pending, status: 'COMPLETED' });

    res.status(200).json({ ok: true, event: item });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
