import {requireUser} from '@/lib/server/auth';
import {listApplications} from '@/lib/server/applications';
import {endpoint,success} from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(request:Request){return endpoint(()=>success(listApplications(requireUser(request,'reviewer'),true)));}
