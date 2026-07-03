// api/townie.ts
// Vercel Serverless Function. Aggregates events from licensed sources (Eventbrite, Ticketmaster, SeatGeek, Google Events),
// then asks Claude to rank and explain matches for the user's profile.
//
// Required env vars in Vercel:
//   ANTHROPIC_API_KEY   (required)
//   EVENTBRITE_TOKEN    (optional — leave blank to skip)
//   TICKETMASTER_KEY    (optional)
//   SEATGEEK_CLIENT_ID  (optional)
//   GOOGLE_PLACES_KEY   (optional)
//
// POST body: { profile: {...}, location: { lat, lng, city }, query?: string }
// Response:  { events: [...], summary: string }

import { kvGet, kvSet, rateLimitOk, clientIp } from './_store';

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

// Run fetch thunks in small staggered batches so we respect upstream rate limits
// (Ticketmaster allows ~5 req/s) instead of firing one giant burst that gets 429'd.
async function inBatches<T>(fns: (() => Promise<T>)[], size = 4, gapMs = 350): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < fns.length; i += size) {
    const chunk = fns.slice(i, i + size);
    out.push(...await Promise.all(chunk.map(f => f())));
    if (i + size < fns.length) await new Promise(r => setTimeout(r, gapMs));
  }
  return out;
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

// segment: Ticketmaster classification (Music / Sports / Arts & Theatre / Comedy / Family /
// Film / Miscellaneous). Sweeping every segment is what guarantees the pool covers ALL event
// kinds instead of whatever a keyword happens to hit (which skewed the feed toward concerts).
async function fromTicketmaster(lat: number, lng: number, withinKm: number, kw?: string, segment?: string): Promise<EventItem[]> {
  const key = process.env.TICKETMASTER_KEY;
  if (!key) return [];
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?latlong=${lat},${lng}&radius=${Math.round(withinKm)}&unit=miles&size=100${kw ? '&keyword=' + encodeURIComponent(kw) : ''}${segment ? '&classificationName=' + encodeURIComponent(segment) : ''}&apikey=${key}`;
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

// taxonomy: SeatGeek taxonomy name (sports / concert / theater / comedy / family / festival /
// dance_performance_tour / classical). Same idea as the Ticketmaster segment sweep.
async function fromSeatGeek(lat: number, lng: number, withinKm: number, kw?: string, taxonomy?: string): Promise<EventItem[]> {
  const id = process.env.SEATGEEK_CLIENT_ID;
  if (!id) return [];
  const url = `https://api.seatgeek.com/2/events?lat=${lat}&lon=${lng}&range=${Math.round(withinKm)}mi&per_page=100${kw ? '&q=' + encodeURIComponent(kw) : ''}${taxonomy ? '&taxonomies.name=' + encodeURIComponent(taxonomy) : ''}&client_id=${id}`;
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
// `label` tags results with the category query that found them, so downstream
// category chips/filters work even when Google returns no type info.
async function fromGoogleEvents(city: string, query?: string, label?: string): Promise<EventItem[]> {
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
    categories: label ? [label] : (e.ticket_info ? ['Tickets'] : undefined),
  }));
}

