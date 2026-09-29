export async function GET() {
  const crusoe = process.env.THERMALDESK_ANALYSIS_MODE === 'crusoe' ? (process.env.CRUSOE_LIVE_REQUESTS_ENABLED !== 'true' ? 'live_requests_disabled' : process.env.CRUSOE_API_KEY ? 'configured-unverified' : 'not_configured') : 'simulated';
  return Response.json({ status: 'ok', mode: 'local-demo', integrations: { crusoe, plaud: 'simulated', coordination: 'simulated', excel: 'live-local-file' } });
}
