import { randomUUID } from 'node:crypto';
import { applicationSchema, categories, routes, emptyApplication, validateSubmission, requiresSpecialistReview, type ApplicationInput, type ProviderApplication, type ProviderCard } from '@mastoli/core';
import { ApiError, boundedString } from './http';
import { database, transaction } from './database';
import type { SessionUser } from './auth';

type ApplicationRow = { id:string;owner_id:string;input_json:string;status:ProviderApplication['status'];created_at:string;updated_at:string;review_reason:string|null;published_slug:string|null;source_card_slug:string|null };
// Ensure every write has a distinct version even when two writes share a clock tick.
function nextTimestamp(previous:string):string {return new Date(Math.max(Date.now(),Date.parse(previous)+1)).toISOString();}
function scopePreview(scope:string,limit:number):string {
  if(scope.length<=limit)return scope;
  const prefix=scope.slice(0,limit-1).replace(/[\uD800-\uDBFF]$/, '');
  const wordBoundary=prefix.lastIndexOf(' ');
  return (wordBoundary>limit/2?prefix.slice(0,wordBoundary):prefix).trimEnd()+'…';
}
function project(row:ApplicationRow):ProviderApplication {
  return { ...JSON.parse(row.input_json),id:row.id,ownerId:row.owner_id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,...(row.review_reason ? {reviewReason:row.review_reason}:{}),...(row.published_slug ? {cardSlug:row.published_slug}:{}) };
}

const limits: Record<keyof ApplicationInput, number> = {route:30,category:30,displayName:100,area:100,phone:24,email:254,website:300,instagramUrl:300,facebookUrl:300,linkedinUrl:300,description:1200,businessTaxId:9,gemiNumber:12,gemiApplicability:20,justification:1200,employerName:160,professionCredential:1200,declaration:0,evidenceNotes:2000,serviceScope:600};
function draftInput(raw:Record<string,unknown>,previous:ApplicationInput=emptyApplication):ApplicationInput {
  const input = {...previous};
  for (const [key,value] of Object.entries(raw)) {
    if (!Object.hasOwn(limits,key)) throw new ApiError(422,'UNKNOWN_FIELD',`Unexpected application field: ${key}.`);
    if (key==='declaration') { if(typeof value!=='boolean')throw new ApiError(422,'INVALID_FIELD','Confirm the declaration with a boolean value.');input.declaration=value; }
    else (input as unknown as Record<string,unknown>)[key]=boundedString(value,key,limits[key as keyof ApplicationInput]);
  }
  if(!routes.includes(input.route)||!categories.includes(input.category)||!['required','not_required','unknown'].includes(input.gemiApplicability))throw new ApiError(422,'INVALID_FIELD','Select a valid category and work route.');
  return input;
}

function ownedRow(id:string,user:SessionUser):ApplicationRow {
  const row=database().prepare('SELECT * FROM applications WHERE id=?').get(id) as ApplicationRow|undefined;
  if(!row || (user.role!=='reviewer'&&row.owner_id!==user.id))throw new ApiError(404,'NOT_FOUND','Application not found.');
  return row;
}

