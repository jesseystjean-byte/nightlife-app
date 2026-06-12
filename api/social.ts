// api/social.ts
// REAL-TIME pop-up events from social media — compliant, consent-based (Instagram Login flow).
//
// A venue/promoter connects their Instagram professional account once (Instagram Login OAuth).
// We store their long-lived token, then POLL their recent posts (Instagram has no "new post"
// webhook, so polling is the real mechanism) and turn each event post into a 5to9 event with Claude.
//   • /api/social?action=connect  -> returns the Instagram OAuth URL
//   • /api/social (GET ?code=...)  -> OAuth callback: exchanges code -> long-lived token, stores it
//   • /api/social?action=refresh   -> polls every connected account's recent media (cron target)
//   • GET ?hub.mode=...            -> webhook verify handshake (kept for comments/mentions later)
//
// Vercel env vars: INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET (falls back to META_APP_ID/META_APP_SECRET),
//                  META_VERIFY_TOKEN, ANTHROPIC_API_KEY. Requires a Vercel KV store.

import { kvGet, kvSet, kvEnabled } from './_store';
import { cors } from './_paypal';

type EventItem = any;

const IG_ID = () => process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || '';
const IG_SECRET = () => process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || '';

function hashStr(s: string){ let h=0; for (let i=0;i<s.length;i++){ h=(h<<5)-h+s.charCodeAt(i); h|=0; } return Math.abs(h).toString(36); }

async function captionToEvent(caption: string, permalink: string, image: string, city: string): Promise<EventItem | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !caption) return null;
  const today = new Date().toISOString();
  const prompt = `From this Instagram caption, extract a single nightlife/pop-up/local EVENT if one is described (pop-up shop, party, watch party, run club, trivia, market, show, etc.).
TODAY: ${today}
CITY (fallback): ${city || '(unknown)'}
CAPTION: """${caption.slice(0, 1200)}"""
Reply ONLY JSON: { "isEvent": boolean, "title": string, "startsAt": ISO8601 or "", "venue": string, "city": string, "description": string }
If no concrete event, isEvent=false. Infer the next future date if only a day/time is given.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const t = d?.content?.[0]?.text || '';
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < 0) return null;
    const p = JSON.parse(t.slice(a, b + 1));
    if (!p.isEvent) return null;
    return {
      id: 'soc_' + hashStr(permalink || (p.title + p.startsAt)),
      source: 'social', title: p.title || 'Pop-up', startsAt: p.startsAt || today,
      venue: p.venue || undefined, city: p.city || city || undefined,
      url: permalink || undefined, image: image || undefined,
      description: p.description || undefined, featured: false,
    };
  } catch { return null; }
}

async function ingest(media: any, city: string): Promise<boolean> {
  const ev = await captionToEvent(media.caption || '', media.permalink || '', media.media_url || media.thumbnail_url || '', city);
  if (!ev) return false;
  const list = (await kvGet<EventItem[]>('web_events')) || [];
  const next = [ev, ...list.filter((x: any) => x.id !== ev.id)].slice(0, 400);
  await kvSet('web_events', next);
  return true;
}

// Poll recent posts for every connected Instagram account.
async function refreshAll(): Promise<number> {
  const accounts = (await kvGet<any[]>('social_accounts')) || [];
  let count = 0;
  for (const acc of accounts) {
    try {
      const media = await fetch(`https://graph.instagram.com/me/media?fields=id,caption,permalink,media_url,thumbnail_url,timestamp&limit=10&access_token=${acc.token}`).then(r => r.json());
      for (const m of (media?.data || [])) { if (await ingest(m, acc.city || '')) count++; }
    } catch {}
  }
  return count;
}

export default async function handler(req: any, res: any){
  cors(res);
  const q = req.query || {};

  // Webhook verification handshake (for comments/mentions later)
  if (req.method === 'GET' && q['hub.mode']) {
    if (q['hub.verify_token'] === process.env.META_VERIFY_TOKEN) { res.status(200).send(q['hub.challenge']); return; }
    res.status(403).end(); return;
  }

  // Build the Instagram OAuth URL a venue taps to connect
  if (req.method === 'GET' && q.action === 'connect') {
    // Without an Instagram App ID the OAuth URL is broken (client_id=) — tell the app clearly
    // instead of sending users to an Instagram error page.
    if (!IG_ID()) { res.status(200).json({ url: null, error: 'Instagram connection isn’t configured yet — add INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET in Vercel.' }); return; }
    const redirect = `https://${req.headers.host}/api/social`;
    const scope = 'instagram_business_basic';
    const url = `https://www.instagram.com/oauth/authorize?client_id=${IG_ID()}&redirect_uri=${encodeURIComponent(redirect)}&scope=${scope}&response_type=code`;
    res.status(200).json({ url }); return;
  }

  // OAuth callback: code -> short token -> long-lived token -> store
  if (req.method === 'GET' && q.code) {
    if (!kvEnabled()) { res.status(503).send('Storage not configured.'); return; }
    const redirect = `https://${req.headers.host}/api/social`;
    try {
      const form = new URLSearchParams({ client_id: IG_ID(), client_secret: IG_SECRET(), grant_type: 'authorization_code', redirect_uri: redirect, code: String(q.code) });
      const short = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form }).then(r => r.json());
      if (!short?.access_token) { res.status(400).send('Connection failed.'); return; }
      const long = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_SECRET()}&access_token=${short.access_token}`).then(r => r.json());
      const token = long?.access_token || short.access_token;
      const accounts = (await kvGet<any[]>('social_accounts')) || [];
      accounts.push({ token, city: q.city || '', connectedAt: Date.now() });
      await kvSet('social_accounts', accounts);
      await refreshAll();
      res.status(200).send('✅ Connected! Your Instagram event posts will now appear in 5to9. You can close this window.'); return;
    } catch { res.status(400).send('Connection failed — please try again.'); return; }
  }

  // Poll / cron refresh (Vercel cron hits this). Cron-only when CRON_SECRET is set —
  // otherwise anyone could hammer it and burn the Anthropic quota on re-ingestion.
  if (req.method === 'POST' || q.action === 'refresh') {
    const SECRET = process.env.CRON_SECRET || '';
    if (SECRET) {
      const auth = String(req.headers?.authorization || '');
      if (auth !== `Bearer ${SECRET}` && String(q.secret || '') !== SECRET) {
        res.status(401).json({ error: 'unauthorized' }); return;
      }
    }
    if (!kvEnabled()) { res.status(503).json({ error: 'Storage not configured.' }); return; }
    const n = await refreshAll();
    res.status(200).json({ ok: true, ingested: n }); return;
  }

  res.status(400).json({ error: 'unknown action' });
}
