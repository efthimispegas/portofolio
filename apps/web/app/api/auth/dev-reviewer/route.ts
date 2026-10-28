import {developmentReviewer,createSession,sessionCookie} from '@/lib/server/auth';
import {endpoint,requireMutationOrigin,success} from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(request:Request){return endpoint(()=>{requireMutationOrigin(request);const user=developmentReviewer(request);return success({user},200,{'Set-Cookie':sessionCookie(createSession(user))});});}
