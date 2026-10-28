import {requireUser} from '@/lib/server/auth';
import {reviewApplication,reviewHistory} from '@/lib/server/applications';
import {endpoint,readJson,requireMutationOrigin,success,rateLimit} from '@/lib/server/http';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return endpoint(async()=>success(reviewHistory((await context.params).id,requireUser(request,'reviewer'))));}
export async function POST(request:Request,context:Context){return endpoint(async()=>{requireMutationOrigin(request);const user=requireUser(request,'reviewer');rateLimit(`review:${user.id}`,30);return success(reviewApplication((await context.params).id,await readJson(request),user));});}
