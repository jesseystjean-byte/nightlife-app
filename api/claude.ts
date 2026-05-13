import type { IncomingMessage, ServerResponse } from 'http';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1024;

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
      // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
  }

  if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'API key not configured' }));
              return;
      }

  try {
          // Read the raw body from the stream
        const rawBody = await new Promise<string>((resolve, reject) => {
                  let data = '';
                  req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                  req.on('end', () => resolve(data));
                  req.on('error', reject);
        });

        // Parse the client payload: { system: string, user: string }
        // OR { messages: [...], system: string } for multi-turn chat
        const payload = JSON.parse(rawBody);

        // Build proper Anthropic API request
        let anthropicBody: any;
          if (payload.messages) {
                    // Multi-turn: already has messages array
            anthropicBody = {
                        model: MODEL,
                        max_tokens: MAX_TOKENS,
                        system: payload.system || '',
                        messages: payload.messages,
            };
          } else {
                    // Single-turn: { system, user }
            anthropicBody = {
                        model: MODEL,
                        max_tokens: MAX_TOKENS,
                        system: payload.system || '',
                        messages: [{ role: 'user', content: payload.user || payload.prompt || '' }],
            };
          }

        const response = await fetch(ANTHROPIC_API_URL, {
                  method: 'POST',
                  headers: {
                              'Content-Type': 'application/json',
                              'x-api-key': apiKey,
                              'anthropic-version': '2023-06-01',
                  },
                  body: JSON.stringify(anthropicBody),
        });

        const data = await response.json();

        if (!response.ok) {
                  res.statusCode = response.status;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: data.error?.message || 'Anthropic API error', details: data }));
                  return;
        }

        // Return the text content
        const text = data.content?.[0]?.text ?? '';
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ text, content: data.content }));
  } catch (error: any) {
          console.error('Proxy error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message || 'Internal server error' }));
  }
}
