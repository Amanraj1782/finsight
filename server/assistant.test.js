import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { aiConfig, monthWindow, buildSnapshot, promptMessages, parseAnswer, aiStatus } from './controllers/assistant.js';
const now=new Date('2026-11-03T12:00:00Z');
const row=(date,type,amount,category='Food')=>({date,type,amount,category,title:'PRIVATE TITLE',description:'PRIVATE NOTE',userId:'private-user'});
test('AI snapshot uses integer paise, selected month and supported three-month baseline',()=>{
  const data=[row('2026-11-01','income',100000),row('2026-11-02','expense',20000),row('2026-10-01','expense',10000),row('2026-09-01','expense',20000),row('2026-08-01','expense',30000),row('2026-11-30','expense',999999)];
  const s=buildSnapshot(data,'2026-11',now);
  assert.equal(s.partialMonth,true);assert.equal(s.recordedTransactions,2);assert.equal(s.facts.find(f=>f.id==='net').value,80000);
  assert.equal(s.facts.find(f=>f.id==='prior_average').value,20000);assert.equal(s.facts.find(f=>f.id==='scenario_10').value,2000);
  assert.ok(s.threeMonthBaselineAvailable);assert.ok(!JSON.stringify(s).includes('PRIVATE'));assert.ok(!JSON.stringify(s).includes('private-user'));
  assert.equal(buildSnapshot(data,'2026-10',now).partialMonth,false);
});
test('no invented history, zero-income division or prototype-key corruption',()=>{
  const s=buildSnapshot([row('2026-11-01','expense',1500,'__proto__')],'2026-11',now);
  assert.equal(s.threeMonthBaselineAvailable,false);assert.ok(!s.facts.some(f=>f.id==='prior_average'||f.id==='savings_rate'));
  assert.equal(s.facts.find(f=>f.id==='category_1').value,1500);
  assert.equal(buildSnapshot([],'2026-11',now).recordedTransactions,0);
  for(const month of ['2026-13','2027-01','1800-01','not-a-month',{},'2026-1'])assert.throws(()=>monthWindow(month,now));
});
test('AI output must reference real facts and is treated as text',()=>{
  const s=buildSnapshot([row('2026-11-01','expense',1500)],'2026-11',now);
  assert.equal(parseAnswer(JSON.stringify({answer:'Check Food spending.',steps:['Choose a weekly limit.'],factIds:['category_1']}),s).answer,'Check Food spending.');
  for(const bad of ['bad json',JSON.stringify({answer:'Invented',steps:[],factIds:['bank_balance']}),JSON.stringify({answer:'Test',steps:Array(4).fill('step'),factIds:['expenses']})])assert.throws(()=>parseAnswer(bad,s));
  const prompt=promptMessages(s,'How can I save more?','hinglish');assert.match(prompt[0].content,/Hinglish/);assert.match(prompt[0].content,/untrusted/);assert.equal(prompt.length,2);
});
test('local-only provider configuration rejects remote hosts and cloud models',()=>{
  const oldUrl=process.env.OLLAMA_URL,oldModel=process.env.OLLAMA_MODEL;
  try {
    process.env.OLLAMA_URL='http://127.0.0.1:11434';process.env.OLLAMA_MODEL='qwen2.5:1.5b';assert.equal(aiConfig().model,'qwen2.5:1.5b');
    for(const url of ['https://example.com','file:///tmp/model','http://127.0.0.1:11434/other','http://user:pass@localhost:11434']){process.env.OLLAMA_URL=url;assert.throws(()=>aiConfig());}
    process.env.OLLAMA_URL='http://localhost:11434';process.env.OLLAMA_MODEL='model:cloud';assert.throws(()=>aiConfig());
  }finally{if(oldUrl===undefined)delete process.env.OLLAMA_URL;else process.env.OLLAMA_URL=oldUrl;if(oldModel===undefined)delete process.env.OLLAMA_MODEL;else process.env.OLLAMA_MODEL=oldModel;}
});
test('AI readiness probes real local endpoint and reports missing model honestly',async()=>{
  const original=process.env.OLLAMA_URL;let installed=false;
  const server=createServer((req,res)=>{assert.equal(req.url,'/api/tags');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:installed?[{name:'qwen2.5:1.5b'}]:[]}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');process.env.OLLAMA_URL='http://127.0.0.1:'+server.address().port;
  try {let result;await aiStatus({}, {json:v=>result=v});assert.equal(result.ready,false);installed=true;await aiStatus({}, {json:v=>result=v});assert.equal(result.ready,true);}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(original===undefined)delete process.env.OLLAMA_URL;else process.env.OLLAMA_URL=original;}
});
