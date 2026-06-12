// api/paypal-webhook.ts
// PayPal webhook: auto-publishes a vendor's featured event the moment PayPal confirms
// payment — no "I've completed payment" tap required (that button remains as a fallback).
//
// One-time setup in the PayPal Developer Dashboard (your app -> Webhooks):
//   URL:    https://<your-host>/api/paypal-webhook
//   Events: CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED
// Then set PAYPAL_WEBHOOK_ID (shown in the dashboard) in Vercel env vars.
// Every delivery is verified against PayPal's signature API — unsigned posts are rejected.

import { PAYPAL_BASE, paypalToken, paypalConfigured } from './_paypal';
import { kvGet, kvSet } from './_store';

async function verifySignature(req: any, event: any): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false; // not configured -> reject everything
  const token = await paypalToken();
  if (!token) return false;
  try {
    const r = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        auth_algo: req.headers['paypal-auth-algo'],
        cert_url: req.headers['paypal-cert-url'],
        transmission_id: req.headers['paypal-transmission-id'],
        transmission_sig: req.headers['paypal-transmission-sig'],
        transmission_time: req.headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: event,
      }),
    });
    const d = await r.json();
    return d?.verification_status === 'SUCCESS';
  } catch { return false; }
}

// Publish the pending event tied to a paid order (idempotent — replaces by id).
async function publishOrder(orderID: string): Promise<boolean> {
  const pending = await kvGet<{ event: any }>(`order_${orderID}`);
  const ev = pending?.event;
  if (!ev) return false;
  const item = { ...ev, id: `vip_${orderID}`, source: 'featured', featured: true, paidAt: new Date().toISOString() };
  const list = (await kvGet<any[]>('featured_events')) || [];
  await kvSet('featured_events', [item, ...list.filter((x: any) => x.id !== item.id)].slice(0, 200));
  await kvSet(`order_${orderID}`, { ...pending, status: 'COMPLETED' }, 7 * 24 * 3600);
  return true;
}

export default async function handler(req: any, res: any){
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!paypalConfigured()) { res.status(503).json({ error: 'PayPal not configured' }); return; }
  try {
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!(await verifySignature(req, event))) { res.status(401).json({ error: 'invalid signature' }); return; }

    const type = event.event_type || '';
    if (type === 'CHECKOUT.ORDER.APPROVED') {
      // Buyer approved -> capture server-side, then publish.
      const orderID = event.resource?.id;
      if (orderID) {
        const token = await paypalToken();
        const cap = token ? await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        }).then(r => r.json()).catch(() => null) : null;
        const already = cap?.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED';
        if (cap?.status === 'COMPLETED' || already) await publishOrder(orderID);
      }
    } else if (type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderID = event.resource?.supplementary_data?.related_ids?.order_id;
      if (orderID) await publishOrder(orderID);
    }
    res.status(200).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
