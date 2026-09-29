import { readFile } from 'node:fs/promises';
import { service } from '../../../lib/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return new Response(await readFile(service.workbookPath), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="thermaldesk-demo-schedule.xlsx"', 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'No workbook yet. Coordinate a job first.' }, { status: 404 }); }
}
