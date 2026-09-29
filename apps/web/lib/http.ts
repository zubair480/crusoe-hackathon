/** Local demo only. The 3D frontend should use the same origin or its dev proxy. */
export function requireLocalOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const url = origin ? new URL(origin) : null;
  // Next can normalize request.url to localhost even when Host is 127.0.0.1.
  if (!url || !['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.host !== request.headers.get('host')) throw new Error('Demo mutations require the local application origin.');
}
