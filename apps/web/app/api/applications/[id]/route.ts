import {requireUser} from '@/lib/server/auth';
import {getApplication,updateApplication,deleteApplication} from '@/lib/server/applications';
import {endpoint,readJson,requireMutationOrigin,success,rateLimit} from '@/lib/server/http';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return endpoint(async()=>success(getApplication((await context.params).id,requireUser(request,'provider'))));}
export async function PATCH(request:Request,context:Context){return endpoint(async()=>{requireMutationOrigin(request);const user=requireUser(request,'provider');rateLimit(`application-write:${user.id}`,30);return success(updateApplication((await context.params).id,await readJson(request),user));});}
export async function DELETE(request:Request,context:Context){return endpoint(async()=>{requireMutationOrigin(request);const user=requireUser(request,'provider');deleteApplication((await context.params).id,user);return success({ok:true});});}