// ---- CANONICAL CATEGORIES ---------------------------------------------------------
// Every event gets tagged with up to two canonical categories inferred from its source
// classification + title + description. This powers consistent category chips in the app,
// lets the ranker enforce variety, and makes "every kind of event" visible instead of a
// wall of concerts. Rules are checked in order; the first two hits win.
const CATEGORY_RULES: { name: string; re: RegExp }[] = [
  { name: 'Watch Party',        re: /watch part|viewing part|reality tv|game day bar/ },
  { name: 'Comedy',             re: /comedy|stand.?up|improv|comedian|roast(?!ery)/ },
  { name: 'Sports',             re: /\bsports?\b|nba|nfl|mlb|nhl|mls|wnba|soccer|basketball|football|baseball|hockey|wrestling|boxing|\bmma\b|ufc|golf|tennis|rugby|lacrosse|pick.?up|esport|motocross|monster jam|rodeo/ },
  { name: 'Fitness & Outdoors', re: /run club|running|marathon|\b5k\b|\b10k\b|yoga|pilates|workout|fitness|hike|hiking|climb|cycling|bike ride|kayak|paddle|skate|surf/ },
  { name: 'Theatre & Dance',    re: /theat|broadway|musical(?! guest)|\bplay\b|opera|ballet|dance performance|dance recital|drag|cabaret|burlesque|circus|magic show|illusion/ },
  { name: 'Film & Screen',      re: /film|movie|screening|cinema|premiere|documentary|anime night|outdoor movie/ },
  { name: 'Arts & Culture',     re: /\bart\b|gallery|exhibit|museum|paint|sculpt|photograph|poetry|book club|author|reading|literar|craft night|history|heritage/ },
  { name: 'Food & Drink',       re: /food|dinner|brunch|tasting|restaurant|wine|beer|brewery|cocktail|coffee|dessert|bbq|barbecue|taco|pizza|ramen|vegan|culinary|happy hour/ },
  { name: 'Markets & Pop-ups',  re: /market|thrift|vintage|flea|craft fair|pop.?up|bazaar|swap meet|garage sale|makers|artisan/ },
  { name: 'Games & Trivia',     re: /trivia|quiz|bingo|board game|game night|karaoke|open mic|gaming|arcade|d&d|dungeons|poker|chess/ },
  { name: 'Classes & Workshops',re: /class|workshop|seminar|lecture|course|lesson|bootcamp|paint and sip|paint & sip|cooking class|dance class|learn to/ },
  { name: 'Networking & Tech',  re: /network|conference|summit|expo|career|startup|tech meetup|hackathon|entrepreneur|business mixer|job fair/ },
  { name: 'Nightlife & Parties',re: /party|club night|nightlife|\bdj\b|dance night|rave|rooftop|silent disco|21\+|after ?dark|bar crawl/ },
  { name: 'Festivals & Fairs',  re: /festival|fair(?!field)|carnival|parade|celebration|fest\b|block party|street fair/ },
  { name: 'Family & Kids',      re: /family|kids|children|all ages|toddler|storytime|petting zoo|puppet/ },
  { name: 'Community & Causes', re: /charity|fundrais|volunteer|gala|benefit|community|cultural|faith|church|temple|mosque|pride|holiday|seasonal/ },
  { name: 'Social & Dating',    re: /speed dating|singles|mixer|meetup|social club|new in town|make friends/ },
  { name: 'Fashion & Style',    re: /fashion|runway|style|beauty|makeup|sneaker/ },
  { name: 'Conventions',        re: /convention|comic con|comicon|expo hall|fan fest|cosplay/ },
  { name: 'Live Music',         re: /concert|music|band|singer|rapper|hip.?hop|jazz|techno|edm|orchestra|symphony|choir|acoustic|indie|rock|country|r&b|reggae|latin night|tour\b/ },
];
function normalizeCategories(e: EventItem): EventItem {
  const hay = ((e.categories || []).join(' ') + ' ' + (e.title || '') + ' ' + (e.description || '')).toLowerCase();
  const tags: string[] = [];
  for (const c of CATEGORY_RULES) {
    if (tags.length >= 2) break;
    if (c.re.test(hay)) tags.push(c.name);
  }
  const orig = (e.categories || []).map(c => String(c)).filter(c =>
    c && c !== 'Tickets' && !tags.some(t => t.toLowerCase() === c.toLowerCase()));
  const categories = [...tags, ...orig].slice(0, 3);
  return { ...e, categories: categories.length ? categories : ['Local Event'] };
}

