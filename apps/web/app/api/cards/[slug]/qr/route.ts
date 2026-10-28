import QRCode from 'qrcode';
import {requireCard} from '@/lib/server/cards';
import {endpoint,publicOrigin} from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(_request:Request,context:{params:Promise<{slug:string}>}){return endpoint(async()=>{const card=requireCard((await context.params).slug);const svg=await QRCode.toString(`${publicOrigin()}/c/${card.slug}`,{type:'svg',errorCorrectionLevel:'M',margin:2,color:{dark:'#17251FFF',light:'#FFFFFFFF'}});return new Response(svg,{headers:{'Content-Type':'image/svg+xml','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'X-Content-Type-Options':'nosniff'}});});}
