import {revokeSession,sessionCookie} from '@/lib/server/auth';
import {endpoint,requireMutationOrigin,success} from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(request:Request){return endpoint(()=>{requireMutationOrigin(request);revokeSession(request);return success({ok:true},200,{'Set-Cookie':sessionCookie('',true)});});}
