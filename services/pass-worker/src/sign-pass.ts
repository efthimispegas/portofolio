import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {ProviderCard} from '@mastoli/core';
import {PKPass} from 'passkit-generator';

/** Server-only boundary. Never accept private application data or raw pass JSON. */
export async function signProviderPass(card:ProviderCard,env:NodeJS.ProcessEnv=process.env):Promise<Buffer> {
  const required=['APPLE_PASS_TYPE_IDENTIFIER','APPLE_TEAM_IDENTIFIER','APPLE_WWDR_CERT_PATH','APPLE_SIGNER_CERT_PATH','APPLE_SIGNER_KEY_PATH','APPLE_PASS_ASSETS_DIR','PUBLIC_CARD_ORIGIN'] as const;
  if(env.APPLE_ISSUER_APPROVED!=='1'||required.some(key=>!env[key]))throw new Error('Apple Wallet issuer is not configured and approved.');
  if(card.isDemo)throw new Error('Fictional sample cards cannot be issued as live passes.');
  const origin=new URL(env.PUBLIC_CARD_ORIGIN!);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('PUBLIC_CARD_ORIGIN must be an HTTPS origin.');
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(card.slug))throw new Error('Invalid public card identifier.');
  const [wwdr,signerCert,signerKey,icon,icon2x,icon3x]=await Promise.all([
    readFile(env.APPLE_WWDR_CERT_PATH!),readFile(env.APPLE_SIGNER_CERT_PATH!),readFile(env.APPLE_SIGNER_KEY_PATH!),
    readFile(resolve(env.APPLE_PASS_ASSETS_DIR!,'icon.png')),readFile(resolve(env.APPLE_PASS_ASSETS_DIR!,'icon@2x.png')),readFile(resolve(env.APPLE_PASS_ASSETS_DIR!,'icon@3x.png'))
  ]);
  const url=`${origin.origin}/c/${card.slug}`;
  const pass=new PKPass({'icon.png':icon,'icon@2x.png':icon2x,'icon@3x.png':icon3x},{wwdr,signerCert,signerKey,signerKeyPassphrase:env.APPLE_SIGNER_KEY_PASSPHRASE},{
    formatVersion:1,serialNumber:card.slug,passTypeIdentifier:env.APPLE_PASS_TYPE_IDENTIFIER!,teamIdentifier:env.APPLE_TEAM_IDENTIFIER!,
    organizationName:env.APPLE_ISSUER_NAME||'Portofolio',description:`${card.displayName} · Service card`,logoText:'Portofolio',
    backgroundColor:'rgb(220,232,228)',foregroundColor:'rgb(23,37,31)',labelColor:'rgb(60,78,68)'
  });
  pass.type='generic';
  pass.primaryFields.push({key:'provider',label:'PROVIDER',value:card.displayName});
  pass.secondaryFields.push({key:'service',label:'SERVICE',value:card.scope},{key:'area',label:'AREA',value:card.area});
  pass.backFields.push({key:'profile',label:'PROFILE',value:url},{key:'description',label:'ABOUT',value:card.description});
  if(card.phone)pass.backFields.push({key:'phone',label:'PHONE',value:card.phone});
  if(card.email)pass.backFields.push({key:'email',label:'EMAIL',value:card.email});
  pass.localize('el',{PROVIDER:'ΕΠΑΓΓΕΛΜΑΤΙΑΣ',SERVICE:'ΥΠΗΡΕΣΙΑ',AREA:'ΠΕΡΙΟΧΗ',PROFILE:'ΚΑΡΤΑ',ABOUT:'ΣΧΕΤΙΚΑ',PHONE:'ΤΗΛΕΦΩΝΟ',EMAIL:'EMAIL'});
  pass.setBarcodes({format:'PKBarcodeFormatQR',message:url,messageEncoding:'iso-8859-1'});
  // No webServiceURL/authenticationToken until registration, update and APNs delivery exist.
  return pass.getAsBuffer();
}
