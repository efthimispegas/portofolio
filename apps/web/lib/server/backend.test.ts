import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyApplication,isValidAfm,providerCardSchema} from '@mastoli/core';
import {register,login,createSession,sessionUser,revokeSession,sessionCookie,developmentReviewer,requireUser} from './auth';
import {createApplication,updateApplication,submitApplication,getApplication,reviewApplication,reviewHistory,createRevision,listApplications} from './applications';
import {getPublicCard,getPublicCards,vcard} from './cards';
import {database,closeDatabase} from './database';
import {ApiError,requireMutationOrigin,readJson,requireLocalBackend,endpoint,rateLimit} from './http';

const temporary=mkdtempSync(join(tmpdir(),'portofolio-api-'));
Object.assign(process.env,{NODE_ENV:'test',LOCAL_DATABASE_PATH:join(temporary,'test.sqlite'),APP_ORIGIN:'http://localhost:3000',ALLOW_DEV_REVIEWER:'1',LOCAL_REVIEWER_KEY:'test-reviewer-secret-must-be-32-characters'});
after(()=>{closeDatabase();rmSync(temporary,{recursive:true,force:true});});
const fails=(fn:()=>unknown,status:number,code?:string)=>assert.throws(fn,(err:unknown)=>err instanceof ApiError&&err.status===status&&(!code||err.code===code));
const owner=register({email:'owner@example.test',password:' correct horse battery ',name:'Owner',role:'reviewer'});
const other=register({email:'other@example.test',password:'another strong password',name:'Other'});
const reviewer=developmentReviewer(new Request('http://localhost:3000/api/auth/dev-reviewer',{headers:{origin:'http://localhost:3000','x-dev-reviewer-key':process.env.LOCAL_REVIEWER_KEY!}}));
const fixture={...emptyApplication,displayName:'Test Provider',category:'cleaning' as const,area:'Athens',phone:'+302100001234',description:'Cleaning and maintenance for homes in Athens.',businessTaxId:'094259216',gemiNumber:'123456789012',declaration:true,evidenceNotes:'PRIVATE evidence NEVER public',serviceScope:'Home cleaning',instagramUrl:'https://www.instagram.com/example'};
const decision={decision:'approve',reason:'Identity and work basis reviewed in this local test.',serviceScope:'Home cleaning only',checks:{identity:true,workBasis:true,credentials:true,representation:true}};
function reviewCurrent(id:string,raw:Record<string,unknown>,user:typeof reviewer){return reviewApplication(id,{...raw,expectedUpdatedAt:getApplication(id,reviewer).updatedAt},user);}

test('authentication hashes credentials and expiring sessions; role cannot be requested',()=>{
 assert.equal(owner.role,'provider');
 assert.equal(login({email:owner.email,password:' correct horse battery '}).id,owner.id);
 fails(()=>login({email:owner.email,password:'correct horse battery'}),401);
 const token=createSession(owner);const request=new Request('http://localhost:3000',{headers:{cookie:sessionCookie(token)}});
 assert.equal(sessionUser(request)?.id,owner.id);fails(()=>requireUser(request,'reviewer'),403);
 const row=database().prepare('SELECT token_hash,expires_at FROM sessions WHERE user_id=?').get(owner.id)!;
 assert.notEqual(row.token_hash,token);assert.equal(String(row.token_hash).length,64);
 assert.match(String(database().prepare('SELECT password_hash FROM users WHERE id=?').get(owner.id)!.password_hash),/^[a-f0-9]{32}:[a-f0-9]{128}$/);
 revokeSession(request);assert.equal(sessionUser(request),null);
 const second=createSession(owner);database().prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(owner.id);
 assert.equal(sessionUser(new Request('http://localhost:3000',{headers:{cookie:sessionCookie(second)}})),null);
});

