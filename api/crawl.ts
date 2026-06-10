// api/crawl.ts
// Pulls events directly from venue / event-company WEBSITES — the compliant version of
// "find events off companies' websites". It does NOT scrape social networks. It reads the
// machine-readable event data sites publish for search engines:
//   - Schema.org "Event" JSON-LD (<script type="application/ld+json">)
// You maintain a list of venue/promoter site URLs; a daily cron (see vercel.json) crawls them
// and stores results in KV ("web_events"), which the main feed (townie.ts) then includes.
//
// POST { action: 'addSite', url }      -> add a site to crawl
// POST { action: 'removeSite', url }   -> remove a site
// POST { action: 'list' }              -> list tracked sites
// POST { action: 'run' }  or  GET ?run=1  -> crawl all tracked sites now
//
// Requires a Vercel KV store (same one used by featured events / friends).

import { kvGet, kvSet, kvEnabled } from './_store';
import { cors } from './_paypal';

type EventItem = {
  id: string; source: string; title: string; startsAt: string; endsAt?: string;
  venue?: string; city?: string; url?: string; image?: string;
  price?: { min?: number; max?: number; currency?: string; free?: boolean };
  categories?: string[]; description?: string;
};

// Built-in public event calendars for our launch cities. These pages publish Schema.org
// "Event" JSON-LD intended for machine reading (search engines consume the same data), so
// reading them is compliant — no social networks, no auth walls, no ToS circumvention.
// Localist-powered (.edu) calendars and the DoStuff/EverOut nightlife networks are the most
// reliable JSON-LD emitters; tourism/city pages are included as bonus coverage.
const SEED_SITES: string[] = [
  // Seattle
  'https://everout.com/seattle/events/',
  'https://www.thestranger.com/events',
  'https://art.washington.edu/calendar',
  'https://www.seattlecenter.com/events/calendar-of-events',
  'https://visitseattle.org/events/',
  // Boston
  'https://www.thebostoncalendar.com/events',
  'https://calendar.bu.edu/',
  'https://calendar.northeastern.edu/',
  'https://www.boston.gov/events',
  // New York City
  'https://events.columbia.edu/',
  'https://www.nycgo.com/events/',
  'https://www.amny.com/things-to-do/',
  // Chicago
  'https://do312.com/events',
  'https://events.uchicago.edu/',
  'https://www.choosechicago.com/events/',
  'https://www.chicago.gov/city/en/depts/dca/supp_info/department_of_culturalaffairsspecialeventscalendar.html',
];

function hashStr(s: string){ let h = 0; for (let i=0;i<s.length;i++){ h=(h<<5)-h+s.charCodeAt(i); h|=0; } return Math.abs(h).toString(36); }

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': '5to9-eventbot/1.0 (+https://5to9.app; reads public schema.org event data)' } });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

// Collect every JSON-LD object on the page, flattening @graph and arrays.
function jsonLdObjects(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of items) {
        if (it && it['@graph'] && Array.isArray(it['@graph'])) out.push(...it['@graph']);
        else out.push(it);
      }
    } catch {}
  }
  return out;
}

function typeIsEvent(t: any): boolean {
  if (!t) return false;
  const s = Array.isArray(t) ? t.join(' ') : String(t);
  return /event/i.test(s);
}

function toEvent(o: any, pageUrl: string): EventItem | null {
  if (!typeIsEvent(o['@type'])) return null;
  const name = o.name || o.headline;
  if (!name || !o.startDate) return null;
  const loc = o.location || {};
  const offers = Array.isArray(o.offers) ? o.offers[0] : o.offers;
  const img = Array.isArray(o.image) ? o.image[0] : (o.image?.url || o.image);
  let price: EventItem['price'] | undefined;
  if (offers) {
    if (String(offers.price) === '0' || /free/i.test(offers.price || '')) price = { free: true };
    else if (offers.price != null) price = { min: parseFloat(offers.price), currency: offers.priceCurrency || 'USD' };
  }
  return {
    id: 'web_' + hashStr((name || '') + (o.startDate || '')),
    source: 'website',
    title: String(name).slice(0, 160),
    startsAt: o.startDate,
    endsAt: o.endDate,
    venue: loc.name || (typeof loc === 'string' ? loc : undefined),
    city: loc.address?.addressLocality,
    url: o.url || offers?.url || pageUrl,
    image: typeof img === 'string' ? img : undefined,
    price,
    description: o.description ? String(o.description).slice(0, 600) : undefined,
  };
}

async function crawlSite(url: string): Promise<EventItem[]> {
  const html = await fetchText(url);
  if (!html) return [];
  const objs = jsonLdObjects(html);
  const events: EventItem[] = [];
  for (const o of objs) { const e = toEvent(o, url); if (e) events.push(e); }
  return events;
}

export default async function handler(req: any, res: any){
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!kvEnabled()) { res.status(503).json({ error: 'Storage not configured. Add a Vercel KV store.' }); return; }

  try {
    const runFlag = req.query?.run || (req.method === 'GET');
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})) : {};
    const action = body.action || (runFlag ? 'run' : '');

    if (action === 'addSite') {
      const url = String(body.url || '').trim();
      if (!/^https?:\/\//i.test(url)) { res.status(400).json({ error: 'Provide a valid https URL' }); return; }
      const sites = (await kvGet<string[]>('venue_sites')) || [];
      if (!sites.includes(url)) sites.push(url);
      await kvSet('venue_sites', sites);
      res.status(200).json({ ok: true, sites }); return;
    }
    if (action === 'removeSite') {
      const url = String(body.url || '').trim();
      const sites = ((await kvGet<string[]>('venue_sites')) || []).filter(s => s !== url);
      await kvSet('venue_sites', sites);
      res.status(200).json({ ok: true, sites }); return;
    }
    if (action === 'list') {
      const manual = (await kvGet<string[]>('venue_sites')) || [];
      res.status(200).json({ seeds: SEED_SITES, manual, sites: Array.from(new Set([...SEED_SITES, ...manual])) }); return;
    }
    if (action === 'run') {
      const manual = (await kvGet<string[]>('venue_sites')) || [];
      const sites = Array.from(new Set([...SEED_SITES, ...manual]));
      // Crawl all sites in parallel (each failure is isolated and ignored).
      const results = await Promise.all(sites.map(site => crawlSite(site).catch(() => [] as EventItem[])));
      const all: EventItem[] = [];
      const seen = new Set<string>();
      for (const evs of results) {
        for (const e of evs) { if (!seen.has(e.id)) { seen.add(e.id); all.push(e); } }
      }
      // keep only upcoming / today (drop past events)
      const now = Date.now();
      const upcoming = all.filter(e => { const t = Date.parse(e.startsAt); return isNaN(t) || t > now - 12 * 3600 * 1000; }).slice(0, 500);
      await kvSet('web_events', upcoming);
      res.status(200).json({ ok: true, crawled: sites.length, events: upcoming.length }); return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
