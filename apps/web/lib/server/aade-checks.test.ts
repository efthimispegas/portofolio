import { test,beforeEach,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { database,closeDatabase } from './database';
import { createSession,sessionCookie,revokeSession,type SessionUser } from './auth';
import { createApplication,submitApplication,getApplication,listApplications,reviewHistory } from './applications';
import { getPublicCards } from './cards';
import { createAadeCheckHandlers } from './aade-checks';
import type { AadeResult } from './aade-client';
import { emptyApplication } from '@mastoli/core';

let owner:SessionUser, reviewer:SessionUser, reviewerCookie:string, ownerCookie:string;
const origin='http://localhost:3000';
const syntheticAfm='000000012'; // Checksum-valid test string; never used for a live lookup.
beforeEach(()=>{
 closeDatabase();Object.assign(process.env,{NODE_ENV:'test',LOCAL_DATABASE_PATH:':memory:',APP_ORIGIN:origin,AADE_EVIDENCE_KEY_HEX:randomBytes(32).toString('hex'),AADE_EVIDENCE_KEY_ID:'test-v1'});
 owner={id:randomUUID(),email:'owner@example.test',name:'Synthetic Owner',role:'provider'};
 database().prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(owner.id,owner.email,owner.name,'unused','provider',new Date().toISOString());
 reviewer={id:randomUUID(),email:'reviewer@example.test',name:'Synthetic Reviewer',role:'reviewer'};
 database().prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(reviewer.id,reviewer.email,reviewer.name,'unused','reviewer',new Date().toISOString());
 reviewerCookie=sessionCookie(createSession(reviewer));ownerCookie=sessionCookie(createSession(owner));
});
after(()=>{closeDatabase();delete process.env.AADE_EVIDENCE_KEY_HEX;delete process.env.AADE_EVIDENCE_KEY_ID;});
function app(submit=true){
 const a=createApplication({...emptyApplication,displayName:'Synthetic applicant',category:'cleaning',area:'Test area',phone:'+302100000001',description:'Synthetic household cleaning application.',businessTaxId:syntheticAfm,gemiNumber:'123456789012',serviceScope:'Synthetic cleaning',declaration:true},owner);
 return submit?submitApplication(a.id,owner):a;
}
function request(body?:Record<string,unknown>,cookie=reviewerCookie,requestOrigin=origin){
 return new Request(origin+'/api/review/applications/example/aade-check',{method:body?'POST':'GET',headers:{cookie,origin:requestOrigin,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
const body=(a:ReturnType<typeof app>,requestId=randomUUID())=>({expectedUpdatedAt:a.updatedAt,requestId});
function matched():AadeResult{return {outcome:'matched',httpStatus:200,source:'aade',method:'authorized_api',observedAt:new Date().toISOString(),attempts:1,publicationApproved:false,evidence:{legalName:'SYNTHETIC PRIVATE LEGAL NAME',afmStatusCode:'1',afmStatusLabel:'Test active',businessActivityStatus:'Test business',normalVatRegime:'Y',activities:[],callReference:'secret-call-reference'}};}
function handlers(fn:(afm:string)=>Promise<AadeResult>=async()=>matched()){return createAadeCheckHandlers({mode:'synthetic',lookup:fn});}
const count=()=> (database().prepare('SELECT count(*) AS n FROM aade_checks').get() as {n:number}).n;
async function error(response:Response,status:number,code?:string){assert.equal(response.status,status);const b=await response.json();if(code)assert.equal(b.error.code,code);return b;}
function deferred(){let release!:(r:AadeResult)=>void;const promise=new Promise<AadeResult>(r=>{release=r;});return {promise,release};}
async function reserved(){for(let i=0;i<30&&!count();i++)await new Promise(r=>setImmediate(r));assert.equal(count(),1);}

test('AADE operation rejects anonymous/provider and cross-origin mutation before lookup',async()=>{
 const a=app();let calls=0;const h=handlers(async()=>{calls++;return matched();});
 await error(await h.POST(request(body(a),''),a.id),401);
 await error(await h.POST(request(body(a),ownerCookie),a.id),403);
 await error(await h.GET(request(undefined,ownerCookie),a.id),403);
 await error(await h.POST(request(body(a),reviewerCookie,'https://elsewhere.test'),a.id),403);
 assert.equal(calls,0);assert.equal(count(),0);
});
test('AADE default HTTP wiring stays disabled regardless of live environment credentials',async()=>{
 const a=app();process.env.AADE_USERNAME='unused';process.env.AADE_PASSWORD='unused';
 await error(await createAadeCheckHandlers().POST(request(body(a)),a.id),503,'AADE_OPERATION_NOT_ENABLED');
 delete process.env.AADE_USERNAME;delete process.env.AADE_PASSWORD;assert.equal(count(),0);
});
test('AADE operation fails closed before reservation if encryption key is absent/invalid',async()=>{
 const a=app();let calls=0;const h=handlers(async()=>{calls++;return matched();});
 for(const key of ['', 'short']){process.env.AADE_EVIDENCE_KEY_HEX=key;await error(await h.POST(request(body(a)),a.id),503,'EVIDENCE_KEY_REQUIRED');}
 assert.equal(calls,0);assert.equal(count(),0);
});
test('AADE rejects injected lookup parameters, invalid IDs, drafts, stale versions and missing AFM',async()=>{
 const a=app(),draft=app(false);let calls=0;const h=handlers(async()=>{calls++;return matched();});
 await error(await h.POST(request({...body(a),afm:'999999999'}),a.id),422,'UNKNOWN_FIELD');
 await error(await h.POST(request({...body(a),requestId:'bad'}),a.id),422);
 await error(await h.POST(request({...body(a),expectedUpdatedAt:'2020-01-01T00:00:00.000Z'}),a.id),409,'STALE_APPLICATION');
 await error(await h.POST(request(body(draft)),draft.id),409,'APPLICATION_NOT_SUBMITTED');
 const input=JSON.parse((database().prepare('SELECT input_json FROM applications WHERE id=?').get(a.id) as {input_json:string}).input_json);input.businessTaxId='';
 database().prepare('UPDATE applications SET input_json=? WHERE id=?').run(JSON.stringify(input),a.id);
 await error(await h.POST(request(body(a)),a.id),422,'AFM_REQUIRED');assert.equal(calls,0);assert.equal(count(),0);
});
test('AADE binds the server application AFM, stores ciphertext and preserves publication/owner/public projections',async()=>{
 const a=app();const h=handlers(async afm=>{assert.equal(afm,syntheticAfm);return matched();});
 const response=await h.POST(request(body(a)),a.id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const data=(await response.json()).data;assert.equal(data.method,'synthetic_test');assert.equal(data.publicationApproved,false);assert.equal(data.result.evidence.legalName,'SYNTHETIC PRIVATE LEGAL NAME');
 const row=database().prepare('SELECT * FROM aade_checks').get()!;assert.ok(row.ciphertext);assert.equal(row.state,'completed');
 const stored=JSON.stringify(row);assert.ok(!stored.includes('SYNTHETIC PRIVATE'));assert.ok(!stored.includes('secret-call-reference'));assert.ok(!stored.includes(syntheticAfm));
 assert.ok(!JSON.stringify(data).includes('secret-call-reference'));
 assert.equal(getApplication(a.id,owner).status,'submitted');assert.equal(getApplication(a.id,owner).updatedAt,a.updatedAt);
 assert.ok(!JSON.stringify([listApplications(owner),reviewHistory(a.id,owner),getPublicCards()]).includes('SYNTHETIC PRIVATE'));
 const read=await h.GET(request(),a.id);assert.equal((await read.json()).data[0].result.evidence.legalName,'SYNTHETIC PRIVATE LEGAL NAME');
});
test('AADE replays completed request IDs without calling again, including uppercase UUIDs',async()=>{
 const a=app();let calls=0;const h=handlers(async()=>{calls++;return matched();});const b=body(a);
 assert.equal((await h.POST(request(b),a.id)).status,200);
 const r=await h.POST(request({...b,requestId:b.requestId.toUpperCase()}),a.id);assert.equal(r.status,200);assert.equal((await r.json()).data.replayed,true);assert.equal(calls,1);
 const other=app();await error(await h.POST(request({...b,expectedUpdatedAt:other.updatedAt}),other.id),409,'REQUEST_ID_CONFLICT');
});
test('AADE concurrent same-ID and different-ID attempts cannot duplicate an in-flight request',async()=>{
 const a=app(),d=deferred();let calls=0;const h=handlers(async()=>{calls++;return d.promise;});const b=body(a);
 const pending=h.POST(request(b),a.id);await reserved();
 await error(await h.POST(request(b),a.id),409,'CHECK_IN_PROGRESS');
 await error(await h.POST(request(body(a)),a.id),409,'CHECK_IN_PROGRESS');
 d.release(matched());assert.equal((await pending).status,200);assert.equal(calls,1);assert.equal(count(),1);
});
test('AADE discards results when application version changes during lookup',async()=>{
 const a=app(),d=deferred(),h=handlers(async()=>d.promise);const pending=h.POST(request(body(a)),a.id);await reserved();
 database().prepare('UPDATE applications SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',a.id);
 d.release(matched());await error(await pending,409,'STALE_APPLICATION');
 const row=database().prepare('SELECT * FROM aade_checks').get()!;assert.equal(row.state,'stale');assert.equal(row.ciphertext,null);
});
test('AADE rechecks current reviewer session before attaching results',async()=>{
 const a=app(),d=deferred(),h=handlers(async()=>d.promise);const req=request(body(a));const pending=h.POST(req,a.id);await reserved();
 revokeSession(req);d.release(matched());await error(await pending,403,'REVIEWER_ACCESS_CHANGED');
 const row=database().prepare('SELECT * FROM aade_checks').get()!;assert.equal(row.state,'discarded');assert.equal(row.ciphertext,null);
});
test('AADE rechecks reviewer role before attaching results',async()=>{
 const a=app(),d=deferred(),h=handlers(async()=>d.promise);const pending=h.POST(request(body(a)),a.id);await reserved();
 database().prepare("UPDATE users SET role='provider' WHERE id=?").run(reviewer.id);
 d.release(matched());await error(await pending,403,'REVIEWER_ACCESS_CHANGED');assert.equal(database().prepare('SELECT state FROM aade_checks').get()!.state,'discarded');
});
test('AADE records a bounded failed observation and replays it without retrying exceptions',async()=>{
 const a=app();let calls=0;const h=handlers(async()=>{calls++;throw Error('PRIVATE SOAP SECRET');});const b=body(a);
 const r=await h.POST(request(b),a.id);const data=(await r.json()).data;assert.equal(data.state,'failed');assert.equal(data.result.outcome,'network_error');assert.ok(!JSON.stringify(data).includes('PRIVATE SOAP'));
 await h.POST(request(b),a.id);assert.equal(calls,1);
});
test('AADE application quota counts failures and persists across handler instances',async()=>{
 const a=app();let calls=0;const f=async()=>{calls++;throw Error();};
 for(let i=0;i<3;i++)assert.equal((await handlers(f).POST(request(body(a)),a.id)).status,200);
 await error(await handlers(f).POST(request(body(a)),a.id),429,'CHECK_RATE_LIMITED');assert.equal(calls,3);
});
test('AADE reviewer quota spans applications',async()=>{
 let calls=0;const h=handlers(async()=>{calls++;return matched();});
 for(let i=0;i<6;i++){const a=app();assert.equal((await h.POST(request(body(a)),a.id)).status,200);}
 const a=app();await error(await h.POST(request(body(a)),a.id),429,'CHECK_RATE_LIMITED');assert.equal(calls,6);
});
test('AADE ciphertext and authenticated metadata tampering are rejected',async()=>{
 const a=app(),h=handlers();await h.POST(request(body(a)),a.id);const original=database().prepare('SELECT * FROM aade_checks').get()!;
 for(const [column,value] of [['ciphertext','00'.repeat(String(original.ciphertext).length/2)],['auth_tag','00'.repeat(16)],['nonce','00'.repeat(12)],['request_id',randomUUID()]] as const){
  database().prepare(`UPDATE aade_checks SET ${column}=?`).run(value);
  await error(await h.GET(request(),a.id),500,'EVIDENCE_INTEGRITY_ERROR');
  database().prepare(`UPDATE aade_checks SET ${column}=?`).run(original[column]);
 }
});
test('AADE ciphertext cannot be transplanted to another application/version',async()=>{
 const a=app(),b=app(),h=handlers();await h.POST(request(body(a)),a.id);
 database().prepare('UPDATE aade_checks SET application_id=?,application_version=?').run(b.id,b.updatedAt);
 await error(await h.GET(request(),b.id),500,'EVIDENCE_INTEGRITY_ERROR');
});
test('AADE key rotation/missing key during lookup discards rather than attaching unreadable evidence',async()=>{
 const a=app(),d=deferred(),h=handlers(async()=>d.promise);const pending=h.POST(request(body(a)),a.id);await reserved();
 process.env.AADE_EVIDENCE_KEY_HEX=randomBytes(32).toString('hex');
 d.release(matched());await error(await pending,503,'EVIDENCE_KEY_CHANGED');const row=database().prepare('SELECT * FROM aade_checks').get()!;assert.equal(row.state,'discarded');assert.equal(row.ciphertext,null);
});
test('AADE stored evidence fails closed without its key version',async()=>{
 const a=app(),h=handlers();await h.POST(request(body(a)),a.id);process.env.AADE_EVIDENCE_KEY_ID='different';
 await error(await h.GET(request(),a.id),503,'EVIDENCE_KEY_UNAVAILABLE');
});
test('AADE local operation and database remain blocked in production',async()=>{
 const a=app();Object.assign(process.env,{NODE_ENV:'production'});try{
  await error(await handlers().POST(request(body(a)),a.id),503,'PRODUCTION_BACKEND_REQUIRED');
  await error(await handlers().GET(request(),a.id),503,'PRODUCTION_BACKEND_REQUIRED');
 }finally{Object.assign(process.env,{NODE_ENV:'test'});}
});
