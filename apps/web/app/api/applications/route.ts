import {requireUser} from '@/lib/server/auth';
import {createApplication,listApplications} from '@/lib/server/applications';
import {endpoint,readJson,requireMutationOrigin,success,rateLimit} from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(request:Request){return endpoint(()=>success(listApplications(requireUser(request,'provider'))));}
export async function POST(request:Request){return endpoint(async()=>{requireMutationOrigin(request);const user=requireUser(request,'provider');rateLimit(`application-create:${user.id}`,10);return success(createApplication(await readJson(request),user),201);});}