// Crisp, type-based fallback images. Source images from Google Events (and some social
// posts) come back as tiny, blurry thumbnails; we swap those for a clean stock image that
// matches the event type so every card looks sharp. Real high-res images (Ticketmaster /
// SeatGeek / Eventbrite) are kept as-is.
const IMG = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;
const TYPE_IMAGES: { re: RegExp; url: string }[] = [
  { re: /comedy|stand.?up|open mic|improv/, url: IMG('photo-1585699324551-f6c309eedeca') },
  { re: /watch party|game day|sports|nba|nfl|soccer|basketball|football|pick.?up|hockey|baseball/, url: IMG('photo-1461896836934-ffe607ba8211') },
  { re: /film|movie|screening|cinema|premiere|documentary/, url: IMG('photo-1489599849927-2ee91cede3ba') },
  { re: /market|thrift|pop.?up|vintage|flea|craft fair|bazaar|makers/, url: IMG('photo-1488459716781-31db52582fe9') },
  { re: /food|dinner|brunch|tasting|restaurant|wine|beer|brewery|cocktail|culinary/, url: IMG('photo-1414235077428-338989a2e8c0') },
  { re: /art|gallery|paint|exhibit|museum|poetry|book|author/, url: IMG('photo-1531058020387-3be344556be6') },
  { re: /trivia|game night|board game|bingo|quiz|karaoke|gaming|arcade|esport/, url: IMG('photo-1611996575749-79a3a250f948') },
  { re: /class|workshop|seminar|lecture|course|bootcamp|learn/, url: IMG('photo-1522202176988-66273c2fd55f') },
  { re: /network|conference|summit|expo|career|startup|hackathon|business/, url: IMG('photo-1540575467063-178a50c2df87') },
  { re: /run club|running|marathon|5k|fitness|yoga|workout|cycle|hike|climb/, url: IMG('photo-1517649763962-0c623066013b') },
  { re: /theat|play|musical|broadway|opera|ballet|drag|cabaret|circus/, url: IMG('photo-1507924538820-ede94a04019d') },
  { re: /family|kids|children|storytime|toddler/, url: IMG('photo-1472162072942-cd5147eb3902') },
  { re: /festival|fair|carnival|parade|celebration|block party/, url: IMG('photo-1533174072545-7a4b6ad7a6c3') },
  { re: /charity|fundrais|volunteer|gala|benefit|community|pride/, url: IMG('photo-1559027615-cd4628902d4a') },
  { re: /speed dating|singles|mixer|social club/, url: IMG('photo-1529156069898-49953e39b3ac') },
  { re: /fashion|runway|style|beauty|sneaker/, url: IMG('photo-1509631179647-0177331693ae') },
  { re: /convention|comic con|cosplay|fan fest|anime/, url: IMG('photo-1542751371-adc38448a05e') },
  { re: /concert|music|dj|band|rave|techno|hip.?hop|jazz|live music|edm|orchestra/, url: IMG('photo-1470229722913-7c0e2dbbafd3') },
  { re: /party|club|nightlife|dance/, url: IMG('photo-1514525253161-7a46d19cd819') },
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
    if (!nt) { out.push(e); continue; } // keep untitled rather than collapse
    const key = nt + '|' + (e.startsAt || '').slice(0, 10);
    if (seen.has(key)) continue;
    seen.add(key); out.push(e);
  }
  return out;
}

type Taste = { liked?: string[]; passed?: string[] };

async function curateWithClaude(profile: Profile, events: EventItem[], query?: string, taste?: Taste): Promise<{ ranked: EventItem[]; summary: string; ai: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || events.length === 0) return { ranked: events, summary: '', ai: key ? 'no_events' : 'no_key' };

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
- FEED VARIETY IS MANDATORY when USER QUERY is empty: the top 20 must span MULTIPLE canonical
  categories (music, sports, comedy, food & drink, markets, arts, classes, family, nightlife, …).
  Never let one category — especially concerts — monopolize the top of the feed. If two events are
  close in score, prefer the one whose category is less represented above it.
- Factor in demographics from the profile (age, gender, relationship status, who they go out with,
  crowd/vibe they want). A 21-year-old wanting a rowdy crowd and a 40-year-old wanting a chill date
  night should get different picks from the same list.
- Strongly prefer events happening TODAY. Distances are in miles.
- EXACT SEARCH: if USER QUERY is set, the user is explicitly asking for something specific
  (an artist, team, genre, venue, or event type like "drag brunch" or "Celtics watch party").
  Return ONLY events that genuinely match that query, rank the closest matches first, and do
  NOT pad the list with unrelated events. If nothing matches well, return few or none rather
  than filler. When USER QUERY is empty, use the profile to personalize as usual.

- TASTE LEARNING: if a TASTE PROFILE is provided below, it is LEARNED BEHAVIOR (what this user
  actually saved vs. passed on) and outweighs their static interest tags when the two conflict.
  Boost events similar in type/genre/vibe to ones they SAVED; score events similar to ones they
  PASSED on lower (unless they match an explicit USER QUERY). Never exclude an event solely for
  resembling a passed one — just rank it below fresher matches.

USER PROFILE: ${JSON.stringify(profile)}
TASTE PROFILE: ${taste && ((taste.liked?.length || 0) + (taste.passed?.length || 0)) > 0
    ? JSON.stringify({ saved: (taste.liked || []).slice(-40), passed: (taste.passed || []).slice(-40) })
    : '(none yet)'}
USER QUERY: ${query || '(none)'}
EVENTS: ${JSON.stringify(compact)}

