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

import { kvGet, kvSet } from './_store';

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

// City -> [lat, lng] so we can anchor the search when GPS isn't available, WITHOUT silently
// defaulting everyone to New York. Covers launch cities + major US metros; extend freely.
const CITY_COORDS: Record<string, [number, number]> = {
  'seattle': [47.6062, -122.3321], 'boston': [42.3601, -71.0589],
  'new york': [40.7128, -74.0060], 'new york city': [40.7128, -74.0060], 'nyc': [40.7128, -74.0060],
  'manhattan': [40.7831, -73.9712], 'brooklyn': [40.6782, -73.9442],
  'chicago': [41.8781, -87.6298], 'los angeles': [34.0522, -118.2437], 'la': [34.0522, -118.2437],
  'san francisco': [37.7749, -122.4194], 'sf': [37.7749, -122.4194], 'oakland': [37.8044, -122.2712],
  'austin': [30.2672, -97.7431], 'denver': [39.7392, -104.9903], 'portland': [45.5152, -122.6784],
  'washington': [38.9072, -77.0369], 'washington dc': [38.9072, -77.0369], 'dc': [38.9072, -77.0369],
  'philadelphia': [39.9526, -75.1652], 'miami': [25.7617, -80.1918], 'atlanta': [33.7490, -84.3880],
  'dallas': [32.7767, -96.7970], 'houston': [29.7604, -95.3698], 'phoenix': [33.4484, -112.0740],
  'san diego': [32.7157, -117.1611], 'nashville': [36.1627, -86.7816], 'new orleans': [29.9511, -90.0715],
  'minneapolis': [44.9778, -93.2650], 'detroit': [42.3314, -83.0458], 'cambridge': [42.3736, -71.1097],
};

