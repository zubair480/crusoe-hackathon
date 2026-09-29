import { readFile } from 'node:fs/promises';
import { service } from '../../../lib/service';
import { readSchedule } from '@thermaldesk/excel';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('format') === 'json') return Response.json(await readSchedule(service.workbookPath), { headers: { 'Cache-Control': 'no-store' } });
  try { return new Response(await readFile(service.workbookPath), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="thermaldesk-demo-schedule.xlsx"', 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'No workbook yet. Coordinate a job first.' }, { status: 404 }); }
}
