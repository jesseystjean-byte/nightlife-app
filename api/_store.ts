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

export async function kvSet(key: string, value: any): Promise<boolean> {
  try {
    const c = await getClient();
    if (!c) return false;
    await c.set(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}