async function safeFetch(url: string, opts?: any): Promise<any> {
  // Per-source timeout so one slow API can never hang the whole serverless request.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { ...(opts || {}), signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function fromEventbrite(lat: number, lng: number, withinKm: number, kw?: string): Promise<EventItem[]> {
  const token = process.env.EVENTBRITE_TOKEN;
  if (!token) return [];
  // Eventbrite public search endpoint
  const url = `https://www.eventbriteapi.com/v3/events/search/?location.latitude=${lat}&location.longitude=${lng}&location.within=${Math.round(withinKm * 1.609)}km${kw ? '&q=' + encodeURIComponent(kw) : ''}&expand=venue,ticket_availability&token=${token}`;
  const data = await safeFetch(url);
  if (!data?.events) return [];
  return data.events.slice(0, 60).map((e: any): EventItem => ({
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
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?latlong=${lat},${lng}&radius=${Math.round(withinKm)}&unit=miles&size=100${kw ? '&keyword=' + encodeURIComponent(kw) : ''}&apikey=${key}`;
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
  const url = `https://api.seatgeek.com/2/events?lat=${lat}&lon=${lng}&range=${Math.round(withinKm)}mi&per_page=100${kw ? '&q=' + encodeURIComponent(kw) : ''}&client_id=${id}`;
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
  return list.slice(0, 60).map((e: any): EventItem => ({
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

// Crisp, type-based fallback images. Source images from Google Events (and some social
// posts) come back as tiny, blurry thumbnails; we swap those for a clean stock image that
// matches the event type so every card looks sharp. Real high-res images (Ticketmaster /
// SeatGeek / Eventbrite) are kept as-is.
const IMG = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;
const TYPE_IMAGES: { re: RegExp; url: string }[] = [
  { re: /concert|music|dj|band|festival|rave|techno|hip.?hop|jazz|live music/, url: IMG('photo-1470229722913-7c0e2dbbafd3') },
  { re: /watch party|game day|sports|nba|nfl|soccer|basketball|football|pick.?up/, url: IMG('photo-1461896836934-ffe607ba8211') },
  { re: /comedy|stand.?up|open mic|improv/, url: IMG('photo-1585699324551-f6c309eedeca') },
  { re: /party|club|nightlife|dance/, url: IMG('photo-1514525253161-7a46d19cd819') },
  { re: /food|dinner|brunch|tasting|restaurant|wine|beer|brewery/, url: IMG('photo-1414235077428-338989a2e8c0') },
  { re: /art|gallery|paint|exhibit|museum/, url: IMG('photo-1531058020387-3be344556be6') },
  { re: /trivia|game night|board game|bingo|quiz/, url: IMG('photo-1611996575749-79a3a250f948') },
  { re: /thrift|pop.?up|market|vintage|flea|craft fair/, url: IMG('photo-1488459716781-31db52582fe9') },
  { re: /run club|running|fitness|yoga|workout|cycle/, url: IMG('photo-1517649763962-0c623066013b') },
  { re: /theat|play|musical|broadway|drag|cabaret/, url: IMG('photo-1507924538820-ede94a04019d') },
];
const DEFAULT_IMG = IMG('photo-1492684223066-81342ee5ff30');
function bestImage(e: EventItem): string {
  // ALWAYS use a clean type-based placeholder. Event-supplied photos came back blurry and
  // inconsistent, so every card is standardized on a sharp stock image matching its type.
  const hay = ((e.categories || []).join(' ') + ' ' + (e.title || '')).toLowerCase();
  for (const t of TYPE_IMAGES) if (t.re.test(hay)) return t.url;
  return DEFAULT_IMG;
}

// Cross-source de-dup: the same event from Ticketmaster + SeatGeek + Google Events has slightly
// different titles, so we key on a normalized title + the event day rather than exact strings.
function normTitle(t?: string): string {
  return (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an|live|presents|tour|concert)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function dedupeAcrossSources(arr: EventItem[]): EventItem[] {
  const seen = new Set<string>(); const out: EventItem[] = [];
  for (const e of arr) {
    const nt = normTitle(e.title).slice(0, 36);
    if (!nt) { out.push(e); continue; }                 // keep untitled rather than collapse
    const key = nt + '|' + (e.startsAt || '').slice(0, 10);
    if (seen.has(key)) continue;
    seen.add(key); out.push(e);
  }
  return out;
}

async function curateWithClaude(profile: Profile, events: EventItem[], query?: string): Promise<{ ranked: EventItem[]; summary: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || events.length === 0) return { ranked: events, summary: '' };
  
  // Rank up to 200 events with the AI (keeps cost/context sane); any beyond that still
  // get returned, just unranked at the end, so we never hide matching events.
  const compact = events.slice(0, 200).map(e => ({
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
- EXACT SEARCH: if USER QUERY is set, the user is explicitly asking for something specific
  (an artist, team, genre, venue, or event type like "drag brunch" or "Celtics watch party").
  Return ONLY events that genuinely match that query, rank the closest matches first, and do
  NOT pad the list with unrelated events. If nothing matches well, return few or none rather
  than filler. When USER QUERY is empty, use the profile to personalize as usual.

USER PROFILE: ${JSON.stringify(profile)}
USER QUERY: ${query || '(none)'}
EVENTS: ${JSON.stringify(compact)}

Reply ONLY with JSON: { "summary": "1-2 sentence vibe summary", "ranked": [{ "id": "...", "score": 0-100, "why": "personal note tied to their interest/demographic, 1 sentence" }, ...] }
Return AS MANY matching events as there are — do not cap the list. Rank best first. Score = interest match + demographic fit + variety + time fit + price fit. Exclude only true non-events (bare venue listings).`;

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
        max_tokens: 8000,
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
    const withinKm = profile.maxDistanceKm || 25;
    const query: string | undefined = body.query;
    const city = body.location?.city || profile.city || '';

    // Resolve a location anchor WITHOUT defaulting to New York. Prefer real device coords;
    // else map the city name to known coordinates; else leave unanchored (we then skip
    // distance filtering and rely on the city-based Google Events search).
    let lat: number | undefined = typeof body.location?.lat === 'number' ? body.location.lat : undefined;
    let lng: number | undefined = typeof body.location?.lng === 'number' ? body.location.lng : undefined;
    if ((lat == null || lng == null) && city) {
      const c = CITY_COORDS[city.trim().toLowerCase()];
      if (c) { lat = c[0]; lng = c[1]; }
    }
    const hasAnchor = lat != null && lng != null;

    // INTEREST-DRIVEN SEARCH — instead of one generic "nearby" sweep, query every source
    // ONCE PER INTEREST (run club, trivia, techno, drag, thrift pop-up, pick-up soccer, …)
    // so we surface SPECIFIC events for each thing this user cares about, not just whatever
    // happens to be closest. A blank keyword sweep is kept so we never miss general listings.
    const interests: string[] = Array.isArray(profile.interests) ? profile.interests.filter(Boolean) : [];

    // Event TYPES 5to9 always hunts for, so niche going-out (watch parties, reality-TV
    // nights, thrift pop-ups, run clubs, trivia, pick-up sports) shows up even when the
    // user never listed them as an interest. This is what makes it an event finder for
    // EVERY kind of happening rather than only the user's stated tags.
    const EVENT_TYPE_SEEDS = [
      'sports watch party', 'reality tv watch party', 'trivia night', 'run club',
      'thrift pop-up', 'pick-up sports', 'comedy open mic', 'drag show',
      'live music', 'art walk', 'food festival', 'book club', 'game night',
    ];

    const dedup = <T extends EventItem>(arr: T[]) => {
      const s = new Set<string>(); const out: T[] = [];
      for (const e of arr) { const k = 'id:' + e.id; if (!s.has(k)) { s.add(k); out.push(e); } }
      return out;
    };
    // De-dupe a keyword list while keeping a single "undefined" (unfiltered) sweep.
    const uniqKw = (arr: (string | undefined)[]) => {
      const s = new Set<string>(); const out: (string | undefined)[] = [];
      for (const k of arr) { const key = (k ?? '__all__').toLowerCase(); if (!s.has(key)) { s.add(key); out.push(k); } }
      return out;
    };
    // ---- POOL CACHE -----------------------------------------------------------------
    // The expensive part (dozens of source calls + the metered SerpApi quota) is identical for
    // everyone in the same city on the same day, so we cache the merged event POOL in Redis with
    // a short TTL. Per-user ranking still runs fresh below. Specific text searches skip the cache.
    const dayStamp = new Date().toISOString().slice(0, 10);
    const citySlug = (city || '').toLowerCase().trim() || (hasAnchor ? `${lat!.toFixed(2)},${lng!.toFixed(2)}` : 'all');
    const cacheKey = `pool:v2:${citySlug}:${dayStamp}`;
    const POOL_TTL = 25 * 60 * 1000;

    let merged: EventItem[];
    let sourceCounts: Record<string, any>;
    const cachedPool = query ? null : await kvGet<{ at: number; events: EventItem[]; sources?: any }>(cacheKey).catch(() => null);

    if (cachedPool && Array.isArray(cachedPool.events) && Date.now() - cachedPool.at < POOL_TTL) {
      merged = cachedPool.events;
      sourceCounts = { ...(cachedPool.sources || {}), cached: true };
    } else {
      // Cheap, high-quota sources (Ticketmaster / SeatGeek / Eventbrite): fan out widely.
      const cheapKeywords = query ? [query] : uniqKw([undefined, ...interests, ...EVENT_TYPE_SEEDS]);
      // Google Events runs on SerpApi (metered). Keep short but ALWAYS include "watch party".
      const gevKeywords = query
        ? [query]
        : uniqKw([undefined, 'watch party', ...interests, ...EVENT_TYPE_SEEDS]).slice(0, 14);
      // TM/SG/EB need coordinates, so only query them when anchored. Google Events uses the city.
      const [cheapBatches, gevResults] = await Promise.all([
        hasAnchor
          ? Promise.all(cheapKeywords.map(kw => Promise.all([
              fromEventbrite(lat!, lng!, withinKm, kw),
              fromTicketmaster(lat!, lng!, withinKm, kw),
              fromSeatGeek(lat!, lng!, withinKm, kw),
            ])))
          : Promise.resolve([] as EventItem[][][]),
        Promise.all(gevKeywords.map(kw => fromGoogleEvents(city, kw))),
      ]);
      const eb = dedup(cheapBatches.flatMap(b => b[0]));
      const tm = dedup(cheapBatches.flatMap(b => b[1]));
      const sg = dedup(cheapBatches.flatMap(b => b[2]));
      const gev = dedup(gevResults.flat());
      const web = await kvGet<EventItem[]>('web_events').then(x => x || []).catch(() => []);
      // Real, dated events only; de-dup across sources by normalized title + day; crisp images.
      merged = dedupeAcrossSources([...gev, ...web, ...eb, ...tm, ...sg]).map(e => ({ ...e, image: bestImage(e) }));
      sourceCounts = { eventbrite: eb.length, ticketmaster: tm.length, seatgeek: sg.length, googleEvents: gev.length, website: web.length, cached: false };
      if (!query) await kvSet(cacheKey, { at: Date.now(), events: merged, sources: sourceCounts }).catch(() => {});
    }
    
    // Drop events outside the user's selected radius (miles) — only when we have an anchor.
    // Without coordinates we keep everything (city-based results are already local).
    const R = 3959; const rad = (x: number) => x * Math.PI / 180;
    const inRange = hasAnchor ? merged.filter((e: any) => {
      if (e.lat == null || e.lng == null) return true;
      const dLat = rad(e.lat - lat!), dLng = rad(e.lng - lng!);
      const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat!)) * Math.cos(rad(e.lat)) * Math.sin(dLng/2)**2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return dist <= withinKm * 1.15;
    }) : merged;
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
    const finalEvents = [...featured, ...ranked.filter(e => !featuredIds.has(e.id))].slice(0, 120);

    res.status(200).json({
      events: finalEvents,
      summary,
      anchor: hasAnchor ? { lat, lng, city: city || undefined } : { city: city || undefined },
      sources: { ...sourceCounts, featured: featured.length },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
