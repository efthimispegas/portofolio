import {requireUser} from '@/lib/server/auth';
import {submitApplication} from '@/lib/server/applications';
import {endpoint,requireMutationOrigin,success,rateLimit} from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{requireMutationOrigin(request);const user=requireUser(request,'provider');rateLimit(`application-submit:${user.id}`,10);return success(submitApplication((await context.params).id,user));});}
