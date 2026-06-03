// api/import.ts
// Turn a public social/event LINK that a user pastes or shares into 5to9 into an event card.
//
// This is fully terms-of-service compliant: it does NOT scrape or crawl. It only processes a single
// URL the user explicitly provides, using:
//   1. The platform's OFFICIAL oEmbed endpoint where one exists (TikTok, YouTube, X/Twitter), and
//   2. Standard OpenGraph link-unfurling (the same technique iMessage/Slack use to preview a link)
//      as a fallback for other hosts.
// Claude then reads the public title/caption to extract the event's date, venue, and title.
//
// Required env var: ANTHROPIC_API_KEY
// POST body: { url: string, location?: { city?: string } }
// Response: { event: EventItem | null, raw?: {...} }

type EventItem = {
  id: string; source: string; title: string;
  startsAt: string; endsAt?: string;
  venue?: string; city?: string; lat?: number; lng?: number;
  url?: string; image?: string;
  price?: { min?: number; max?: number; currency?: string; free?: boolean };
  categories?: string[]; description?: string;
};

async function safeJson(url: string): Promise<any> {
  try { const r = await fetch(url, { headers: { 'user-agent': '5to9-linkbot/1.0' } }); if (!r.ok) return null; return await r.json(); }
  catch { return null; }
}
async function safeText(url: string): Promise<string | null> {
  try { const r = await fetch(url, { headers: { 'user-agent': '5to9-linkbot/1.0 (+link preview)' } }); if (!r.ok) return null; return await r.text(); }
  catch { return null; }
}

// Pull title/description/image from a public page's OpenGraph / meta tags (link unfurling).
function parseMeta(html: string){
  const pick = (re: RegExp) => { const m = re.exec(html); return m ? m[1].trim() : ''; };
  const dec = (s: string) => s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  return {
    title: dec(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<]+)<\/title>/i)),
    description: dec(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)),
    image: pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
  };
}

async function gatherFromLink(url: string){
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } })();
  // 1) Official oEmbed endpoints (no scraping, platform-sanctioned)
  let oe: any = null;
  if (/tiktok\.com$/.test(host) || host.endsWith('tiktok.com')) oe = await safeJson('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url));
  else if (host.endsWith('youtube.com') || host === 'youtu.be') oe = await safeJson('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url));
  else if (host.endsWith('twitter.com') || host === 'x.com' || host.endsWith('.x.com')) oe = await safeJson('https://publish.twitter.com/oembed?url=' + encodeURIComponent(url));

  let title = oe?.title || '';
  let description = oe?.title || '';
  let image = oe?.thumbnail_url || '';
  const author = oe?.author_name || '';

  // 2) Fallback / enrich with OpenGraph link unfurling
  if (!title || !image) {
    const html = await safeText(url);
    if (html) { const m = parseMeta(html); title = title || m.title; description = description || m.description || m.title; image = image || m.image; }
  }
  return { host, title, description, image, author };
}

async function extractEvent(text: string, link: string, image: string, host: string, city?: string): Promise<EventItem | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !text) return null;
  const today = new Date().toISOString();
  const prompt = `From this public social post / page text, extract a single nightlife or social EVENT if one is described.
TODAY (ISO): ${today}
USER CITY (fallback): ${city || '(unknown)'}
TEXT: """${text.slice(0, 1500)}"""

Return ONLY JSON: { "isEvent": boolean, "title": string, "startsAt": ISO8601 or "", "venue": string, "city": string, "categories": string[], "description": string }
If no concrete event is present, set isEvent=false. Infer the year as the next future occurrence if only a date is given.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const t = data?.content?.[0]?.text || '';
    const a = t.indexOf('{'); const b = t.lastIndexOf('}');
    if (a < 0 || b < 0) return null;
    const p = JSON.parse(t.slice(a, b + 1));
    if (!p.isEvent) return null;
    return {
      id: 'link_' + Math.abs(hash(link)).toString(36),
      source: host || 'link',
      title: p.title || 'Imported event',
      startsAt: p.startsAt || today,
      venue: p.venue || undefined,
      city: p.city || city || undefined,
      url: link,
      image: image || undefined,
      categories: Array.isArray(p.categories) ? p.categories : undefined,
      description: p.description || undefined,
    };
  } catch { return null; }
}

function hash(str: string){ let h = 0; for (let i = 0; i < str.length; i++){ h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return h; }

export default async function handler(req: any, res: any){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const url: string = (body.url || '').trim();
    const city: string | undefined = body.location?.city;
    if (!/^https?:\/\//i.test(url)) { res.status(400).json({ error: 'Provide a valid https URL' }); return; }
    const g = await gatherFromLink(url);
    const text = [g.title, g.author ? ('by ' + g.author) : '', g.description].filter(Boolean).join('\n');
    const event = await extractEvent(text, url, g.image, g.host, city);
    res.status(200).json({ event, raw: { host: g.host, title: g.title } });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
