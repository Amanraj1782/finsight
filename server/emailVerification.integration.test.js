import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import mongoose from 'mongoose';
import User from './models/User.js';
import { hashEmailCode } from './controllers/emailVerification.js';
import { startTestMail, emailCode } from './mail-fixture.mjs';

test('email OTP: SMTP, account binding, expiry, resend, replay, atomic attempts and lockout', { skip: !process.env.TEST_MONGODB_URI, timeout: 60000 }, async()=>{
  const mailer=await startTestMail(), origin='http://localhost:5199', base='http://127.0.0.1:5039/api';
  const env={...process.env,...mailer.env,MONGODB_URI:process.env.TEST_MONGODB_URI,CLIENT_ORIGIN:origin,PORT:'5039',NODE_ENV:'test',JWT_SECRET:'email-test-secret-over-32-characters-long'};
  const originalSecret=process.env.JWT_SECRET;process.env.JWT_SECRET=env.JWT_SECRET;
  const server=spawn(process.execPath,['server.js'],{cwd:new URL('.',import.meta.url),env,stdio:'ignore'}), exit=once(server,'exit');
  await mongoose.connect(process.env.TEST_MONGODB_URI);
  const email=`verification-${Date.now()}@example.com`, password='VerifyPassword123!', client={};
  async function request(c,path,method='GET',body){
    const res=await fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:Object.entries(c).map(([k,v])=>k+'='+v).join('; ')},body:body?JSON.stringify(body):undefined});
    const cookies=res.headers.getSetCookie();for(const cookie of cookies){const[k,...v]=cookie.split(';')[0].split('=');if(v.join('='))c[k]=v.join('=');else delete c[k];}
    return {status:res.status,data:await res.json(),cookies};
  }
  try{
    let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/auth/me');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready);
    assert.equal((await request({},'/auth/verify-email','POST',{code:'123456'})).status,401);
    const registered=await request(client,'/auth/register','POST',{name:'OTP Test',email,password,emailVerified:true});
    assert.equal(registered.status,200);assert.equal(registered.data.user.emailVerified,false);assert.equal(registered.data.verificationEmailSent,true);
    const code=emailCode(mailer.messages,email);assert.match(code,/^\d{6}$/);assert.equal(registered.data.code,undefined);
    let stored=await User.findOne({email}).select('+emailVerificationCodeHash +emailVerificationChallenge +emailVerificationExpiresAt');
    assert.equal(stored.emailVerificationCodeHash,hashEmailCode(stored.id,stored.emailVerificationChallenge,code));assert.notEqual(stored.emailVerificationCodeHash,code);
    assert.ok(+stored.emailVerificationExpiresAt>Date.now()+9*60000);assert.ok(+stored.emailVerificationExpiresAt<Date.now()+11*60000);
    assert.doesNotMatch(mailer.messages[0].raw,/#token=|Confirm email|https?:\/\//);
    for(const path of ['/transactions','/analytics/overview','/security/sessions','/assistant/context'])assert.equal((await request(client,path)).data.code,'EMAIL_NOT_VERIFIED');
    const count=mailer.messages.length;assert.equal((await request(client,'/auth/resend-verification','POST')).status,429);assert.equal(mailer.messages.length,count);
    assert.equal((await request(client,'/auth/verify-email','POST',{token:'a'.repeat(64)})).status,400,'old link tokens rejected');
    assert.equal((await request(client,'/auth/verify-email','POST',{code:{'$ne':null}})).status,400);
    await User.updateOne({_id:stored.id},{$set:{emailVerificationExpiresAt:new Date(0)}});
    assert.equal((await request(client,'/auth/verify-email','POST',{code})).status,400,'expired OTP rejected');
    await User.updateOne({_id:stored.id},{$set:{emailVerificationSentAt:new Date(0)}});
    assert.equal((await request(client,'/auth/resend-verification','POST')).status,200);
    const fresh=emailCode(mailer.messages,email),newStored=await User.findById(stored.id).select('+emailVerificationCodeHash +emailVerificationChallenge');
    assert.notEqual(newStored.emailVerificationChallenge,stored.emailVerificationChallenge);assert.notEqual(newStored.emailVerificationCodeHash,stored.emailVerificationCodeHash);
    // Six-digit draws can coincide; challenge rotation must still change the stored hash.
    if(fresh!==code)assert.equal((await request(client,'/auth/verify-email','POST',{code})).status,400,'old code rejected after resend');
    const consumed=await Promise.all([request(client,'/auth/verify-email','POST',{code:fresh}),request(client,'/auth/verify-email','POST',{code:fresh})]);
    assert.deepEqual(consumed.map(r=>r.status).sort(),[200,400]);assert.equal(consumed.find(r=>r.status===200).cookies.length,0);
    assert.equal((await request(client,'/auth/me')).data.user.emailVerified,true);assert.equal((await request(client,'/transactions')).status,200);
    assert.equal((await request(client,'/auth/verify-email','POST',{code:fresh})).status,400,'OTP cannot be replayed');
    stored=await User.findOne({email}).select('+emailVerificationCodeHash +emailVerificationChallenge');assert.equal(stored.emailVerificationCodeHash,undefined);assert.equal(stored.emailVerificationChallenge,undefined);
    await request(client,'/auth/logout','POST');assert.equal((await request(client,'/auth/login','POST',{email,password})).data.user.emailVerified,true);
    await User.collection.updateOne({_id:stored._id},{$unset:{emailVerified:'',emailVerifiedAt:''}});
    assert.equal((await request(client,'/transactions')).status,403,'legacy account still requires verification');
    mailer.reject=true;const failedClient={};
    const failed=await request(failedClient,'/auth/register','POST',{name:'Delivery Failure',email:'failed-'+email,password});
    assert.equal(failed.status,200);assert.equal(failed.data.verificationEmailSent,false);
    const failedUser=await User.findOne({email:'failed-'+email}).select('+emailVerificationCodeHash +emailVerificationSentAt');assert.equal(failedUser.emailVerificationCodeHash,undefined);assert.equal(failedUser.emailVerificationSentAt,undefined);
    mailer.reject=false;assert.equal((await request(failedClient,'/auth/resend-verification','POST')).status,200);
    const bCode=emailCode(mailer.messages,'failed-'+email);
    assert.equal((await request(client,'/auth/verify-email','POST',{code:bCode,email:'failed-'+email})).status,400,'cannot select another account');
    assert.equal((await request(failedClient,'/auth/verify-email','POST',{code:bCode})).status,200);
    const lockedClient={},lockedEmail='locked-'+email;
    assert.equal((await request(lockedClient,'/auth/register','POST',{name:'Locked Test',email:lockedEmail,password})).status,200);
    const lockCode=emailCode(mailer.messages,lockedEmail),wrong=lockCode==='000000'?'000001':'000000';
    const guesses=await Promise.all(Array.from({length:5},()=>request(lockedClient,'/auth/verify-email','POST',{code:wrong})));
    assert.deepEqual(guesses.map(r=>r.status).sort(),[400,400,400,400,429]);
    assert.equal((await request(lockedClient,'/auth/verify-email','POST',{code:lockCode})).status,429);
    assert.equal((await request(lockedClient,'/auth/resend-verification','POST')).status,429,'resend cannot bypass lockout');
    const locked=await User.findOne({email:lockedEmail}).select('+emailVerificationLockedUntil +emailVerificationAttempts');assert.equal(locked.emailVerificationAttempts,5);assert.ok(+locked.emailVerificationLockedUntil>Date.now()+14*60000);
    await User.updateOne({_id:locked.id},{$set:{emailVerificationLockedUntil:new Date(0),emailVerificationSentAt:new Date(0)}});
    assert.equal((await request(lockedClient,'/auth/resend-verification','POST')).status,200);
    assert.equal((await request(lockedClient,'/auth/verify-email','POST',{code:emailCode(mailer.messages,lockedEmail)})).status,200);
  }finally{
    const ids=(await User.find({email:{$in:[email,'failed-'+email,'locked-'+email]}})).map(u=>u._id);
    await mongoose.connection.collection('sessions').deleteMany({userId:{$in:ids}});await mongoose.connection.collection('securityevents').deleteMany({userId:{$in:ids}});await User.deleteMany({_id:{$in:ids}});
    server.kill();await exit;await mongoose.disconnect();await mailer.close();if(originalSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=originalSecret;
  }
});
