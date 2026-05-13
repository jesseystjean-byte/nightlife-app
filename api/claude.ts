import type { IncomingMessage, ServerResponse } from 'http';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

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
        const body = await new Promise<string>((resolve, reject) => {
                let data = '';
                req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                req.on('end', () => resolve(data));
                req.on('error', reject);
        });

      const response = await fetch(ANTHROPIC_API_URL, {
              method: 'POST',
              headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
              },
              body: body,
      });

      const data = await response.json();

      res.statusCode = response.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
  } catch (error) {
        console.error('Proxy error:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}
