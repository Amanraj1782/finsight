import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('Vercel handler imports without listening, connects concurrent API requests and preserves auth', {skip:!process.env.TEST_MONGODB_URI,timeout:30000},async()=>{
  const base='http://127.0.0.1:5048',origin='https://finsight-test.vercel.app';
  const child=spawn(process.execPath,['--input-type=module','-e',"const {default:app}=await import('./api/index.js'); app.listen(5048,'127.0.0.1');"],{cwd:new URL('../',import.meta.url),env:{...process.env,VERCEL:'1',NODE_ENV:'production',CLIENT_ORIGIN:origin,MONGODB_URI:process.env.TEST_MONGODB_URI,JWT_SECRET:'vercel-test-secret-at-least-32-characters',SMTP_HOST:'',SMTP_FROM:''},stdio:'ignore'});
  const exit=once(child,'exit');
  try {
    let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready);
    const health=await Promise.all(Array.from({length:8},()=>fetch(base+'/api/health')));
    for(const response of health){assert.equal(response.status,200);assert.equal((await response.json()).status,'ok');}
    const privateRoute=await fetch(base+'/api/auth/me');assert.equal(privateRoute.status,401);
    const blocked=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
    const missing=await fetch(base+'/api/missing');assert.equal(missing.status,401);assert.match(missing.headers.get('content-type'),/application\/json/);
    // Vercel serves the React build via its CDN, not through the API function.
    assert.equal((await fetch(base+'/assistant',{headers:{Accept:'text/html'}})).status,404);
  }finally{child.kill();await exit;}
});
