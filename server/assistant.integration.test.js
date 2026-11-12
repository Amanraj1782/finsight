import { startTestMail, finishEmailVerification } from './mail-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('assistant API: private fresh data, real provider request, invalid output and offline handling', {skip:!process.env.TEST_MONGODB_URI,timeout:60000},async()=>{
  // This is an explicit Ollama protocol fixture, not an LLM or a production fallback.
  const mailer = await startTestMail();
  let mode='valid',lastPrompt,calls=0;
  const provider=createServer(async(req,res)=>{
    if(req.url==='/api/tags'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({models:[{name:'qwen2.5:1.5b'}]}));}
    assert.equal(req.url,'/api/chat');let body='';for await(const chunk of req)body+=chunk;
    const request=JSON.parse(body);assert.equal(request.stream,false);assert.equal(request.model,'qwen2.5:1.5b');assert.equal(request.format.type,'object');
    lastPrompt=JSON.parse(request.messages[1].content);calls++;
    res.setHeader('Content-Type','application/json');
    const reply={answer:'Consider choosing a weekly limit for your Food category.',steps:['Review recorded expenses before choosing a cut.'],factIds:mode==='invalid'?['invented_balance']:['expenses','category_1']};
    res.end(JSON.stringify({done:true,done_reason:mode==='truncated'?'length':'stop',message:{content:JSON.stringify(reply)}}));
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');
  const env={...process.env,...mailer.env,PORT:'5029',CLIENT_ORIGIN:'http://localhost:5189',JWT_SECRET:'test-only-assistant-secret-over-32-characters',OLLAMA_URL:'http://127.0.0.1:'+provider.address().port,OLLAMA_MODEL:'qwen2.5:1.5b',MONGODB_URI:process.env.TEST_MONGODB_URI,NODE_ENV:'test'};
  const server=spawn(process.execPath,['server.js'],{cwd:new URL('.',import.meta.url),env,stdio:'ignore'});const exit=once(server,'exit');
  const email='assistant-'+Date.now()+'@example.com',password='TestPassword123!',a={},b={};
  async function request(client,path,method='GET',body){
    const response=await fetch('http://127.0.0.1:5029/api'+path,{method,headers:{Origin:env.CLIENT_ORIGIN,'Content-Type':'application/json',Cookie:Object.entries(client).map(([k,v])=>k+'='+v).join('; ')},body:body?JSON.stringify(body):undefined});
    for(const cookie of response.headers.getSetCookie()){const [k,...v]=cookie.split(';')[0].split('=');if(v.join('='))client[k]=v.join('=');else delete client[k];}
    const data=await response.json();
    if(path==='/auth/register'&&response.status===200)await finishEmailVerification(client,body.email,request,mailer.messages);
    return {status:response.status,data};
  }
  try{
    let ready=false;for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:5029/api/auth/me');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready);
    const month=new Date().toISOString().slice(0,7),date=month+'-01';
    assert.equal((await request({},'/assistant/status')).status,401);
    assert.equal((await request(a,'/auth/register','POST',{name:'Private Name',email,password})).status,200);
    assert.equal((await request(b,'/auth/register','POST',{name:'Other Name',email:'other-'+email,password})).status,200);
    const transaction={title:'PRIVATE MERCHANT',description:'PRIVATE BANK NOTE',type:'expense',amount:12345,category:'Food',date};
    await request(a,'/transactions','POST',transaction);await request(b,'/transactions','POST',{...transaction,amount:999999,category:'OTHER USER PRIVATE CATEGORY'});
    const context=(await request(a,'/assistant/context?month='+month)).data;
    assert.equal(context.facts.find(f=>f.id==='expenses').value,12345);
    assert.ok(!JSON.stringify(context).includes('PRIVATE'));assert.ok(!JSON.stringify(context).includes(email));
    assert.equal((await request(a,'/assistant/status')).data.ready,true);
    assert.equal((await request(a,'/assistant/ask','POST',{question:'',month})).status,400);
    const ask={question:'How can I spend less?',month,language:'english',userId:'ignored',snapshot:{facts:[{id:'expenses',value:1}]}};
    const answer=await request(a,'/assistant/ask','POST',ask);assert.equal(answer.status,200);
    assert.equal(answer.data.snapshot.facts.find(f=>f.id==='expenses').value,12345);
    assert.equal(lastPrompt.financialSnapshot.facts.find(f=>f.id==='expenses').value,12345);
    assert.ok(!JSON.stringify(lastPrompt).includes('PRIVATE'));assert.ok(!JSON.stringify(lastPrompt).includes(password));
    await request(a,'/transactions','POST',{...transaction,amount:100});
    assert.equal((await request(a,'/assistant/ask','POST',ask)).data.snapshot.facts.find(f=>f.id==='expenses').value,12445,'each answer queries fresh data');
    mode='invalid';assert.equal((await request(a,'/assistant/ask','POST',ask)).status,502);
    mode='truncated';assert.equal((await request(a,'/assistant/ask','POST',ask)).status,502);
    await request(a,'/auth/register','POST',{name:'Empty',email:'empty-'+email,password});
    const before=calls;assert.equal((await request(a,'/assistant/ask','POST',ask)).status,400);assert.equal(calls,before,'empty account does not call model');
    provider.closeAllConnections();await new Promise(r=>provider.close(r));
    const offline=await request(b,'/assistant/ask','POST',ask);assert.equal(offline.status,503);assert.match(offline.data.message,/offline/);
    assert.equal((await request(b,'/assistant/status')).data.ready,false);
  }finally{server.kill();await exit;if(provider.listening){provider.closeAllConnections();await new Promise(r=>provider.close(r));}await mailer.close();}
});
