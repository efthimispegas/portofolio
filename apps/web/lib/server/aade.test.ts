import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AADE_ENDPOINT, AADE_MAX_BYTES, createAadeClient, parseAadeResponse } from './aade-client';
const SOAP='http://www.w3.org/2003/05/soap-envelope', S='http://rgwspublic2/RgWsPublic2Service', D='http://rgwspublic2/RgWsPublic2';
const config={username:'synthetic-user',password:'synthetic<&"password',callerAfm:'000000001'};
const target='000000002';
function fixture({afm=target,caller=config.callerAfm,error='',flag='1'}={}) {
 return `<s:Envelope xmlns:s="${SOAP}" xmlns:v="${S}" xmlns:d="${D}"><s:Body><v:rgWsPublic2AfmMethodResponse><v:result><d:rg_ws_public2_result_rtType><d:error_rec>${error}</d:error_rec><d:afm_called_by_rec><d:afm_called_by>${caller}</d:afm_called_by></d:afm_called_by_rec><d:basic_rec><d:afm>${afm}</d:afm><d:onomasia>Synthetic Business</d:onomasia><d:deactivation_flag>${flag}</d:deactivation_flag><d:firm_flag_descr>Test business status</d:firm_flag_descr><d:normal_vat_system_flag>Y</d:normal_vat_system_flag><d:postal_address>PRIVATE ADDRESS</d:postal_address></d:basic_rec><d:firm_act_tab><d:item><d:firm_act_code>0012.34</d:firm_act_code><d:firm_act_descr>Synthetic activity</d:firm_act_descr></d:item></d:firm_act_tab><d:call_seq_id>12345678901234567890</d:call_seq_id></d:rg_ws_public2_result_rtType></v:result></v:rgWsPublic2AfmMethodResponse></s:Body></s:Envelope>`;
}
const parse=(xml:string,status=200)=>parseAadeResponse(Buffer.from(xml),target,config.callerAfm,status);
const transport=(fn:(input:Parameters<typeof fetch>[0],init:Parameters<typeof fetch>[1])=>Promise<Response>)=>fn as typeof fetch;

