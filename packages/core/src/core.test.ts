import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCardLink,isSafeWebUrl,isValidAfm,validateSubmission,emptyApplication,requiresSpecialistReview} from './index';
test('QR input only accepts canonical trusted profile URLs',()=>{
 assert.equal(parseCardLink('https://cards.example/c/nikos-water','https://cards.example'),'nikos-water');
 for(const input of ['javascript:alert(1)','https://evil.example/c/nikos','https://cards.example@evil.example/c/nikos','https://cards.example/c/../../admin','https://cards.example/admin','https://user:secret@cards.example/c/nikos'])assert.equal(parseCardLink(input,'https://cards.example'),null);
 assert.equal(parseCardLink('http://localhost:3000/c/nikos','http://localhost:3000'),'nikos');
 assert.equal(parseCardLink('http://cards.example/c/nikos','http://cards.example'),null);
});
test('website validation rejects executable schemes and credential URLs',()=>{
 assert.equal(isSafeWebUrl('https://example.com'),true);
 for(const value of ['javascript:alert(1)','http://example.com','https://a:b@example.com','not a URL'])assert.equal(isSafeWebUrl(value),false);
});
test('GEMI requirements depend on route and stated applicability',()=>{
 const applicant={...emptyApplication,route:'independent' as const,gemiApplicability:'not_required' as const,justification:'Non-commercial activity, subject to review.',businessTaxId:'094259216',declaration:true,category:'professional' as const};
 assert.equal(isValidAfm(applicant.businessTaxId),true);
 assert.equal(validateSubmission(applicant).some(e=>e.field==='gemiNumber'),false);
 assert.equal(validateSubmission({...applicant,gemiApplicability:'required'}).some(e=>e.field==='gemiNumber'),true);
 assert.equal(validateSubmission({...applicant,businessTaxId:'000000000'}).some(e=>e.field==='businessTaxId'),true);
});
test('employment does not require a business AFM but does require affiliation',()=>{
 const applicant={...emptyApplication,route:'employee' as const,gemiApplicability:'not_required' as const,category:'professional' as const,declaration:true};
 assert.equal(validateSubmission(applicant).some(e=>e.field==='businessTaxId'),false);
 assert.equal(validateSubmission(applicant).some(e=>e.field==='employerName'),true);
});
test('special arrangements cannot be silently treated as standard independent businesses',()=>{
 for(const route of ['household','construction','occasional','other'] as const)assert.equal(requiresSpecialistReview(route),true);
 assert.equal(requiresSpecialistReview('business'),false);
 const errors=validateSubmission({...emptyApplication,route:'household',category:'electrician',gemiApplicability:'not_required'});
 assert.ok(errors.some(e=>e.field==='route'));
 assert.ok(errors.some(e=>e.field==='justification'));
});
