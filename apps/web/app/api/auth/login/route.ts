import {login,createSession,sessionCookie} from '@/lib/server/auth';
import {endpoint,readJson,requireMutationOrigin,success} from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(request:Request){return endpoint(async()=>{requireMutationOrigin(request);const user=login(await readJson(request));return success({user},200,{'Set-Cookie':sessionCookie(createSession(user))});});}
