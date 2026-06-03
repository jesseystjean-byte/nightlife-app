// api/_paypal.ts
// Shared PayPal helpers. Credentials come ONLY from environment variables you set
// in Vercel — never hard-code them here.
//
// Set in Vercel -> Settings -> Environment Variables:
//   PAYPAL_CLIENT_ID   (from developer.paypal.com -> your app)
//   PAYPAL_SECRET      (from the same app — keep secret)
//   PAYPAL_ENV         "sandbox" (default) while testing, "live" when ready
//
// Files beginning with "_" are not exposed as routes by Vercel.

const ENVV = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
export const PAYPAL_BASE = ENVV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

export function paypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
}

export async function paypalToken(): Promise<string | null> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) return null;
  try {
    const auth = Buffer.from(`${id}:${secret}`).toString('base64');
    const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.access_token || null;
  } catch { return null; }
}

export function cors(res: any){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