test('ownership, manual review, private projection, immutable submitted states and persistence',()=>{
 assert.ok(isValidAfm(fixture.businessTaxId));
 const draft=createApplication(fixture,owner);
 fails(()=>getApplication(draft.id,other),404);fails(()=>updateApplication(draft.id,{area:'Elsewhere'},other),404);
 assert.equal(getPublicCards().some(x=>x.displayName===fixture.displayName),false);
 fails(()=>reviewCurrent(draft.id,decision,owner),403);fails(()=>listApplications(owner,true),403);
 assert.equal(submitApplication(draft.id,owner).status,'submitted');
 fails(()=>updateApplication(draft.id,{area:'Elsewhere'},owner),409);
 fails(()=>reviewCurrent(draft.id,{...decision,checks:{}},reviewer),422);
 const approved=reviewCurrent(draft.id,decision,reviewer);assert.equal(approved.status,'approved');assert.ok(approved.cardSlug);
 const card=getPublicCard(approved.cardSlug!)!;assert.equal(card.scope,'Home cleaning only');
 assert.deepEqual(card.links,[{label:'Instagram',url:'https://www.instagram.com/example'}]);
 const raw=JSON.stringify(card);assert.ok(!raw.includes(fixture.businessTaxId));assert.ok(!raw.includes(fixture.evidenceNotes));assert.ok(!raw.includes('ownerId'));assert.ok(!raw.includes('gemiNumber'));
 assert.equal(reviewHistory(draft.id,reviewer).length,1);
 closeDatabase();assert.equal(getApplication(draft.id,owner).status,'approved');assert.equal(getPublicCard(approved.cardSlug!)?.slug,approved.cardSlug);
 const revision=createRevision(draft.id,owner);assert.equal(createRevision(draft.id,owner).id,revision.id);
 updateApplication(revision.id,{displayName:'Updated provider'},owner);assert.equal(getPublicCard(approved.cardSlug!)?.displayName,'Test Provider');
 submitApplication(revision.id,owner);const updated=reviewCurrent(revision.id,decision,reviewer);
 assert.equal(updated.cardSlug,approved.cardSlug);assert.equal(getPublicCard(approved.cardSlug!)?.displayName,'Updated provider');
});

test('returned application can resubmit; unresolved specialist routes cannot publish',()=>{
 const input={...fixture,route:'household',category:'cleaning',gemiApplicability:'not_required',businessTaxId:'',gemiNumber:'',justification:'Specific domestic services route requiring specialist validation.'};
 const draft=createApplication(input,owner);submitApplication(draft.id,owner);
 fails(()=>reviewCurrent(draft.id,decision,reviewer),409,'SPECIALIST_CHECKLIST_REQUIRED');
 const returned=reviewCurrent(draft.id,{decision:'request_information',reason:'Need specialist validation of this particular working arrangement.'},reviewer);
 assert.equal(returned.status,'needs_information');updateApplication(draft.id,{justification:'Additional details about the household services working arrangement.'},owner);assert.equal(submitApplication(draft.id,owner).status,'submitted');
 assert.equal(reviewHistory(draft.id,reviewer).length,1);
});

test('reject invalid drafts at submission and disallow unknown status/role fields',()=>{
 fails(()=>createApplication({status:'approved'},owner),422);
 const draft=createApplication({},owner);fails(()=>submitApplication(draft.id,owner),422);
 fails(()=>updateApplication(draft.id,{displayName:'x'.repeat(101)},owner),422);
});

test('mutation origin, body limit, malformed JSON and error envelopes',async()=>{
 rateLimit('test:unique',1);fails(()=>rateLimit('test:unique',1),429);
 const valid=new Request('http://localhost:3000/api/applications',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:'{}'});requireMutationOrigin(valid);assert.deepEqual(await readJson(valid),{});
 fails(()=>requireMutationOrigin(new Request('http://localhost:3000',{headers:{origin:'https://malicious.invalid'}})),403);
 fails(()=>requireMutationOrigin(new Request('http://localhost:3000')),403);
 fails(()=>requireMutationOrigin(new Request('http://localhost:3000',{headers:{origin:'http://localhost:3000',host:'evil.invalid'}})),403);
 const huge=new Request('http://localhost:3000',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:'x'.repeat(25000)})});await assert.rejects(()=>readJson(huge),(e:unknown)=>e instanceof ApiError&&e.status===413);
 const response=await endpoint(()=>{throw new ApiError(403,'FORBIDDEN','Denied');});assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:{code:'FORBIDDEN',message:'Denied'}});
});

