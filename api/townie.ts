// api/townie.ts
// Vercel Serverless Function. Aggregates events from licensed sources (Eventbrite, Ticketmaster, SeatGeek, Google Places),
// then asks Claude to rank and explain matches for the user's profile.
//
// Required env vars in Vercel:
//   ANTHROPIC_API_KEY       (required)
//   EVENTBRITE_TOKEN        (optional — leave blank to skip)
//   TICKETMASTER_KEY        (optional)
//   SEATGEEK_CLIENT_ID      (optional)
//   GOOGLE_PLACES_KEY       (optional)
//
// POST body: { profile: {...}, location: { lat, lng, city }, query?: string }
// Response: { events: [...], summary: string }

import { kvGet } from './_store';

type Profile = {
  name?: string; birthYear?: number; gender?: string;
  city?: string; maxDistanceKm?: number;
  interests?: string[]; vibes?: string[]; priceRange?: string;
  daysAvailable?: string[]; timesOfDay?: string[];
  setting?: string; company?: string; crowdSize?: string;
  accessibility?: string[];
};

type EventItem = {
  id: string; source: string; title: string;
  startsAt: string; endsAt?: string;
  venue?: string; city?: string; lat?: number; lng?: number;
  url?: string; image?: string;
  price?: { min?: number; max?: number; currency?: string; free?: boolean };
  categories?: string[]; description?: string;
};

