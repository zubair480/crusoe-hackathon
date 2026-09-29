import { service } from '../../../lib/service';
import { exportReport } from '../../../lib/report';
import { readSchedule } from '@thermaldesk/excel';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const state = await service.read();
  state.schedule = await readSchedule(service.workbookPath);
  return new Response(exportReport(state), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="thermaldesk-repair-report.html"', 'Cache-Control': 'no-store' } });
}
