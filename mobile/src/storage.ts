import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './config';
import type { EventItem } from './types';

export const PROFILE_KEY = '@5to9_profile_v1';
export const SAVED_KEY = '@5to9_saved_v1';
export const PASSED_KEY = '@5to9_passed_v1';
export const FRIENDS_KEY = '@5to9_friends_v1';
export const IMPORTED_KEY = '@5to9_imported_v1';
export const USER_KEY = '@5to9_user_v1';
export const SAVED_EVS_KEY = '@5to9_saved_evs_v1';   // FULL saved event objects — Saved screen + taste learning
export const PASSED_EVS_KEY = '@5to9_passed_evs_v1'; // light records of passed events — taste learning

// ---- Taste learning + persistent saves -------------------------------------------------
// We keep full saved-event objects (so Saved works offline and never "loses" events when the
// daily feed rotates) and light records of passes. Recent titles from both are sent to the
// backend ranker so recommendations sharpen with use.
export const tasteLabel = (e: any) =>
  (e?.title || '') + (Array.isArray(e?.categories) && e.categories.length ? ' (' + e.categories.slice(0, 2).join(', ') + ')' : '');

export async function getSavedEvents(): Promise<EventItem[]> {
  try { const raw = await AsyncStorage.getItem(SAVED_EVS_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
export async function addSavedEvent(ev: EventItem){
  try {
    const arr = await getSavedEvents();
    const next = [...arr.filter(e => e.id !== ev.id), ev].slice(-200);
    await AsyncStorage.setItem(SAVED_EVS_KEY, JSON.stringify(next));
  } catch {}
}
export async function removeSavedEvent(id: string){
  try {
    const arr = await getSavedEvents();
    await AsyncStorage.setItem(SAVED_EVS_KEY, JSON.stringify(arr.filter(e => e.id !== id)));
  } catch {}
}
export async function recordPassed(ev: EventItem){
  try {
    const raw = await AsyncStorage.getItem(PASSED_EVS_KEY);
    const arr: any[] = raw ? JSON.parse(raw) : [];
    const next = [...arr.filter(x => x.id !== ev.id), { id: ev.id, title: ev.title || '', categories: ev.categories, at: Date.now() }].slice(-150);
    await AsyncStorage.setItem(PASSED_EVS_KEY, JSON.stringify(next));
  } catch {}
}
export async function getTaste(): Promise<{ liked: string[]; passed: string[] }> {
  try {
    const [likedArr, praw] = await Promise.all([getSavedEvents(), AsyncStorage.getItem(PASSED_EVS_KEY)]);
    const passedArr: any[] = praw ? JSON.parse(praw) : [];
    return {
      liked: likedArr.slice(-40).map(tasteLabel).filter(Boolean),
      passed: passedArr.slice(-40).map(tasteLabel).filter(Boolean),
    };
  } catch { return { liked: [], passed: [] }; }
}


// Login-free identity: a stable device userId + a per-device SECRET (the credential) +
// a shareable invite code. The secret is generated once, stored only on this device, and
// sent with every friends call — the backend binds its hash to the userId so nobody else
// can act as this user.
async function getStoredUser(): Promise<any> {
  try { const raw = await AsyncStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export async function friendsApi(action: string, args: any = {}): Promise<any> {
  const st = await getStoredUser();
  const r = await fetch(API_BASE + '/api/friends', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, userId: st.userId, secret: st.secret, ...args }),
  });
  return r.json();
}

export async function ensureIdentity(profile?: any){
  const stored = await getStoredUser();
  let userId = stored.userId;
  let secret = stored.secret;
  if (!userId) userId = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  if (!secret) secret = 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify({ ...stored, userId, secret }));
  try {
    const d = await friendsApi('register', { name: profile?.name || '', city: profile?.city || '', vibes: profile?.vibes || [] });
    if (d.user) {
      await AsyncStorage.setItem(USER_KEY, JSON.stringify({ userId, secret, code: d.user.code }));
      return d.user;
    }
  } catch {}
  return { userId, code: stored.code };
}
