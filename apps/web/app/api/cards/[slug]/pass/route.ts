import {requireCard} from '@/lib/server/cards';
import {endpoint,ApiError} from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(_request:Request,context:{params:Promise<{slug:string}>}){return endpoint(async()=>{requireCard((await context.params).slug);throw new ApiError(503,'WALLET_INTEGRATION_DEFERRED','External wallet integration is deferred. Save this card in Portofolio or download its contact details.');});}
