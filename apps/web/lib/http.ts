const DEFAULT_DEV_ORIGINS = ['http://localhost:8765', 'http://127.0.0.1:8765'];

function permittedOrigins(request: Request): Set<string> {
  const own = new URL(request.url).origin;
  const configured = (process.env.THERMALDESK_DEV_FRONTEND_ORIGINS ?? '')
    .split(',').map(value => value.trim()).filter(Boolean);
  return new Set([own, ...DEFAULT_DEV_ORIGINS, ...configured]);
}

export function localCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin');
  if (!origin || !permittedOrigins(request).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** Local demo only. Accept the app itself and explicit loopback development frontends. */
export function requireLocalOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin || !permittedOrigins(request).has(origin)) throw new Error('Demo mutations require an approved local application origin.');
}
