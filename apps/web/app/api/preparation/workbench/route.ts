import { repairWorkbench } from '../../../../lib/repair-workbench';
export const dynamic = 'force-dynamic';
export async function GET() {
  return new Response(repairWorkbench, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
