import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { API_BASE } from './config';
import { getTaste } from './storage';
import type { Profile, EventItem, Loc } from './types';


// Resolve the user's REAL location. GPS first (most precise, with a reverse-geocoded city);
// otherwise the city they entered in onboarding. We NEVER fabricate New York coordinates — if
// we only have a city name we send that and let the backend resolve it.
export async function resolveLocation(profile: Profile): Promise<Loc> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const ll: Loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      try {
        const rg = await Location.reverseGeocodeAsync(pos.coords);
        const c = rg?.[0]?.city || rg?.[0]?.subregion;
        if (c) ll.city = c;
      } catch {}
      return ll;
    }
  } catch {}
  const city = (profile.city || '').trim();
  if (city) {
    try {
      const g = await Location.geocodeAsync(city);
      if (g && g[0]) return { lat: g[0].latitude, lng: g[0].longitude, city };
    } catch {}
    return { city };           // no coords — backend maps the city, never NYC by default
  }
  return {};
}

// Shared hook so every screen (Discover, Standouts, Saved) resolves location identically and
// only fetches once it's known — no screen silently shows New York while waiting.
export function useResolvedLocation(profile: Profile): Loc | null {
  const [loc, setLoc] = useState<Loc | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => { const l = await resolveLocation(profile); if (alive) setLoc(l); })();
    return () => { alive = false; };
  }, [profile?.city]);
  return loc;
}

export async function fetchEvents(profile: Profile, location: Loc, query?: string){
  try {
    const taste = await getTaste();
    const r = await fetch(API_BASE + '/api/townie', {
      method:'POST',
      headers:{'content-type':'application/json'},
      // tzOffsetMinutes lets the backend compute "today" in the USER'S timezone (evening
      // sessions were previously treated as tomorrow once UTC rolled over).
      body: JSON.stringify({ profile, location, query, taste, tzOffsetMinutes: new Date().getTimezoneOffset() }),
    });
    if (!r.ok) return { events: [], summary: '' };
    return await r.json();
  } catch { return { events: [], summary: '' }; }
}

