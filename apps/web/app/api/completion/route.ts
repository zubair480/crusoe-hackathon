import { service } from '../../../lib/service';
import { uploadCompletion } from '../../../lib/completion-upload';
import { localCorsHeaders } from '../../../lib/http';

export const runtime = 'nodejs';
export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: localCorsHeaders(request) }); }
export async function POST(request: Request) { return uploadCompletion(request, service); }
