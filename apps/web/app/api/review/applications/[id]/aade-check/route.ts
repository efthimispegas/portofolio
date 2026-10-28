import { createAadeCheckHandlers } from '@/lib/server/aade-checks';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
// No live transport is supplied. Synthetic injection exists only in isolated tests.
const handlers = createAadeCheckHandlers();
export async function POST(request: Request, context: Context) {
  return handlers.POST(request, (await context.params).id);
}
export async function GET(request: Request, context: Context) {
  return handlers.GET(request, (await context.params).id);
}
