import {sessionUser} from '@/lib/server/auth';
import {endpoint,success} from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(request:Request){return endpoint(()=>success({user:sessionUser(request)}));}
