import { startTestMail, finishEmailVerification } from './mail-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import Session from './models/Session.js';
import { totp } from './controllers/totp.js';

// Supply a disposable database only. Records use a unique test email and are removed on completion.
test('security flows with real MongoDB: MFA, recovery, replay, sessions and activity ownership', { skip: !process.env.TEST_MONGODB_URI, timeout: 60000 }, async () => {
  const mailer = await startTestMail();
  const secret = 'integration-secret-at-least-32-characters-long';
  const port = 5019, origin = 'http://localhost:5179', base = `http://127.0.0.1:${port}/api`;
  const server = spawn(process.execPath, ['server.js'], { cwd: new URL('.',import.meta.url), env: { ...process.env, ...mailer.env, PORT: String(port), CLIENT_ORIGIN: origin, JWT_SECRET: secret, MONGODB_URI: process.env.TEST_MONGODB_URI, NODE_ENV: 'test' }, stdio: 'ignore' });
  const exit = once(server,'exit');
  await mongoose.connect(process.env.TEST_MONGODB_URI);
  const email = `security-${Date.now()}@example.com`, password = 'TestPassword123!';
  const a = {}, b = {}, c = {}, other = {};
  async function request(client, path, method = 'GET', body) {
    const response = await fetch(base+path,{ method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: Object.entries(client).map(([k,v]) => `${k}=${v}`).join('; '), 'User-Agent': 'FinSight security integration test' }, body: body ? JSON.stringify(body) : undefined });
    for (const cookie of response.headers.getSetCookie()) { const [name,...value] = cookie.split(';')[0].split('='); if (value.join('=')) client[name] = value.join('='); else delete client[name]; }
    const data = await response.json();
    if (path === '/auth/register' && response.status === 200) await finishEmailVerification(client, body.email, request, mailer.messages);
    return { status: response.status, data };
  }
  try {
    let ready = false;
    for (let tries=0;tries<100;tries++) { try { await fetch(base+'/auth/me'); ready=true; break; } catch { await new Promise(r=>setTimeout(r,50)); } }
    assert.ok(ready,'API started');
    assert.equal((await request(a,'/auth/register','POST',{ name:'Security Test',email,password })).status,200);
    const id = (await request(a,'/auth/me')).data.user.id;
    assert.equal((await request(b,'/auth/login','POST',{ email,password })).status,200);
    const bToken = b.token;
    let sessions = (await request(a,'/security/sessions')).data;
    assert.equal(sessions.length,2); assert.equal(sessions.filter(s=>s.current).length,1);
    const bId = sessions.find(s=>!s.current)._id;
    assert.equal((await request(other,'/auth/register','POST',{ name:'Other',email:'other-'+email,password })).status,200);
    assert.equal((await request(other,'/security/sessions/'+bId,'DELETE')).status,404);
    assert.equal((await request(a,'/security/sessions/'+bId,'DELETE')).status,200);
    assert.equal((await request({token:bToken},'/auth/me')).status,401);
    assert.equal((await request(a,'/security/two-factor/setup','POST',{ password:'wrong' })).status,400);
    const setup = await request(a,'/security/two-factor/setup','POST',{ password }); assert.equal(setup.status,200);
    assert.equal((await request(a,'/security/two-factor')).data.enabled,false);
    assert.equal((await request(a,'/security/two-factor/enable','POST',{ password,code:'wrong' })).status,400);
    const step = Math.floor(Date.now()/30000), code = totp(setup.data.secret,step);
    const enabled = await request(a,'/security/two-factor/enable','POST',{ password,code }); assert.equal(enabled.status,200);
    const codes = enabled.data.recoveryCodes; assert.equal(codes.length,10);
    const stored = await User.findById(id).select('+twoFactorSecret +recoveryHashes');
    assert.notEqual(stored.twoFactorSecret,setup.data.secret); assert.ok(!stored.recoveryHashes.includes(codes[0]));
    assert.equal((await request(b,'/auth/login','POST',{ email,password })).data.requiresTwoFactor,true);
    assert.equal((await request({token:b.mfa},'/auth/me')).status,401,'MFA challenge cannot authenticate');
    assert.equal((await request(b,'/auth/verify-2fa','POST',{ code })).status,400,'setup code cannot be replayed');
    const challenge = b.mfa;
    assert.equal((await request(b,'/auth/verify-2fa','POST',{ code:codes[0] })).status,200);
    assert.equal((await request({ mfa:challenge },'/auth/verify-2fa','POST',{ code:codes[1] })).status,401);
    assert.equal((await request(c,'/auth/login','POST',{ email,password })).data.requiresTwoFactor,true);
    assert.equal((await request(c,'/auth/verify-2fa','POST',{ code:codes[0] })).status,400,'recovery code is single-use');
    assert.equal((await request(c,'/auth/verify-2fa','POST',{ code:totp(setup.data.secret,step+1) })).status,200);
    const bSessionToken=b.token,cSessionToken=c.token;
    assert.equal((await request(a,'/security/sessions/others','DELETE')).status,200);
    assert.equal((await request({token:bSessionToken},'/auth/me')).status,401);
    assert.equal((await request({token:cSessionToken},'/auth/me')).status,401);
    assert.equal((await request(a,'/auth/me')).status,200);
    assert.equal((await request(b,'/auth/login','POST',{ email,password })).data.requiresTwoFactor,true);
    await Session.updateOne({ _id:jwt.decode(b.mfa).sid },{ $set:{ expiresAt:new Date(0) } });
    assert.equal((await request(b,'/auth/verify-2fa','POST',{ code:codes[1] })).status,401,'expired challenge rejected');
    assert.equal((await request(b,'/auth/login','POST',{ email,password })).data.requiresTwoFactor,true);
    await Session.updateOne({ _id:jwt.decode(b.mfa).sid },{ $set:{ attempts:5 } });
    assert.equal((await request(b,'/auth/verify-2fa','POST',{ code:codes[1] })).status,401,'attempt limit enforced');
    assert.equal((await request(a,'/security/two-factor/disable','POST',{ password:'wrong',code:codes[1] })).status,400);
    assert.equal((await request(a,'/security/two-factor/disable','POST',{ password,code:codes[1] })).status,200);
    const row = (await request(a,'/transactions','POST',{ title:'Delete test',amount:100,type:'expense',category:'Food',date:'2026-10-01' })).data;
    assert.equal((await request(a,'/transactions/'+row._id,'DELETE')).status,200);
    const activity = (await request(a,'/security/activity')).data;
    assert.ok(activity.events.some(e=>e.action==='two_factor_disabled')); assert.ok(activity.events.some(e=>e.action==='transaction_deleted'));
    const otherActivity=(await request(other,'/security/activity')).data.events;
    assert.ok(otherActivity.every(e=>['account_created','email_verified'].includes(e.action)));
    assert.equal((await request(a,'/auth/login','POST',{ email,password:'wrong' })).status,401);
    assert.ok((await request(a,'/security/activity')).data.events.some(e=>e.action==='login_failed'));
    const token = a.token;
    assert.equal((await request(a,'/auth/logout','POST')).status,200);
    assert.equal((await request({token},'/auth/me')).status,401,'logout revokes copied cookie');
    const legacy = jwt.sign({ id },secret,{expiresIn:'7d'});
    assert.equal((await request({token:legacy},'/auth/me')).status,401,'old stateless tokens rejected');
    const ids = (await User.find({email:{$in:[email,'other-'+email]}})).map(u=>u._id);
    await mongoose.connection.collection('securityevents').deleteMany({userId:{$in:ids}});
    await Session.deleteMany({userId:{$in:ids}}); await User.deleteMany({_id:{$in:ids}});
  } finally { server.kill(); await exit; await mongoose.disconnect(); await mailer.close(); }
});