async function safeFetch(url: string, opts?: any): Promise<any> {
  try {
    const r = await fetch(url, opts);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fromEventbrite(lat: number, lng: number, withinKm: number, kw?: string): Promise<EventItem[]> {
  const token = process.env.EVENTBRITE_TOKEN;
  if (!token) return [];
  // Eventbrite public search endpoint
  const url = `https://www.eventbriteapi.com/v3/events/search/?location.latitude=${lat}&location.longitude=${lng}&location.within=${Math.round(withinKm * 1.609)}km${kw ? '&q=' + encodeURIComponent(kw) : ''}&expand=venue,ticket_availability&token=${token}`;
  const data = await safeFetch(url);
  if (!data?.events) return [];
  return data.events.slice(0, 30).map((e: any): EventItem => ({
    id: 'eb_' + e.id,
    source: 'eventbrite',
    title: e.name?.text || 'Event',
    startsAt: e.start?.utc,
    endsAt: e.end?.utc,
    venue: e.venue?.name,
    city: e.venue?.address?.city,
    lat: e.venue?.latitude ? parseFloat(e.venue.latitude) : undefined,
    lng: e.venue?.longitude ? parseFloat(e.venue.longitude) : undefined,
    url: e.url,
    image: e.logo?.url,
    price: e.is_free ? { free: true } : undefined,
    description: e.description?.text?.slice(0, 400),
  }));
}

async function fromTicketmaster(lat: number, lng: number, withinKm: number, kw?: string): Promise<EventItem[]> {
  const key = process.env.TICKETMASTER_KEY;
  if (!key) return [];
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?latlong=${lat},${lng}&radius=${Math.round(withinKm)}&unit=miles&size=40${kw ? '&keyword=' + encodeURIComponent(kw) : ''}&apikey=${key}`;
  const data = await safeFetch(url);
  const events = data?._embedded?.events || [];
  return events.map((e: any): EventItem => ({
    id: 'tm_' + e.id,
    source: 'ticketmaster',
    title: e.name,
    startsAt: e.dates?.start?.dateTime || e.dates?.start?.localDate,
    venue: e._embedded?.venues?.[0]?.name,
    city: e._embedded?.venues?.[0]?.city?.name,
    lat: e._embedded?.venues?.[0]?.location?.latitude ? parseFloat(e._embedded.venues[0].location.latitude) : undefined,
    lng: e._embedded?.venues?.[0]?.location?.longitude ? parseFloat(e._embedded.venues[0].location.longitude) : undefined,
    url: e.url,
    image: (e.images || []).slice().sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0]?.url,
    price: e.priceRanges?.[0] ? { min: e.priceRanges[0].min, max: e.priceRanges[0].max, currency: e.priceRanges[0].currency } : undefined,
    categories: e.classifications?.map((c: any) => c.segment?.name).filter(Boolean),
    description: e.info || e.pleaseNote,
  }));
}

async function fromSeatGeek(lat: number, lng: number, withinKm: number, kw?: string): Promise<EventItem[]> {
  const id = process.env.SEATGEEK_CLIENT_ID;
  if (!id) return [];
  const url = `https://api.seatgeek.com/2/events?lat=${lat}&lon=${lng}&range=${Math.round(withinKm)}mi&per_page=40${kw ? '&q=' + encodeURIComponent(kw) : ''}&client_id=${id}`;
  const data = await safeFetch(url);
  const events = data?.events || [];
  return events.map((e: any): EventItem => ({
    id: 'sg_' + e.id,
    source: 'seatgeek',
    title: e.title,
    startsAt: e.datetime_utc,
    venue: e.venue?.name,
    city: e.venue?.city,
    lat: e.venue?.location?.lat,
    lng: e.venue?.location?.lon,
    url: e.url,
    image: e.performers?.[0]?.image,
    price: e.stats ? { min: e.stats.lowest_price, max: e.stats.highest_price, currency: 'USD' } : undefined,
    categories: [e.type].filter(Boolean),
    description: e.short_title,
  }));
}

async function fromGooglePlaces(lat: number, lng: number, withinKm: number): Promise<EventItem[]> {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return [];
  // Nearby search for bars/clubs/restaurants — adds "what's open now" venue suggestions
  const radius = Math.min(Math.round(withinKm * 1609), 50000);
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&keyword=${encodeURIComponent('nightlife bar event trivia live music')}&key=${key}`;
  const data = await safeFetch(url);
  const places = data?.results || [];
  return places.slice(0, 15).map((p: any): EventItem => ({
    id: 'gp_' + p.place_id,
    source: 'google_places',
    title: p.name,
    startsAt: new Date().toISOString(),
    venue: p.name,
    city: p.vicinity,
    lat: p.geometry?.location?.lat,
    lng: p.geometry?.location?.lng,
    url: `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
    image: p.photos?.[0] ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1000&photoreference=${p.photos[0].photo_reference}&key=${key}` : undefined,
    categories: p.types,
    description: `Open now • Rating: ${p.rating || 'N/A'} (${p.user_ratings_total || 0} reviews)`,
  }));
}

function hashStr(s: string){ let h=0; for(let i=0;i<s.length;i++){ h=(h<<5)-h+s.charCodeAt(i); h|=0; } return Math.abs(h).toString(36); }
function parseGDate(d: any): string {
  const raw = (d?.start_date || d?.when || '').toString();
  const yr = new Date().getFullYear();
  let t = Date.parse(raw + ' ' + yr);
  if (isNaN(t)) t = Date.parse(raw);
  return isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

// Aggregator: events Google has already collected from across the web AND social
// (venue sites, Facebook events, ticketing, etc.) — compliant, no scraping on our side.
// Requires SERPAPI_KEY in Vercel (sign up at serpapi.com).
async function fromGoogleEvents(city: string, query?: string): Promise<EventItem[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  const q = ((query ? query + ' ' : '') + 'events' + (city ? ' in ' + city : '')).trim();
  const url = `https://serpapi.com/search.json?engine=google_events&q=${encodeURIComponent(q)}&hl=en&gl=us&api_key=${key}`;
  const data = await safeFetch(url);
  const list = data?.events_results || [];
  return list.slice(0, 40).map((e: any): EventItem => ({
    id: 'gev_' + hashStr((e.title || '') + (e.date?.start_date || e.date?.when || '')),
    source: 'google_events',
    title: e.title,
    startsAt: parseGDate(e.date),
    venue: e.venue?.name || (Array.isArray(e.address) ? e.address[0] : undefined),
    city: Array.isArray(e.address) ? e.address[e.address.length - 1] : city,
    url: e.link,
    image: e.thumbnail || e.image,
    description: e.description,
    categories: e.ticket_info ? ['Tickets'] : undefined,
  }));
}

async function curateWithClaude(profile: Profile, events: EventItem[], query?: string): Promise<{ ranked: EventItem[]; summary: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || events.length === 0) return { ranked: events, summary: '' };
  
  const compact = events.map(e => ({
    id: e.id, title: e.title, venue: e.venue, city: e.city,
    startsAt: e.startsAt, categories: e.categories,
    price: e.price, description: e.description?.slice(0, 200),
  }));
  
  const prompt = `You are 5to9's event curator. 5to9 is an EVENT FINDER, never a bar or venue finder.
It covers EVERY kind of going-out and EVERY demographic — not just concerts and shows, but sports
watch parties, reality-TV viewing nights, thrift/vintage pop-ups, pick-up sports, run clubs, trivia
nights, comedy, drag, art walks, markets, food crawls, book clubs, gaming meetups, faith/cultural
events, family days, queer nights, 21+ parties — every kind of specific, dated local happening.

YOUR JOB: pick the events that best fit THIS person's specific interests AND their demographic, and
write a one-sentence personal note for each.

HARD RULES:
- ONLY return items that are a specific, dated EVENT. If an item is really just a bar/restaurant/club
  /venue listing with no actual event (e.g. "Open now • Rating 4.2"), DROP it — give it score 0 and
  leave it out of "ranked".
- Match each of the user's interests to concrete events. Try to cover MORE THAN ONE of their interests
  rather than 25 versions of the same thing — reward variety of event type.
- Factor in demographics from the profile (age, gender, relationship status, who they go out with,
  crowd/vibe they want). A 21-year-old wanting a rowdy crowd and a 40-year-old wanting a chill date
  night should get different picks from the same list.
- Strongly prefer events happening TODAY. Distances are in miles.

USER PROFILE: ${JSON.stringify(profile)}
USER QUERY: ${query || '(none)'}
EVENTS: ${JSON.stringify(compact)}

Reply ONLY with JSON: { "summary": "1-2 sentence vibe summary", "ranked": [{ "id": "...", "score": 0-100, "why": "personal note tied to their interest/demographic, 1 sentence" }, ...] }
Top 25 only, best first. Score = interest match + demographic fit + variety + time fit + price fit. Exclude non-events.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) return { ranked: events, summary: '' };
    const data = await r.json();
    const text = data?.content?.[0]?.text || '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < 0) return { ranked: events, summary: '' };
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const scoreById: Record<string, { score: number; why: string }> = {};
    for (const r of (parsed.ranked || [])) {
      scoreById[r.id] = { score: r.score, why: r.why };
    }
    const ranked = events
      .map(e => ({ ...e, _score: scoreById[e.id]?.score ?? 0, _note: scoreById[e.id]?.why || '' }))
      .sort((a, b) => (b as any)._score - (a as any)._score);
    return { ranked, summary: parsed.summary || '' };
  } catch {
    return { ranked: events, summary: '' };
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const profile: Profile = body.profile || {};
    const lat = body.location?.lat ?? 40.7128;
    const lng = body.location?.lng ?? -74.0060;
    const withinKm = profile.maxDistanceKm || 25;
    const query: string | undefined = body.query;
    
    const city = body.location?.city || profile.city || '';

    // INTEREST-DRIVEN SEARCH — instead of one generic "nearby" sweep, query every source
    // ONCE PER INTEREST (run club, trivia, techno, drag, thrift pop-up, pick-up soccer, …)
    // so we surface SPECIFIC events for each thing this user cares about, not just whatever
    // happens to be closest. A blank keyword sweep is kept so we never miss general listings.
    const interests: string[] = Array.isArray(profile.interests) ? profile.interests.filter(Boolean) : [];
    const keywords: (string | undefined)[] = query
      ? [query]
      : [undefined, ...interests.slice(0, 6)]; // undefined = unfiltered nearby sweep

    const dedup = <T extends EventItem>(arr: T[]) => {
      const s = new Set<string>(); const out: T[] = [];
      for (const e of arr) { const k = 'id:' + e.id; if (!s.has(k)) { s.add(k); out.push(e); } }
      return out;
    };

    const batches = await Promise.all(keywords.map(kw => Promise.all([
      fromEventbrite(lat, lng, withinKm, kw),
      fromTicketmaster(lat, lng, withinKm, kw),
      fromSeatGeek(lat, lng, withinKm, kw),
      fromGoogleEvents(city, kw),
    ])));
    const eb = dedup(batches.flatMap(b => b[0]));
    const tm = dedup(batches.flatMap(b => b[1]));
    const sg = dedup(batches.flatMap(b => b[2]));
    const gev = dedup(batches.flatMap(b => b[3]));
    const web = await kvGet<EventItem[]>('web_events').then(x => x || []).catch(() => []);

    // EVENT FINDER — only real, dated events. (Google Places venue search removed:
    // it returned bars/nightclubs, which made the app a location finder, not an event finder.)
    const seen = new Set<string>();
    const merged = [...gev, ...web, ...eb, ...tm, ...sg].filter(e => {
      const k = (e.title || '') + '|' + (e.startsAt || '');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    
    // Drop events outside the user's selected radius (miles), when we have coordinates.
    const R = 3959; const rad = (x: number) => x * Math.PI / 180;
    const inRange = merged.filter((e: any) => {
      if (e.lat == null || e.lng == null) return true;
      const dLat = rad(e.lat - lat), dLng = rad(e.lng - lng);
      const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat)) * Math.cos(rad(e.lat)) * Math.sin(dLng/2)**2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return dist <= withinKm * 1.15;
    });
    // Always prioritize events happening on the day the app is opened.
    const today = new Date().toDateString();
    const todays = inRange.filter((e: any) => { const v = e.startsAt; const t = Date.parse(v || ''); return isNaN(t) ? false : new Date(v).toDateString() === today; });
    const pool = todays.length >= 6 ? todays : inRange;

    const { ranked, summary } = await curateWithClaude(profile, pool, query);

    // Paid/featured events (vendors who paid via PayPal) ride at the top of the feed.
    let featured: EventItem[] = [];
    try {
      const now = Date.now();
      featured = ((await kvGet<EventItem[]>('featured_events')) || []).filter((e: any) => {
        const t = Date.parse(e.startsAt || '');
        return isNaN(t) || t > now - 24 * 3600 * 1000;
      });
    } catch {}
    const featuredIds = new Set(featured.map(e => e.id));
    const finalEvents = [...featured, ...ranked.filter(e => !featuredIds.has(e.id))].slice(0, 60);

    res.status(200).json({
      events: finalEvents,
      summary,
      sources: { eventbrite: eb.length, ticketmaster: tm.length, seatgeek: sg.length, googleEvents: gev.length, website: web.length, featured: featured.length },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
