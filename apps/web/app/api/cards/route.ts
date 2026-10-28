import {getPublicCards} from '@/lib/server/cards';
import {endpoint,success} from '@/lib/server/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){return endpoint(()=>success(getPublicCards()));}
