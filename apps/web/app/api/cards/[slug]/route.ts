import {requireCard} from '@/lib/server/cards';
import {endpoint,success} from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(_request:Request,context:{params:Promise<{slug:string}>}){return endpoint(async()=>success(requireCard((await context.params).slug)));}
