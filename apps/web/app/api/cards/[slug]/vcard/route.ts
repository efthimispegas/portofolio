import {requireCard,vcard} from '@/lib/server/cards';
import {endpoint,publicOrigin} from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(_request:Request,context:{params:Promise<{slug:string}>}){return endpoint(async()=>{const card=requireCard((await context.params).slug);return new Response(vcard(card,`${publicOrigin()}/c/${card.slug}`),{headers:{'Content-Type':'text/vcard; charset=utf-8','Content-Disposition':`attachment; filename="${card.slug}.vcf"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});});}
