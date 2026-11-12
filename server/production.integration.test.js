import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('production serves React routes, JSON API errors, health and secure cookies', {skip:!process.env.TEST_MONGODB_URI,timeout:30000},async()=>{
  const origin='https://finsight.example.com',base='http://127.0.0.1:5049';
  const child=spawn(process.execPath,['server.js'],{cwd:new URL('.',import.meta.url),env:{...process.env,NODE_ENV:'production',PORT:'5049',CLIENT_ORIGIN:origin,MONGODB_URI:process.env.TEST_MONGODB_URI,JWT_SECRET:'production-test-secret-with-more-than-32-characters',SMTP_HOST:'',SMTP_FROM:'',TRUST_PROXY_HOPS:'1'},stdio:'ignore'});
  const exit=once(child,'exit');
  try{
    let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/api/health');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready);
    assert.equal((await (await fetch(base+'/api/health')).json()).status,'ok');
    for(const path of ['/','/assistant','/verify-email']){const response=await fetch(base+path,{headers:{Accept:'text/html'}});assert.equal(response.status,200);assert.match(await response.text(),/<div id="root">/);}
    const apiError=await fetch(base+'/api/does-not-exist');assert.match(apiError.headers.get('content-type'),/application\/json/);
    assert.equal((await fetch(base+'/assets/missing.js')).status,404);
    const blocked=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
    const register=await fetch(base+'/api/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Production Test',email:'production-'+Date.now()+'@example.com',password:'ProductionTest123!'})});
    assert.equal(register.status,200);const token=register.headers.getSetCookie().find(c=>c.startsWith('token='));assert.match(token,/HttpOnly/i);assert.match(token,/Secure/i);assert.match(token,/SameSite=Lax/i);
  }finally{child.kill();await exit;}
});