Reply ONLY with JSON: { "summary": "1-2 sentence vibe summary", "ranked": [{ "id": "...", "score": 0-100, "why": "personal note tied to their interest/demographic, 1 sentence" }, ...] }
Return AS MANY matching events as there are — do not cap the list. Rank best first. Score = interest match + demographic fit + variety + time fit + price fit. Exclude only true non-events (bare venue listings).`;

  // Current models with a fallback chain — the old hardcoded claude-3-5-sonnet-20241022 was
  // retired, which made every ranking call fail SILENTLY (unranked feed, no notes, no summary).
  // We now try current models in order and surface the AI status in the response so a ranking
  // outage is visible in `sources.ai` instead of invisible.
  const MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];
  let lastErr = 'unknown';
  for (const model of MODELS) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!r.ok) { lastErr = model + ':http_' + r.status; continue; }
      const data = await r.json();
      const text = data?.content?.[0]?.text || '';
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart < 0 || jsonEnd < 0) { lastErr = model + ':bad_json'; continue; }
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const scoreById: Record<string, { score: number; why: string }> = {};
      for (const rk of (parsed.ranked || [])) {
        scoreById[rk.id] = { score: rk.score, why: rk.why };
      }
      const ranked = events
        .map(e => ({ ...e, _score: scoreById[e.id]?.score ?? 0, _note: scoreById[e.id]?.why || '' }))
        .sort((a, b) => (b as any)._score - (a as any)._score);
      return { ranked, summary: parsed.summary || '', ai: 'ok:' + model };
    } catch (e: any) {
      lastErr = model + ':' + (e?.message || 'error').slice(0, 60);
    }
  }
  return { ranked: events, summary: '', ai: 'failed:' + lastErr };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  // Protect the metered upstream quotas (Anthropic / SerpApi) from abuse.
  if (!(await rateLimitOk('townie:' + clientIp(req), 30))) {
    res.status(429).json({ error: 'Too many requests — try again in a minute.' }); return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const profile: Profile = body.profile || {};
    const withinKm = profile.maxDistanceKm || 25;
    const query: string | undefined = body.query;
    // Taste learning: the app sends short lists of event titles the user saved vs. passed on,
    // so the ranker personalizes from real behavior, not just onboarding tags.
    const taste: Taste = {
      liked: Array.isArray(body.taste?.liked) ? body.taste.liked.filter((x: any) => typeof x === 'string').slice(-40) : [],
      passed: Array.isArray(body.taste?.passed) ? body.taste.passed.filter((x: any) => typeof x === 'string').slice(-40) : [],
    };
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

    // Event TYPES 5to9 always hunts for, so every kind of happening — from watch parties
    // and run clubs to markets, classes, conventions, fundraisers and festivals — shows up
    // even when the user never listed it as an interest. This list is what makes 5to9 an
    // event finder for EVERYTHING, not a concert app.
    const EVENT_TYPE_SEEDS = [
      'sports watch party', 'reality tv watch party', 'trivia night', 'run club',
      'thrift pop-up', 'pick-up sports', 'comedy open mic', 'drag show',
      'live music', 'art walk', 'food festival', 'book club', 'game night',
      'farmers market', 'night market', 'flea market', 'karaoke night',
      'film screening', 'art exhibit', 'museum event', 'poetry reading',
      'dance class', 'cooking class', 'workshop', 'networking event',
      'tech meetup', 'wine tasting', 'beer festival', 'street fair',
      'cultural festival', 'charity fundraiser', 'fashion show', 'car show',
      'convention', 'esports tournament', 'speed dating', 'yoga class',
      '5k race', 'holiday market', 'paint and sip', 'improv show',
      'salsa dancing', 'outdoor movie', 'family festival', 'block party',
    ];

    // Ticketmaster classifications + SeatGeek taxonomies: sweeping these guarantees FULL
    // coverage of every event kind those APIs carry (sports, comedy, theatre, family, film,
    // festivals, …) — a keyword can miss things; the category sweep can't.
    const TM_SEGMENTS = ['Music', 'Sports', 'Arts & Theatre', 'Comedy', 'Family', 'Film', 'Miscellaneous'];
    const SG_TAXONOMIES = ['concert', 'sports', 'theater', 'comedy', 'family', 'festival', 'dance_performance_tour', 'classical'];

    // Google Events (SerpApi, metered): a rotation of broad category queries so the web/social
    // sweep also spans every kind of event instead of only generic "events in <city>".
    const GEV_CATEGORY_QUERIES = [
      'concerts and live music', 'sports games', 'comedy shows', 'theatre and performing arts',
      'food and drink festivals', 'markets and pop-ups', 'art exhibitions', 'nightlife and parties',
      'classes and workshops', 'family friendly events', 'outdoor and fitness events', 'festivals and fairs',
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
    const cacheKey = `pool:v3:${citySlug}:${dayStamp}`;
    const POOL_TTL = 25 * 60 * 1000;

    let merged: EventItem[];
    let sourceCounts: Record<string, any>;
    const cachedPool = query ? null : await kvGet<{ at: number; events: EventItem[]; sources?: any }>(cacheKey).catch(() => null);

    if (cachedPool && Array.isArray(cachedPool.events) && Date.now() - cachedPool.at < POOL_TTL) {
      merged = cachedPool.events;
      sourceCounts = { ...(cachedPool.sources || {}), cached: true };
    } else {
      const kwInterests = uniqKw(interests).filter(Boolean) as string[];
      // Eventbrite: cheap and high-quota — fan out over the full seed list + interests.
      const ebKeywords = query ? [query] : uniqKw([undefined, ...interests, ...EVENT_TYPE_SEEDS]);
      // Google Events runs on SerpApi (metered). Interests first, then the category rotation.
      const gevKeywords = query
        ? [query]
        : uniqKw([undefined, 'watch party', ...interests, ...GEV_CATEGORY_QUERIES]).slice(0, 14);

      // Ticketmaster: one call per classification segment (full-catalog coverage) + interests.
      const tmCalls = hasAnchor
        ? (query
            ? [() => fromTicketmaster(lat!, lng!, withinKm, query)]
            : [
                ...TM_SEGMENTS.map(seg => () => fromTicketmaster(lat!, lng!, withinKm, undefined, seg)),
                ...kwInterests.map(kw => () => fromTicketmaster(lat!, lng!, withinKm, kw)),
              ])
        : [];
      // SeatGeek: unfiltered sweep + one call per taxonomy + interests.
      const sgCalls = hasAnchor
        ? (query
            ? [() => fromSeatGeek(lat!, lng!, withinKm, query)]
            : [
                () => fromSeatGeek(lat!, lng!, withinKm),
                ...SG_TAXONOMIES.map(tx => () => fromSeatGeek(lat!, lng!, withinKm, undefined, tx)),
                ...kwInterests.map(kw => () => fromSeatGeek(lat!, lng!, withinKm, kw)),
              ])
        : [];
      const ebCalls = hasAnchor ? ebKeywords.map(kw => () => fromEventbrite(lat!, lng!, withinKm, kw)) : [];

      const [tmBatches, sgBatches, ebBatches, gevResults] = await Promise.all([
        inBatches(tmCalls, 4, 350),   // respect Ticketmaster's ~5 req/s limit
        inBatches(sgCalls, 6, 250),
        Promise.all(ebCalls.map(f => f())),
        Promise.all(gevKeywords.map(kw => fromGoogleEvents(city, kw, kw))),
      ]);
      const tm = dedup(tmBatches.flat());
      const sg = dedup(sgBatches.flat());
      const eb = dedup(ebBatches.flat());
      const gev = dedup(gevResults.flat());
      let web = await kvGet<EventItem[]>('web_events').then(x => x || []).catch(() => []);
      // On an explicit search, crawled events must actually mention a search term — otherwise
      // unrelated academic/admin calendar entries flood the query results.
      if (query) {
        const terms = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        web = web.filter(e => {
          const hay = ((e.title || '') + ' ' + (e.description || '') + ' ' + (e.categories || []).join(' ')).toLowerCase();
          return terms.some(t => hay.includes(t));
        });
      }
      // Real, dated events only; de-dup across sources by normalized title + day; canonical
      // category tags on every event; crisp type-matched images.
      merged = dedupeAcrossSources([...gev, ...web, ...eb, ...tm, ...sg])
        .map(e => normalizeCategories(e))
        .map(e => ({ ...e, image: bestImage(e) }));
      sourceCounts = { eventbrite: eb.length, ticketmaster: tm.length, seatgeek: sg.length, googleEvents: gev.length, website: web.length, cached: false };
      if (!query) await kvSet(cacheKey, { at: Date.now(), events: merged, sources: sourceCounts }, 3600).catch(() => {});
    }

    // Drop events outside the user's selected radius (miles). THE OLD NYC LEAK: crawled
    // web_events span all launch cities (Boston/NYC/Chicago/Seattle) and JSON-LD events carry
    // no coordinates, so they skipped the distance filter and showed up in EVERY city's feed.
    // Now: events WITH coords get the distance check; events WITHOUT coords must match the
    // user's city by name (kept only if neither side has a city to compare).
    const cityNorm = (city || '').trim().toLowerCase();
    const sameCity = (ec?: string) => {
      if (!cityNorm) return true;                    // no user city to compare against
      const e = (ec || '').trim().toLowerCase();
      if (!e) return true;                           // event has no city info — can't attribute
      return e.includes(cityNorm) || cityNorm.includes(e);
    };
    const R = 3959; const rad = (x: number) => x * Math.PI / 180;
    const inRange = merged.filter((e: any) => {
      if (hasAnchor && e.lat != null && e.lng != null) {
        const dLat = rad(e.lat - lat!), dLng = rad(e.lng - lng!);
        const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat!)) * Math.cos(rad(e.lat)) * Math.sin(dLng/2)**2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return dist <= withinKm * 1.15;
      }
      return sameCity(e.city);
    });
    // Always prioritize events happening on the day the app is opened — in the USER'S timezone.
    // The old UTC comparison meant that from ~4-5pm Pacific onward, "today" had already rolled
    // over to tomorrow, deprioritizing tonight's events for exactly the people opening the app
    // to go out tonight. The app sends tzOffsetMinutes (JS getTimezoneOffset: minutes WEST of UTC).
    const offMin = typeof body.tzOffsetMinutes === 'number' ? body.tzOffsetMinutes : 0;
    const localDay = (ms: number) => new Date(ms - offMin * 60000).toISOString().slice(0, 10);
    const todayStr = localDay(Date.now());
    const dateOnly = (v: string) => /T00:00:00(\.000)?Z?$/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v);
    const todays = inRange.filter((e: any) => {
      const v = e.startsAt || ''; const t = Date.parse(v);
      if (isNaN(t)) return false;
      // Date-only events (midnight UTC) name their calendar day directly — don't tz-shift them.
      return (dateOnly(v) ? v.slice(0, 10) : localDay(t)) === todayStr;
    });
    const pool = todays.length >= 6 ? todays : inRange;

    // PER-USER RANKING CACHE: the AI curation call is the most expensive step and its inputs
    // (city pool + this user's profile/taste) rarely change within minutes. Cache the curated
    // result for 10 min so repeat opens are instant and cost zero AI tokens. Searches skip it.
    let ranked: EventItem[]; let summary: string; let ai: string; let rankCached = false;
    const profSig = hashStr(JSON.stringify([profile, taste.liked, taste.passed]));
    const rankKey = `rank:v2:${citySlug}:${dayStamp}:${profSig}`;
    const rankHit = query ? null : await kvGet<{ ranked: EventItem[]; summary: string; ai: string }>(rankKey).catch(() => null);
    if (rankHit && Array.isArray(rankHit.ranked) && rankHit.ranked.length > 0) {
      ranked = rankHit.ranked; summary = rankHit.summary || ''; ai = rankHit.ai || 'ok:cache'; rankCached = true;
    } else {
      ({ ranked, summary, ai } = await curateWithClaude(profile, pool, query, taste));
      if (!query && ai.startsWith('ok')) await kvSet(rankKey, { ranked, summary, ai }, 600).catch(() => {});
    }

    // Respect the AI's exclusions instead of padding the feed with its rejects (the old
    // behavior sent 0%-match cards like university seminars for a "watch party" search).
    // - Explicit search: return ONLY genuine matches — few or none beats filler.
    // - Default feed: use the scored picks whenever there are enough of them.
    let curated: EventItem[] = ranked;
    if (ai.startsWith('ok')) {
      const scored = (ranked as any[]).filter(e => (e._score ?? 0) > 0);
      if (query) curated = scored;
      else if (scored.length >= 8) curated = scored;
    }

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
    const finalEvents = [...featured, ...curated.filter(e => !featuredIds.has(e.id))].slice(0, 120);

    res.status(200).json({
      events: finalEvents,
      summary,
      anchor: hasAnchor ? { lat, lng, city: city || undefined } : { city: city || undefined },
      sources: { ...sourceCounts, featured: featured.length, ai, rankCached },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}
