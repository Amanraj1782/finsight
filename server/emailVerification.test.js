import test from 'node:test';
import assert from 'node:assert/strict';
import { newEmailCode, hashEmailCode } from './controllers/emailVerification.js';
import { mailOptions } from './config/mail.js';
test('email OTP is six digits and its keyed hash is bound to the account and challenge',()=>{
  const original=process.env.JWT_SECRET;process.env.JWT_SECRET='test-email-code-secret-over-32-characters';
  try{
    for(let i=0;i<20;i++)assert.match(newEmailCode(),/^\d{6}$/);
    const hash=hashEmailCode('user-a','challenge-a','000123');assert.equal(hash.length,64);assert.notEqual(hash,'000123');
    assert.notEqual(hash,hashEmailCode('user-b','challenge-a','000123'));assert.notEqual(hash,hashEmailCode('user-a','challenge-b','000123'));assert.notEqual(hash,hashEmailCode('user-a','challenge-a','123000'));
  }finally{if(original===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=original;}
});
test('SMTP requires configuration and TLS except for a local development catcher',()=>{
  assert.throws(()=>mailOptions({}),/not configured/);
  assert.equal(mailOptions({SMTP_HOST:'smtp.example.com',SMTP_FROM:'noreply@example.com',SMTP_PORT:'587'}).requireTLS,true);
  assert.equal(mailOptions({SMTP_HOST:'smtp.example.com',SMTP_FROM:'noreply@example.com',SMTP_PORT:'465'}).secure,true);
  assert.equal(mailOptions({SMTP_HOST:'127.0.0.1',SMTP_FROM:'noreply@example.com',NODE_ENV:'test'}).ignoreTLS,true);
  assert.equal(mailOptions({SMTP_HOST:'127.0.0.1',SMTP_FROM:'noreply@example.com',NODE_ENV:'production'}).requireTLS,true);
  assert.throws(()=>mailOptions({SMTP_HOST:'smtp.example.com',SMTP_FROM:'noreply@example.com\r\nBcc: victim@example.com'}));
  assert.throws(()=>mailOptions({SMTP_HOST:'smtp.example.com',SMTP_FROM:'noreply@example.com',SMTP_USER:'incomplete'}));
});
