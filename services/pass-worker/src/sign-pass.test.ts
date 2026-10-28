import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoCards} from '@mastoli/core';
import {signProviderPass} from './sign-pass';

test('unconfigured signer never returns an unsigned file',async()=>{
 await assert.rejects(()=>signProviderPass({...demoCards[0],isDemo:false},{}),/not configured and approved/);
});
test('fictional cards cannot be signed as live credentials',async()=>{
 const env={APPLE_ISSUER_APPROVED:'1',APPLE_PASS_TYPE_IDENTIFIER:'pass.example',APPLE_TEAM_IDENTIFIER:'example',APPLE_WWDR_CERT_PATH:'/unused',APPLE_SIGNER_CERT_PATH:'/unused',APPLE_SIGNER_KEY_PATH:'/unused',APPLE_PASS_ASSETS_DIR:'/unused',PUBLIC_CARD_ORIGIN:'https://example.test'};
 await assert.rejects(()=>signProviderPass(demoCards[0],env),/Fictional/);
 await assert.rejects(()=>signProviderPass({...demoCards[0],isDemo:false},{...env,PUBLIC_CARD_ORIGIN:'http://example.test'}),/HTTPS/);
});
