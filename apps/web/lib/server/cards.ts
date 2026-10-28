import { demoCards, type ProviderCard } from '@mastoli/core';
import { database } from './database';
import { ApiError } from './http';

export function getPublicCards():ProviderCard[] {
  if(process.env.NODE_ENV==='production')return [...demoCards];
  const cards=database().prepare('SELECT public_json FROM cards ORDER BY published_at DESC').all() as {public_json:string}[];
  return [...cards.map(x=>JSON.parse(x.public_json) as ProviderCard),...demoCards];
}
export function getPublicCard(slug:string):ProviderCard|null {
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug))return null;
  const demo=demoCards.find(x=>x.slug===slug);if(demo)return demo;
  if(process.env.NODE_ENV==='production')return null;
  const row=database().prepare('SELECT public_json FROM cards WHERE slug=?').get(slug) as {public_json:string}|undefined;
  return row ? JSON.parse(row.public_json) : null;
}
export function requireCard(slug:string) {const card=getPublicCard(slug);if(!card)throw new ApiError(404,'NOT_FOUND','This card is unavailable.');return card;}

export function vcard(card:ProviderCard, url:string) {
  const escape=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const lines=['BEGIN:VCARD','VERSION:3.0',`FN:${escape(card.displayName)}`,`N:;${escape(card.displayName)};;;`,`ORG:${escape(card.displayName)}`,`TITLE:${escape(card.category)}`,`NOTE:${escape(card.description)}`];
  if(card.phone)lines.push(`TEL;TYPE=WORK:${escape(card.phone)}`);
  if(card.email)lines.push(`EMAIL;TYPE=WORK:${escape(card.email)}`);
  lines.push(`URL:${escape(url)}`,'END:VCARD');
  // RFC 6350-compatible UTF-8 line folding; never split a multi-byte character.
  return lines.flatMap(line=>{
    const parts:string[]=[];let current='';let bytes=0;
    for(const char of line){const n=Buffer.byteLength(char);if(bytes+n>74){parts.push(current);current=' ';bytes=1;}current+=char;bytes+=n;}
    parts.push(current);return parts;
  }).join('\r\n')+'\r\n';
}
