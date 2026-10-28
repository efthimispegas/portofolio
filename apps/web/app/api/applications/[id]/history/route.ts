import { requireUser } from '@/lib/server/auth';
import { reviewHistory } from '@/lib/server/applications';
import { endpoint, success } from '@/lib/server/http';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(async () => success(reviewHistory((await context.params).id, requireUser(request, 'provider'))));
}
