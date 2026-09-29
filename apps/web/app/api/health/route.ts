export async function GET() {
  return Response.json({ status: 'ok', mode: 'local-demo', integrations: { crusoe: 'simulated', plaud: 'simulated', coordination: 'simulated', excel: 'live-local-file' } });
}
