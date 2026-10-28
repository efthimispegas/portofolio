/** Local synthetic application operation. Deliberately has no live AADE client import. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isValidAfm } from '@mastoli/core';
import { requireUser, type SessionUser } from './auth';
import { database, transaction } from './database';
import { ApiError, boundedString, endpoint, readJson, requireMutationOrigin, success } from './http';
import type { AadeResult } from './aade-client';

type ApplicationRow = { id: string; status: string; updated_at: string; input_json: string };
type CheckRow = {
  request_id: string; application_id: string; application_version: string; reviewer_id: string;
  source: 'aade'; mode: 'synthetic'; state: 'running'|'completed'|'failed'|'stale'|'discarded';
  created_at: number; finished_at: number|null; key_id: string;
  nonce: string|null; auth_tag: string|null; ciphertext: string|null;
};
type Evidence = { outcome: string; observedAt: string; httpStatus?: number; evidence?: {
  legalName: string; afmStatusCode: string; afmStatusLabel: string; businessActivityStatus: string;
  normalVatRegime: string|null; activities: {code:string;description:string;kind:string;kindDescription:string}[];
} };
export type SyntheticAadeTransport = {
  mode: 'synthetic';
  // Server-code injection for isolated tests only. Not configurable by headers, JSON or env flags.
  lookup: (afm: string) => Promise<AadeResult>;
};
function keyConfig() {
  const hex=process.env.AADE_EVIDENCE_KEY_HEX ?? '', id=process.env.AADE_EVIDENCE_KEY_ID ?? '';
  if(!/^[0-9a-fA-F]{64}$/.test(hex)||! /^[a-zA-Z0-9_-]{1,64}$/.test(id))
    throw new ApiError(503,'EVIDENCE_KEY_REQUIRED','Private evidence encryption is not configured.');
  return {key:Buffer.from(hex,'hex'),id};
}
function aad(row:CheckRow) {
  return Buffer.from(JSON.stringify(['portofolio-aade-v1',row.application_id,row.application_version,row.source,row.request_id,row.reviewer_id,row.mode,row.key_id]));
}
function seal(value:Evidence,row:CheckRow,config:ReturnType<typeof keyConfig>) {
  const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',config.key,nonce);cipher.setAAD(aad(row));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return {nonce:nonce.toString('hex'),auth_tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')};
}
function open(row:CheckRow):Evidence {
  const config=keyConfig();
  if(config.id!==row.key_id)throw new ApiError(503,'EVIDENCE_KEY_UNAVAILABLE','The evidence key version is unavailable.');
  try {
    if(!row.nonce||!/^[a-f0-9]{24}$/.test(row.nonce)||!row.auth_tag||!/^[a-f0-9]{32}$/.test(row.auth_tag)||!row.ciphertext||!/^([a-f0-9]{2})+$/.test(row.ciphertext))throw Error();
    const decipher=createDecipheriv('aes-256-gcm',config.key,Buffer.from(row.nonce,'hex'));decipher.setAAD(aad(row));decipher.setAuthTag(Buffer.from(row.auth_tag,'hex'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.ciphertext,'hex')),decipher.final()]).toString('utf8')) as Evidence;
  } catch {throw new ApiError(500,'EVIDENCE_INTEGRITY_ERROR','Private evidence could not be authenticated.');}
}
// Explicit projection: injected/adapted objects cannot smuggle identifiers, credentials or raw XML into evidence.
function normalize(result:AadeResult):Evidence {
  const text=(s:unknown,max=4000)=>typeof s==='string'?s.slice(0,max):'';
  const outcomes=['configuration_error','invalid_request','timeout','network_error','http_error','rate_limited','redirect_rejected','response_too_large','soap_fault','application_error','malformed_response','incomplete_result','identity_mismatch','caller_context_mismatch','matched'];
  const outcome=outcomes.includes(result.outcome)?result.outcome:'malformed_response';
  const value:Evidence={outcome,observedAt:new Date().toISOString()};
  if(Number.isInteger(result.httpStatus)&&result.httpStatus!>=100&&result.httpStatus!<=599)value.httpStatus=result.httpStatus;
  if(result.outcome==='matched')value.evidence={
    legalName:text(result.evidence.legalName),afmStatusCode:text(result.evidence.afmStatusCode,1),
    afmStatusLabel:text(result.evidence.afmStatusLabel),businessActivityStatus:text(result.evidence.businessActivityStatus),
    normalVatRegime:result.evidence.normalVatRegime===null?null:text(result.evidence.normalVatRegime,20),
    activities:result.evidence.activities.slice(0,1000).map(a=>({code:text(a.code,100),description:text(a.description),kind:text(a.kind,100),kindDescription:text(a.kindDescription)})),
  };
  return value;
}
function application(id:string,version?:string):ApplicationRow {
  const app=database().prepare('SELECT id,status,updated_at,input_json FROM applications WHERE id=?').get(id) as ApplicationRow|undefined;
  if(!app)throw new ApiError(404,'NOT_FOUND','Application not found.');
  if(app.status!=='submitted')throw new ApiError(409,'APPLICATION_NOT_SUBMITTED','Only submitted applications can be checked.');
  if(version!==undefined&&app.updated_at!==version)throw new ApiError(409,'STALE_APPLICATION','Reload the application before checking it.');
  return app;
}
function projection(row:CheckRow,replayed=false) {
  return {requestId:row.request_id,applicationId:row.application_id,applicationVersion:row.application_version,
    source:row.source,method:'synthetic_test',state:row.state,createdAt:new Date(row.created_at).toISOString(),
    finishedAt:row.finished_at?new Date(row.finished_at).toISOString():null,publicationApproved:false,replayed,
    ...((row.state==='completed'||row.state==='failed')?{result:open(row)}:{})};
}
function requireSameReviewer(request:Request,user:SessionUser) {
  const fresh=requireUser(request,'reviewer');
  if(fresh.id!==user.id)throw new ApiError(403,'FORBIDDEN','Reviewer authorization changed.');
}

export function createAadeCheckHandlers(transport?:SyntheticAadeTransport) {
  return {
    POST(request:Request,applicationId:string):Promise<Response> {return endpoint(async()=>{
      requireMutationOrigin(request);const user=requireUser(request,'reviewer');
      const raw=await readJson(request);
      if(Object.keys(raw).some(k=>!['expectedUpdatedAt','requestId'].includes(k)))throw new ApiError(422,'UNKNOWN_FIELD','Only application version and request ID are accepted.');
      const version=boundedString(raw.expectedUpdatedAt,'Application version',30,true);
      const requestId=boundedString(raw.requestId,'Request ID',36,true).toLowerCase();
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(version)||!Number.isFinite(Date.parse(version))||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
        throw new ApiError(422,'INVALID_CHECK_REQUEST','Use the inspected version and a UUID request ID.');
      // Reject unconfigured/live wiring even when AADE credentials happen to exist in process.env.
      if(!transport||transport.mode!=='synthetic')throw new ApiError(503,'AADE_OPERATION_NOT_ENABLED','Application verification is awaiting managed-auth and private-storage integration.');
      const key=keyConfig();
      const reservation=transaction(db=>{
        requireSameReviewer(request,user);
        const app=application(applicationId,version);
        const afm=JSON.parse(app.input_json).businessTaxId;
        if(typeof afm!=='string'||!isValidAfm(afm))throw new ApiError(422,'AFM_REQUIRED','This submitted application has no valid business AFM.');
        const existing=db.prepare('SELECT * FROM aade_checks WHERE request_id=?').get(requestId) as CheckRow|undefined;
        if(existing){
          if(existing.application_id!==applicationId||existing.application_version!==version||existing.reviewer_id!==user.id)throw new ApiError(409,'REQUEST_ID_CONFLICT','Use a new request ID for this check.');
          if(existing.state==='running')throw new ApiError(409,'CHECK_IN_PROGRESS','This request is already in progress.');
          if(!['completed','failed'].includes(existing.state))throw new ApiError(409,'CHECK_NOT_REUSABLE','This attempt cannot be replayed.');
          return {replay:existing,afm,row:existing};
        }
        if(db.prepare("SELECT request_id FROM aade_checks WHERE application_id=? AND state='running'").get(applicationId))throw new ApiError(409,'CHECK_IN_PROGRESS','A check is already in progress for this application.');
        const now=Date.now();
        const count=(sql:string,...args:(string|number)[])=>(db.prepare(sql).get(...args) as {n:number}).n;
        if(count('SELECT count(*) AS n FROM aade_checks WHERE reviewer_id=? AND created_at>?',user.id,now-60_000)>=6||count('SELECT count(*) AS n FROM aade_checks WHERE application_id=? AND created_at>?',applicationId,now-3_600_000)>=3)
          throw new ApiError(429,'CHECK_RATE_LIMITED','Wait before requesting another check.');
        const row:CheckRow={request_id:requestId,application_id:applicationId,application_version:version,reviewer_id:user.id,source:'aade',mode:'synthetic',state:'running',created_at:now,finished_at:null,key_id:key.id,nonce:null,auth_tag:null,ciphertext:null};
        db.prepare("INSERT INTO aade_checks(request_id,application_id,application_version,reviewer_id,source,mode,state,created_at,key_id) VALUES(?,?,?,?,?,?,?,?,?)").run(requestId,applicationId,version,user.id,'aade','synthetic','running',now,key.id);
        return {replay:undefined,afm,row};
      });
      if(reservation.replay)return success(projection(reservation.replay,true));
      let result:Evidence;
      try{result=normalize(await transport.lookup(reservation.afm));}
      catch{result={outcome:'network_error',observedAt:new Date().toISOString()};}
      // No network request or await occurs within either database transaction.
      return transaction(db=>{
        let accessError:ApiError|undefined;
        try{requireSameReviewer(request,user);}catch{accessError=new ApiError(403,'REVIEWER_ACCESS_CHANGED','Reviewer access changed; the result was discarded.');}
        let stale=false;try{application(applicationId,version);}catch{stale=true;}
        if(accessError||stale){
          db.prepare('UPDATE aade_checks SET state=?,finished_at=? WHERE request_id=?').run(accessError?'discarded':'stale',Date.now(),requestId);
          // Return the response to commit discard metadata rather than throwing/rolling it back.
          const error=accessError??new ApiError(409,'STALE_APPLICATION','The application changed; the result was not attached.');
          return Response.json({error:{code:error.code,message:error.message}},{status:error.status,headers:{'Cache-Control':'no-store'}});
        }
        let currentKey:ReturnType<typeof keyConfig>|undefined;
        try{currentKey=keyConfig();}catch{/* Missing/rotated keys discard this result. */}
        if(!currentKey||currentKey.id!==key.id||!currentKey.key.equals(key.key)){
          db.prepare("UPDATE aade_checks SET state='discarded',finished_at=? WHERE request_id=?").run(Date.now(),requestId);
          return Response.json({error:{code:'EVIDENCE_KEY_CHANGED',message:'Evidence encryption changed; the result was discarded.'}},{status:503,headers:{'Cache-Control':'no-store'}});
        }
        const encrypted=seal(result,reservation.row,key);const state=result.outcome==='matched'?'completed':'failed';
        db.prepare('UPDATE aade_checks SET state=?,finished_at=?,nonce=?,auth_tag=?,ciphertext=? WHERE request_id=?').run(state,Date.now(),encrypted.nonce,encrypted.auth_tag,encrypted.ciphertext,requestId);
        return success(projection(db.prepare('SELECT * FROM aade_checks WHERE request_id=?').get(requestId) as CheckRow));
      });
    });},
    GET(request:Request,applicationId:string):Promise<Response> {return endpoint(()=>{
      requireUser(request,'reviewer');const app=application(applicationId);
      const rows=database().prepare('SELECT * FROM aade_checks WHERE application_id=? AND application_version=? ORDER BY created_at DESC LIMIT 20').all(applicationId,app.updated_at) as CheckRow[];
      return success(rows.map(row=>projection(row)));
    });},
  };
}
