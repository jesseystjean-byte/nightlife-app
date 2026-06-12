// api/log.ts
// Lightweight crash/error reporting — no third-party SDK needed.
// The app's global error handler POSTs JS errors here; they're kept in a capped
// Redis list so production breakage on users' phones is visible instead of silent.
//
//   POST { message, stack?, fatal?, build?, screen? }   -> { ok }
//   GET  ?secret=<CRON_SECRET>                          -> { errors: [last 50] }
//
// Reading requires CRON_SECRET (set it in Vercel) so logs aren't public.

import { kvPushCapped, kvRange, rateLimitOk, clientIp } from './_store';
import { cors } from './_paypal';

export default async function handler(req: any, res: any){
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method === 'GET') {
    const SECRET = process.env.CRON_SECRET || '';
    if (!SECRET || String(req.query?.secret || '') !== SECRET) { res.status(401).json({ error: 'unauthorized' }); return; }
    res.status(200).json({ errors: await kvRange('client_errors', 50) });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!(await rateLimitOk('log:' + clientIp(req), 20))) { res.status(429).json({ error: 'rate limited' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const entry = {
      at: new Date().toISOString(),
      message: String(body.message || '').slice(0, 500),
      stack: String(body.stack || '').slice(0, 2000),
      fatal: !!body.fatal,
      build: String(body.build || ''),
      screen: String(body.screen || '').slice(0, 60),
    };
    if (!entry.message) { res.status(400).json({ error: 'message required' }); return; }
    await kvPushCapped('client_errors', entry, 200);
    res.status(200).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