test('AADE matches identity and caller, retains decimal strings, excludes unrelated private fields',()=>{
 const r=parse(fixture());assert.equal(r.outcome,'matched');if(r.outcome!=='matched')throw Error();
 assert.equal(r.evidence.activities[0].code,'0012.34');assert.equal(r.evidence.callReference,'12345678901234567890');
 assert.equal(r.evidence.legalName,'Synthetic Business');
 for(const secret of [target,config.callerAfm,'PRIVATE ADDRESS',config.password])assert.ok(!JSON.stringify(r).includes(secret));
});
test('AADE accepts alternate prefixes only with the exact namespaces',()=>{
 assert.equal(parse(fixture().replaceAll('d:','data:').replace('xmlns:d=','xmlns:data=')).outcome,'matched');
 assert.equal(parse(fixture().replace(`xmlns:d="${D}"`,'xmlns:d="https://wrong.example"')).outcome,'malformed_response');
});
test('AADE checks subject and charged principal independently',()=>{
 assert.equal(parse(fixture({afm:'000000003'})).outcome,'identity_mismatch');
 assert.equal(parse(fixture({caller:'000000003'})).outcome,'caller_context_mismatch');
 assert.equal(parse(fixture({afm:''})).outcome,'incomplete_result');
});
test('AADE HTTP 200 application errors take priority over a matching record and never leak server text',()=>{
 const r=parse(fixture({error:'<d:error_code>RG_WS_PUBLIC_TOKEN_USERNAME_NOT_AUTHENTICATED</d:error_code><d:error_descr>PRIVATE SECRET</d:error_descr>'}));
 assert.deepEqual(r,{outcome:'application_error',httpStatus:200,credentialRejected:true});
 assert.ok(!JSON.stringify(r).includes('PRIVATE'));
 assert.equal(parse(fixture({error:'<d:error_descr>Only a description</d:error_descr>'})).outcome,'application_error');
});
test('AADE SOAP faults with 200 or 500 never become matches or expose fault text',()=>{
 const f=`<s:Envelope xmlns:s="${SOAP}"><s:Body><s:Fault><s:Reason>PRIVATE</s:Reason></s:Fault></s:Body></s:Envelope>`;
 for(const status of [200,500])assert.deepEqual(parse(f,status),{outcome:'soap_fault',httpStatus:status});
});
test('AADE rejects duplicate SOAP bodies, operations, records and scalar identity fields',()=>{
 const x=fixture();
 for(const bad of [x.replace('</s:Envelope>','<s:Body/></s:Envelope>'),x.replace('</s:Body>','<v:rgWsPublic2AfmMethodResponse/></s:Body>'),x.replace('</v:result>','<d:rg_ws_public2_result_rtType/></v:result>'),x.replace('</d:afm>','</d:afm><d:afm>000000003</d:afm>')])
  assert.equal(parse(bad).outcome,'malformed_response');
});
test('AADE rejects entities, malformed XML, nested scalar fields, unsupported encoding and excessive depth',()=>{
 for(const bad of ['<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>'+fixture(),'<broken',fixture().replace('Synthetic Business','&unknown;'),fixture().replace('Synthetic Business','<d:bad>Injected</d:bad>'),'<?xml version="1.0" encoding="UTF-16"?>'+fixture(),'<x>'.repeat(40)+'</x>'.repeat(40)])
  assert.equal(parse(bad).outcome,'malformed_response');
 assert.equal(parseAadeResponse(new Uint8Array([0xff,0xfe]),target,config.callerAfm,200).outcome,'malformed_response');
});
test('AADE distinguishes incomplete identity/status from inactive matched source evidence',()=>{
 assert.equal(parse(fixture({flag:'unexpected'})).outcome,'incomplete_result');
 assert.equal(parse(fixture().replace('Synthetic Business','')).outcome,'incomplete_result');
 assert.equal(parse(fixture({flag:'2'})).outcome,'matched');
});
test('AADE bounds XML size and maps rate limits and HTTP failures without response data',()=>{
 assert.equal(parse('x'.repeat(AADE_MAX_BYTES+1)).outcome,'response_too_large');
 assert.equal(parse('private body',429).outcome,'rate_limited');
 for(const status of [401,403,500,503])assert.deepEqual(parse('PRIVATE',status),{outcome:'http_error',httpStatus:status});
});
test('AADE sends one fixed-host SOAP request, escapes credentials, forbids redirects/cache and exposes no identifiers',async()=>{
 let calls=0;
 const client=createAadeClient(config,{fetch:transport(async(url,init)=>{
  calls++;assert.equal(url,AADE_ENDPOINT);assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
  assert.ok(String(init?.body).includes('synthetic&lt;&amp;&quot;password'));assert.ok(String(init?.body).includes(`<d:afm_called_for>${target}</d:afm_called_for>`));
  assert.ok(init?.signal);return new Response(fixture());
 })});
 const r=await client.lookup(target);assert.equal(r.outcome,'matched');assert.equal(calls,1);assert.equal(r.attempts,1);assert.equal(r.publicationApproved,false);assert.match(r.responseSha256!,/^[a-f0-9]{64}$/);
});
test('AADE incomplete configuration and invalid targets never make network calls',async()=>{
 let calls=0;const f=transport(async()=>{calls++;throw Error();});
 for(const bad of ['', '123', '000000002<inject>'])assert.equal((await createAadeClient(config,{fetch:f}).lookup(bad)).outcome,'invalid_request');
 for(const invalidConfig of [{...config,password:''},{...config,username:'user\nsecret'},{...config,callerAfm:'bad'}])
  assert.equal((await createAadeClient(invalidConfig,{fetch:f}).lookup(target)).outcome,'configuration_error');
 assert.equal(calls,0);
});
test('AADE network failures are safe and do not retry',async()=>{
 let calls=0;const r=await createAadeClient(config,{fetch:transport(async()=>{calls++;throw Error(config.password);})}).lookup(target);
 assert.equal(calls,1);assert.equal(r.outcome,'network_error');assert.ok(!JSON.stringify(r).includes(config.password));
});
test('AADE abort deadline includes the request',async()=>{
 const r=await createAadeClient(config,{timeoutMs:5,fetch:transport(async(_url,init)=>new Promise((_resolve,reject)=>{
  init!.signal!.addEventListener('abort',()=>reject(Error('PRIVATE')),{once:true});
 }))}).lookup(target);
 assert.equal(r.outcome,'timeout');
});
test('AADE rejects redirect responses and oversized declared lengths without reading payload',async()=>{
 for(const [response,outcome] of [[new Response(null,{status:302,headers:{location:'https://example.test'}}),'redirect_rejected'],[new Response('x',{headers:{'content-length':String(AADE_MAX_BYTES+1)}}),'response_too_large']] as const){
  const r=await createAadeClient(config,{fetch:transport(async()=>response)}).lookup(target);assert.equal(r.outcome,outcome);
 }
});
test('AADE enforces actual streaming length without trusting Content-Length',async()=>{
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(600_000));c.enqueue(new Uint8Array(600_000));},cancel(){cancelled=true;}});
 const r=await createAadeClient(config,{fetch:transport(async()=>new Response(stream))}).lookup(target);
 assert.equal(r.outcome,'response_too_large');assert.equal(cancelled,true);
});
test('AADE timeout aborts a stalled response body and never retries',async()=>{
 let calls=0;
 const r=await createAadeClient(config,{timeoutMs:5,fetch:transport(async(_url,init)=>{
  calls++;return new Response(new ReadableStream({start(controller){init!.signal!.addEventListener('abort',()=>controller.error(Error('PRIVATE')),{once:true});}}));
 })}).lookup(target);
 assert.equal(r.outcome,'timeout');assert.equal(calls,1);
});
