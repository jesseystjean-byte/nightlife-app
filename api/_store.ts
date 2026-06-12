// api/_store.ts
// Tiny persistence helper backed by the project's Vercel Redis store (node-redis).
// The Vercel "Redis" integration injects a single connection string: KV_REDIS_URL
// (a redis://... URL). We reuse one client across warm invocations.
// If the URL is absent, every call is a safe no-op so the app still runs
// (featured/social/crawler events just won't persist until Redis is connected).

import { createClient } from 'redis';

const REDIS_URL = process.env.KV_REDIS_URL || process.env.REDIS_URL || '';

let client: ReturnType<typeof createClient> | null = null;
let connecting: Promise<any> | null = null;

export function kvEnabled(): boolean { return !!REDIS_URL; }

async function getClient() {
  if (!REDIS_URL) return null;
  if (client && (client as any).isOpen) return client;
  if (!client) {
    client = createClient({ url: REDIS_URL });
    client.on('error', () => { /* swallow; calls fall back to no-op */ });
  }
  if (!(client as any).isOpen) {
    connecting = connecting || client.connect();
    try { await connecting; } finally { connecting = null; }
  }
  return client;
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  try {
    const c = await getClient();
    if (!c) return null;
    const v = await c.get(key);
    if (v == null) return null;
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  } catch { return null; }
}

export async function kvSet(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
  try {
    const c = await getClient();
    if (!c) return false;
    if (ttlSeconds && ttlSeconds > 0) await c.set(key, JSON.stringify(value), { EX: Math.round(ttlSeconds) });
    else await c.set(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

// Sliding-window-ish rate limiter: INCR a per-minute bucket with auto-expiry.
// Returns true when the caller is WITHIN the limit. Fails open if Redis is absent
// (the app keeps working; protection simply isn't active until storage exists).
export async function rateLimitOk(bucketKey: string, maxPerMinute: number): Promise<boolean> {
  try {
    const c = await getClient();
    if (!c) return true;
    const key = `rl:${bucketKey}:${Math.floor(Date.now() / 60000)}`;
    const n = await c.incr(key);
    if (n === 1) await c.expire(key, 90);
    return n <= maxPerMinute;
  } catch { return true; }
}

// Capped list push for lightweight client error logs.
export async function kvPushCapped(listKey: string, value: any, cap: number): Promise<boolean> {
  try {
    const c = await getClient();
    if (!c) return false;
    await c.lPush(listKey, JSON.stringify(value));
    await c.lTrim(listKey, 0, Math.max(0, cap - 1));
    return true;
  } catch { return false; }
}

export async function kvRange(listKey: string, count: number): Promise<any[]> {
  try {
    const c = await getClient();
    if (!c) return [];
    const items = await c.lRange(listKey, 0, Math.max(0, count - 1));
    return items.map((s: string) => { try { return JSON.parse(s); } catch { return s; } });
  } catch { return []; }
}

// Client IP for rate-limit buckets (Vercel sets x-forwarded-for).
export function clientIp(req: any): string {
  const xf = String(req?.headers?.['x-forwarded-for'] || '');
  return (xf.split(',')[0] || '').trim() || 'unknown';
}
