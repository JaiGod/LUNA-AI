// Optional Cloudflare Worker that keeps your Claude API key off the web page.
// It forwards POST /v1/messages to the Claude API with the key stored as a Worker secret,
// and only for pages served from ALLOWED_ORIGINS.
//
// Deploy:  npx wrangler deploy   then   npx wrangler secret put ANTHROPIC_API_KEY
// In LUNA-X: AI Network → Claude → proxy URL = https://<your-worker>.workers.dev

const ALLOWED_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const MAX_TOKENS = 64000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://jaigod.github.io').split(',').map((s) => s.trim());
    const cors = {
      'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0],
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': request.headers.get('access-control-request-headers') || '*',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (!allowed.includes(origin) && request.method === 'POST') return new Response('Origin not allowed', { status: 403, headers: cors });

    // Copilot (GitHub Models): GitHub sends no CORS headers, so the page calls it through here.
    // Uses the caller's GitHub token (Authorization header), or a GITHUB_TOKEN secret if set.
    if (request.method === 'POST' && url.pathname === '/github/chat/completions') {
      const auth = request.headers.get('authorization') || (env.GITHUB_TOKEN ? `Bearer ${env.GITHUB_TOKEN}` : '');
      if (!auth) return new Response('GitHub token required', { status: 401, headers: cors });
      const upstream = await fetch('https://models.github.ai/inference/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: await request.text() });
      const out = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(cors)) out.set(k, v);
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }

    if (request.method !== 'POST' || url.pathname !== '/v1/messages') return new Response('Not found', { status: 404, headers: cors });

    let body;
    try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400, headers: cors }); }
    if (!ALLOWED_MODELS.includes(body.model)) return new Response('Model not allowed', { status: 400, headers: cors });
    body.max_tokens = Math.min(body.max_tokens || 1024, MAX_TOKENS);

    const headers = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
    };
    const beta = request.headers.get('anthropic-beta');
    if (beta) headers['anthropic-beta'] = beta;

    const upstream = await fetch('https://api.anthropic.com/v1/messages' + url.search, { method: 'POST', headers, body: JSON.stringify(body) });
    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