export function listApplications(user:SessionUser,reviewer=false):ProviderApplication[] {
  if(reviewer&&user.role!=='reviewer')throw new ApiError(403,'FORBIDDEN','Reviewer access is required.');
  const rows=reviewer ? database().prepare("SELECT * FROM applications WHERE status <> 'draft' ORDER BY updated_at DESC").all() : database().prepare('SELECT * FROM applications WHERE owner_id=? ORDER BY updated_at DESC').all(user.id);
  return (rows as unknown as ApplicationRow[]).map(project);
}
export function getApplication(id:string,user:SessionUser) {return project(ownedRow(id,user));}
export function createApplication(raw:Record<string,unknown>,user:SessionUser):ProviderApplication {
  if(user.role!=='provider')throw new ApiError(403,'FORBIDDEN','Provider accounts create applications.');
  const count=database().prepare("SELECT count(*) AS n FROM applications WHERE owner_id=? AND status IN ('draft','submitted','needs_information')").get(user.id) as {n:number};
  if(count.n>=20)throw new ApiError(409,'APPLICATION_LIMIT','Finish or remove existing applications before creating more.');
  const input=draftInput(raw);const id=randomUUID();const now=new Date().toISOString();
  database().prepare('INSERT INTO applications(id,owner_id,input_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,user.id,JSON.stringify(input),'draft',now,now);
  return getApplication(id,user);
}
export function updateApplication(id:string,raw:Record<string,unknown>,user:SessionUser):ProviderApplication {
  const row=ownedRow(id,user);
  if(row.owner_id!==user.id)throw new ApiError(403,'FORBIDDEN','Only the applicant can edit this application.');
  if(!['draft','needs_information'].includes(row.status))throw new ApiError(409,'APPLICATION_LOCKED','This application is locked for review. Create a revision for an approved card.');
  const input=draftInput(raw,JSON.parse(row.input_json));
  database().prepare('UPDATE applications SET input_json=?,updated_at=? WHERE id=?').run(JSON.stringify(input),nextTimestamp(row.updated_at),id);
  return getApplication(id,user);
}
export function deleteApplication(id:string,user:SessionUser) {
  const row=ownedRow(id,user);
  if(row.owner_id!==user.id || row.status!=='draft')throw new ApiError(409,'APPLICATION_LOCKED','Only your unpublished drafts can be deleted.');
  database().prepare('DELETE FROM applications WHERE id=?').run(id);
}
export function submitApplication(id:string,user:SessionUser):ProviderApplication {
  const row=ownedRow(id,user);
  if(row.owner_id!==user.id)throw new ApiError(403,'FORBIDDEN','Only the applicant can submit this application.');
  if(!['draft','needs_information'].includes(row.status))throw new ApiError(409,'APPLICATION_LOCKED','Only drafts and returned applications can be submitted.');
  const parsed=applicationSchema.safeParse(JSON.parse(row.input_json));
  if(!parsed.success)throw new ApiError(422,'INVALID_APPLICATION',parsed.error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join(' '));
  const errors=validateSubmission(parsed.data);
  if(errors.length)throw new ApiError(422,'INVALID_APPLICATION',errors.map(x=>`${x.field}: ${x.message}`).join(' '));
  database().prepare("UPDATE applications SET input_json=?,status='submitted',updated_at=? WHERE id=?").run(JSON.stringify(parsed.data),nextTimestamp(row.updated_at),id);
  return getApplication(id,user);
}

export function createRevision(id:string,user:SessionUser):ProviderApplication {
  const row=ownedRow(id,user);
  if(row.owner_id!==user.id||row.status!=='approved'||!row.published_slug)throw new ApiError(409,'REVISION_UNAVAILABLE','Only the owner of an approved card can create a revision.');
  const existing=database().prepare("SELECT * FROM applications WHERE owner_id=? AND source_card_slug=? AND status IN ('draft','submitted','needs_information')").get(user.id,row.published_slug) as ApplicationRow|undefined;
  if(existing)return project(existing);
  const result=createApplication(JSON.parse(row.input_json),user);
  database().prepare('UPDATE applications SET source_card_slug=? WHERE id=?').run(row.published_slug,result.id);
  return result;
}

export function reviewApplication(id:string,raw:Record<string,unknown>,reviewer:SessionUser):ProviderApplication {
  if(reviewer.role!=='reviewer')throw new ApiError(403,'FORBIDDEN','Reviewer access is required.');
  const decision=String(raw.decision);
  if(!['approve','request_information','reject'].includes(String(decision)))throw new ApiError(422,'INVALID_DECISION','Choose a review decision.');
  const expectedUpdatedAt=boundedString(raw.expectedUpdatedAt,'Application version',30,true);
  const reason=boundedString(raw.reason,'Review reason',1200,true);
  if(reason.length<10)throw new ApiError(422,'REVIEW_REASON_REQUIRED','Explain the review outcome in at least 10 characters.');
  const scope=boundedString(raw.serviceScope,'Approved service scope',600);
  const checks=raw.checks && typeof raw.checks==='object'&&!Array.isArray(raw.checks) ? raw.checks as Record<string,unknown> : {};
  const checkResult={identity:checks.identity===true,workBasis:checks.workBasis===true,credentials:checks.credentials===true,representation:checks.representation===true};
  return transaction(db=>{
    const row=ownedRow(id,reviewer);
    if(row.status!=='submitted')throw new ApiError(409,'APPLICATION_LOCKED','Only submitted applications can be reviewed.');
    if(row.updated_at!==expectedUpdatedAt)throw new ApiError(409,'STALE_REVIEW','This application changed after you opened it. Reload it and review the latest submission before deciding.');
    const input=JSON.parse(row.input_json) as ApplicationInput;
    if(decision==='approve') {
      if(requiresSpecialistReview(input.route))throw new ApiError(409,'SPECIALIST_CHECKLIST_REQUIRED','This work route needs a validated specialist checklist. Request information or retain it for specialist review; it cannot be published by this local reviewer flow.');
      if(!Object.values(checkResult).every(Boolean)||scope.length<5)throw new ApiError(422,'CHECKS_REQUIRED','Complete all four checks and specify the approved service scope.');
      const parsed=applicationSchema.safeParse(input);
      if(!parsed.success||validateSubmission(input).length)throw new ApiError(422,'INVALID_APPLICATION','The submitted application no longer satisfies the current checklist.');
    }
    const now=nextTimestamp(row.updated_at);
    let slug=row.published_slug;
    if(decision==='approve') {
      slug=row.source_card_slug || `provider-${row.id.slice(0,18)}`;
      const card:ProviderCard={id:slug,slug,displayName:input.displayName,tagline:scopePreview(scope,160),category:input.category,area:input.area,description:input.description,phone:input.phone,email:input.email,website:input.website,links:[{label:'Instagram',url:input.instagramUrl},{label:'Facebook',url:input.facebookUrl},{label:'LinkedIn',url:input.linkedinUrl}].filter(link=>link.url),accent:'#DCE8E4',initials:input.displayName.split(/\s+/).slice(0,2).map(x=>Array.from(x)[0]).join('').toUpperCase(),route:input.route,verificationLabel:'Local review · Τοπική δοκιμή',updatedAt:now,isDemo:false,scope,services:[scopePreview(scope,120)]};
      db.prepare('INSERT INTO cards(slug,application_id,public_json,published_at) VALUES(?,?,?,?) ON CONFLICT(slug) DO UPDATE SET application_id=excluded.application_id,public_json=excluded.public_json,published_at=excluded.published_at').run(slug,id,JSON.stringify(card),now);
    }
    const status=decision==='approve'?'approved':decision==='reject'?'rejected':'needs_information';
    db.prepare('UPDATE applications SET status=?,updated_at=?,review_reason=?,published_slug=? WHERE id=?').run(status,now,reason,slug,id);
    db.prepare('INSERT INTO reviews(id,application_id,reviewer_id,decision,reason,checks_json,scope,created_at,input_snapshot) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,reviewer.id,decision,reason,JSON.stringify(checkResult),scope,now,row.input_json);
    return getApplication(id,reviewer);
  });
}

export function reviewHistory(id:string,user:SessionUser) {
  ownedRow(id,user);
  return database().prepare('SELECT decision,reason,scope,checks_json AS checksJson,created_at AS createdAt FROM reviews WHERE application_id=? ORDER BY created_at').all(id);
}
