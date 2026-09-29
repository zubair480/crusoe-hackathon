/** Local demo only. The 3D frontend should use the same origin or its dev proxy. */
export function requireLocalOrigin(request: Request): void {
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || request.headers.get('origin') !== url.origin) throw new Error('Demo mutations require the local application origin.');
}