test('dev reviewer requires opt-in, secret and loopback; production local storage is blocked',()=>{
 fails(()=>developmentReviewer(new Request('http://localhost:3000',{headers:{origin:'http://localhost:3000'}})),403);
 process.env.ALLOW_DEV_REVIEWER='0';fails(()=>developmentReviewer(new Request('http://localhost:3000')),404);process.env.ALLOW_DEV_REVIEWER='1';
 fails(()=>developmentReviewer(new Request('https://remote.invalid',{headers:{origin:'https://remote.invalid','x-dev-reviewer-key':process.env.LOCAL_REVIEWER_KEY!}})),403);
 Object.assign(process.env,{NODE_ENV:'production'});
 try{fails(()=>requireLocalBackend(),503);fails(()=>developmentReviewer(new Request('http://localhost:3000')),503);assert.equal(getPublicCards().every(x=>x.isDemo),true);}finally{Object.assign(process.env,{NODE_ENV:'test'});}
});

test('vCard escapes line injection and folds Unicode safely',()=>{
 const card={...getPublicCards()[0],displayName:'Example; Name, Inc',description:'one\nTEL:injected\\two '+ 'Ελληνικά'.repeat(30)};
 const text=vcard(card,'http://localhost:3000/c/example');
 assert.ok(text.includes('FN:Example\\; Name\\, Inc'));assert.ok(text.includes('one\\nTEL:injected\\\\two'));assert.ok(!text.includes('\r\nTEL:injected'));
 for(const line of text.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
});


test('review decisions are tied to the inspected version and cannot replay after a resubmission',()=>{
 const draft=createApplication(fixture,owner);
 const first=submitApplication(draft.id,owner);
 const returned=reviewApplication(draft.id,{decision:'request_information',reason:'Please clarify the services offered by this provider.',expectedUpdatedAt:first.updatedAt},reviewer);
 assert.notEqual(returned.updatedAt,first.updatedAt);
 updateApplication(draft.id,{description:'Updated cleaning and maintenance services for homes in Athens.'},owner);
 const resubmitted=submitApplication(draft.id,owner);
 fails(()=>reviewApplication(draft.id,{...decision,expectedUpdatedAt:first.updatedAt},reviewer),409,'STALE_REVIEW');
 assert.equal(getApplication(draft.id,owner).status,'submitted');
 assert.equal(reviewHistory(draft.id,reviewer).length,1);
 const approved=reviewApplication(draft.id,{...decision,expectedUpdatedAt:resubmitted.updatedAt},reviewer);
 assert.equal(approved.status,'approved');
 fails(()=>reviewApplication(draft.id,{...decision,expectedUpdatedAt:resubmitted.updatedAt},reviewer),409,'APPLICATION_LOCKED');
 assert.equal(reviewHistory(draft.id,reviewer).length,2);
});

test('owners can read decision history while other providers cannot and private snapshots stay excluded',()=>{
 const draft=createApplication(fixture,owner);submitApplication(draft.id,owner);
 reviewCurrent(draft.id,{decision:'request_information',reason:'Clarify the available professional evidence before review.'},reviewer);
 const history=reviewHistory(draft.id,owner);
 assert.equal(history.length,1);
 assert.equal(history[0].decision,'request_information');
 fails(()=>reviewHistory(draft.id,other),404);
 const serialized=JSON.stringify(history);
 assert.ok(!serialized.includes('input_snapshot'));
 assert.ok(!serialized.includes(fixture.evidenceNotes));
 assert.ok(!serialized.includes('reviewer_id'));
});

test('long approved scopes retain their full value and publish valid bounded card previews',()=>{
 const draft=createApplication(fixture,owner);submitApplication(draft.id,owner);
 const scope=('General household cleaning including floors, windows and kitchens. ').repeat(10).slice(0,600);
 const approved=reviewCurrent(draft.id,{...decision,serviceScope:scope},reviewer);
 const card=getPublicCard(approved.cardSlug!)!;
 assert.equal(card.scope,scope.trim());
 assert.ok(card.tagline.length<=160);
 assert.ok(card.services[0].length<=120);
 assert.ok(card.tagline.endsWith('…'));
 assert.ok(card.services[0].endsWith('…'));
 assert.ok(providerCardSchema.safeParse(card).success);
 assert.ok(!JSON.stringify(card).includes(fixture.evidenceNotes));
});
