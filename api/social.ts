// api/social.ts
// REAL-TIME pop-up events from social media — the compliant, can't-get-you-banned way.
//
// A venue/promoter connects their Instagram or Facebook BUSINESS account ONE time (OAuth).
// After that:
//   • Meta sends a WEBHOOK to /api/social the instant they post  -> we turn the post into an event live.
//   • A /api/social?action=refresh poller (or Vercel cron, every few min) is the real-time fallback.
// Claude reads each post's caption and extracts the event (title, date, venue, description).
//
// This is legal because the account owner authorized access (same model Eventbrite/Bandsintown use).
// It deliberately does NOT scrape public posts of accounts that haven't connected — that violates
// Meta/TikTok/X terms and gets iOS apps removed.
//
// Vercel env vars: META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN, ANTHROPIC_API_KEY
// Requires a Vercel KV store (same one used elsewhere).

import { kvGet, kvSet, kvEnabled } from './_store';
import { cors } from './_paypal';

const GRAPH = 'https://graph.facebook.com/v21.0';

type EventItem = any;

function hashStr(s: string){ let h=0; for (let i=0;i<s.length;i++){ h=(h<<5)-h+s.charCodeAt(i); h|=0; } return Math.abs(h).toString(36); }

// Turn a social post caption into an event with Claude.
async function captionToEvent(caption: string, permalink: string, image: string, city: string): Promise<EventItem | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !caption) return null;
  const today = new Date().toISOString();
  const prompt = `From this social media post caption, extract a single nightlife/pop-up/local EVENT if one is described (pop-up shop, party, watch party, run club, trivia, market, show, etc.).
TODAY: ${today}
CITY (fallback): ${city || '(unknown)'}
CAPTION: """${caption.slice(0, 1200)}"""
Reply ONLY JSON: { "isEvent": boolean, "title": string, "startsAt": ISO8601 or "", "venue": string, "city": string, "description": string }
If no concrete event, isEvent=false. Infer the next future date if only a day/time is given.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
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
      source: 'social',
      title: p.title || 'Pop-up',
      startsAt: p.startsAt || today,
      venue: p.venue || undefined,
      city: p.city || city || undefined,
      url: permalink || undefined,
      image: image || undefined,
      description: p.description || undefined,
      featured: false,
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

// Poll recent posts for every connected account (real-time fallback / cron target).
async function refreshAll(): Promise<number> {
  const accounts = (await kvGet<any[]>('social_accounts')) || [];
  let count = 0;
  for (const acc of accounts) {
    try {
      const pages = await fetch(`${GRAPH}/me/accounts?fields=instagram_business_account&access_token=${acc.token}`).then(r => r.json());
      const igId = pages?.data?.[0]?.instagram_business_account?.id;
      if (!igId) continue;
      const media = await fetch(`${GRAPH}/${igId}/media?fields=id,caption,permalink,media_url,thumbnail_url,timestamp&limit=10&access_token=${acc.token}`).then(r => r.json());
      for (const m of (media?.data || [])) { if (await ingest(m, acc.city || '')) count++; }
    } catch {}
  }
  return count;
}

export default async function handler(req: any, res: any){
  cors(res);
  const q = req.query || {};

  // 1) Webhook verification handshake (Meta calls this when you register the webhook)
  if (req.method === 'GET' && q['hub.mode']) {
    if (q['hub.verify_token'] === process.env.META_VERIFY_TOKEN) { res.status(200).send(q['hub.challenge']); return; }
    res.status(403).end(); return;
  }

  // 2) Build the OAuth URL a venue taps to connect their account
  if (req.method === 'GET' && q.action === 'connect') {
    const redirect = `https://${req.headers.host}/api/social`;
    const scope = 'instagram_basic,pages_show_list,pages_read_engagement,business_management';
    const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${process.env.META_APP_ID}&redirect_uri=${encodeURIComponent(redirect)}&scope=${scope}&response_type=code`;
    res.status(200).json({ url }); return;
  }

  // 3) OAuth callback — exchange code for a long-lived token and remember the account
  if (req.method === 'GET' && q.code) {
    if (!kvEnabled()) { res.status(503).send('Storage not configured.'); return; }
    const redirect = `https://${req.headers.host}/api/social`;
    const tok = await fetch(`${GRAPH}/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&redirect_uri=${encodeURIComponent(redirect)}&code=${q.code}`).then(r => r.json()).catch(() => null);
    if (tok?.access_token) {
      const accounts = (await kvGet<any[]>('social_accounts')) || [];
      accounts.push({ token: tok.access_token, city: q.city || '', connectedAt: Date.now() });
      await kvSet('social_accounts', accounts);
      await refreshAll();
      res.status(200).send('✅ Connected! Your posts will now appear in 5to9. You can close this window.'); return;
    }
    res.status(400).send('Connection failed — please try again.'); return;
  }

  // 4) Real-time webhook: Meta pings here when a connected account posts -> ingest immediately
  if (req.method === 'POST') {
    const n = await refreshAll();
    res.status(200).json({ ok: true, ingested: n }); return;
  }

  // 5) Manual / cron refresh (set a Vercel cron on /api/social?action=refresh for steady real-time)
  if (q.action === 'refresh') {
    if (!kvEnabled()) { res.status(503).json({ error: 'Storage not configured.' }); return; }
    const n = await refreshAll();
    res.status(200).json({ ok: true, ingested: n }); return;
  }

  res.status(400).json({ error: 'unknown action' });
}
