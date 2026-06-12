// api/friends.ts
// Lightweight, login-free social graph for 5to9.
// Each device has a stable userId (generated on the client) and a short shareable invite CODE.
// People become friends by entering each other's code — no passwords/accounts needed.
// Backed by Vercel KV (same store as featured events).
//
// POST body: { action, ...args }
//   action 'register'  { userId, name?, city?, vibes? }      -> { user }   (creates/refreshes profile + code)
//   action 'addFriend' { userId, code }                      -> { ok, friend }
//   action 'setPlan'   { userId, plan?, going? }             -> { ok, user }
//   action 'list'      { userId }                            -> { friends: [...] }
//
// KV keys:  user:{userId} -> profile   |  code:{CODE} -> userId  |  friends:{userId} -> [userId]

import { kvGet, kvSet, kvEnabled, rateLimitOk, clientIp } from './_store';
import { createHash } from 'crypto';

const sha256 = (x: string) => createHash('sha256').update(x).digest('hex');
import { cors } from './_paypal';

type User = { userId: string; name?: string; city?: string; vibes?: string[]; code?: string; plan?: string; going?: boolean; updatedAt?: number; secretHash?: string };

function code6(){ return Math.random().toString(36).slice(2, 8).toUpperCase(); }

async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const c = code6();
    const taken = await kvGet(`code:${c}`);
    if (!taken) return c;
  }
  return code6();
}

export default async function handler(req: any, res: any){
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!kvEnabled()) { res.status(503).json({ error: 'Storage not configured. Add a Vercel KV store to this project.' }); return; }
  if (!(await rateLimitOk('friends:' + clientIp(req), 60))) { res.status(429).json({ error: 'Too many requests — try again in a minute.' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = body.action;
    const userId: string = body.userId;
    if (!userId && action !== 'ping') { res.status(400).json({ error: 'userId required' }); return; }

    // DEVICE SECRET: the app sends a per-device secret with every call. The first call that
    // provides one binds it (hashed) to this userId; afterwards every action must present it.
    // Stops anyone who learns a userId from impersonating that user. Legacy clients without
    // a secret keep working only until the real device binds one.
    const secret: string = typeof body.secret === 'string' ? body.secret : '';
    const me = await kvGet<User>(`user:${userId}`);
    if (me?.secretHash) {
      if (!secret || sha256(secret) !== me.secretHash) { res.status(401).json({ error: 'Unauthorized device for this user.' }); return; }
    } else if (me && secret) {
      me.secretHash = sha256(secret);
      await kvSet(`user:${userId}`, me);
    }

    if (action === 'register') {
      let user = me || { userId } as User;
      if (!user.secretHash && secret) user.secretHash = sha256(secret);
      if (!user.code) {
        const c = await uniqueCode();
        user.code = c;
        await kvSet(`code:${c}`, userId);
      }
      user.name = body.name ?? user.name ?? '';
      user.city = body.city ?? user.city ?? '';
      user.vibes = body.vibes ?? user.vibes ?? [];
      user.updatedAt = Date.now();
      await kvSet(`user:${userId}`, user);
      res.status(200).json({ user });
      return;
    }

    if (action === 'addFriend') {
      const code = String(body.code || '').toUpperCase().trim();
      const targetId = await kvGet<string>(`code:${code}`);
      if (!targetId) { res.status(404).json({ error: 'No one found with that code.' }); return; }
      if (targetId === userId) { res.status(400).json({ error: "That's your own code." }); return; }
      for (const [a, b] of [[userId, targetId], [targetId, userId]]) {
        const list = (await kvGet<string[]>(`friends:${a}`)) || [];
        if (!list.includes(b)) { list.push(b); await kvSet(`friends:${a}`, list); }
      }
      const friend = await kvGet<User>(`user:${targetId}`);
      res.status(200).json({ ok: true, friend: friend ? publicUser(friend) : null });
      return;
    }

    if (action === 'setPlan') {
      const user = (await kvGet<User>(`user:${userId}`));
      if (!user) { res.status(404).json({ error: 'Register first.' }); return; }
      user.plan = String(body.plan || '').slice(0, 120);
      user.going = !!body.going;
      user.updatedAt = Date.now();
      await kvSet(`user:${userId}`, user);
      res.status(200).json({ ok: true, user: publicUser(user) });
      return;
    }

    if (action === 'list') {
      const ids = (await kvGet<string[]>(`friends:${userId}`)) || [];
      const friends: any[] = [];
      for (const id of ids) {
        const u = await kvGet<User>(`user:${id}`);
        if (u) friends.push(publicUser(u));
      }
      res.status(200).json({ friends });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'server error' });
  }
}

function publicUser(u: User){
  return { name: u.name || 'Friend', city: u.city || '', plan: u.plan || '', going: !!u.going, code: u.code, vibes: u.vibes || [] };
}
