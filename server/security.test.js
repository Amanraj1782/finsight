import test from 'node:test';
import assert from 'node:assert/strict';
import { totp, matchingStep, newSecret, encryptSecret, decryptSecret, newRecoveryCodes, recoveryHash } from './controllers/totp.js';
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
test('TOTP agrees with all SHA1 reference vectors in RFC 6238', () => {
  for (const [seconds, expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']]) assert.equal(totp(secret, Math.floor(seconds/30), 8), expected);
});
test('TOTP rejects replay, stale codes, malformed input and accepts clock skew', () => {
  const now = 1234567890000, step = Math.floor(now/30000), code = totp(secret,step);
  assert.equal(matchingStep(secret,code,-1,now),step);
  assert.equal(matchingStep(secret,code,step,now),null);
  assert.equal(matchingStep(secret,totp(secret,step-2),-1,now),null);
  assert.equal(matchingStep(secret,totp(secret,step+1),-1,now),step+1);
  for (const invalid of [123456, '', '12345', 'abcdef', {}, '1234567']) assert.equal(matchingStep(secret,invalid,-1,now),null);
});
test('authenticator secrets are authenticated encrypted, recovery codes have high entropy', () => {
  process.env.JWT_SECRET = 'unit-test-secret-with-more-than-32-characters';
  const value = newSecret(); assert.match(value,/^[A-Z2-7]{32}$/);
  const encrypted = encryptSecret(value); assert.ok(!encrypted.includes(value)); assert.equal(decryptSecret(encrypted),value);
  const parts = encrypted.split('.'); const bytes = Buffer.from(parts[1],'base64url'); bytes[0] ^= 1; parts[1] = bytes.toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.')));
  const codes = newRecoveryCodes(); assert.equal(codes.length,10); assert.equal(new Set(codes).size,10);
  assert.equal(recoveryHash(codes[0]),recoveryHash(codes[0].replaceAll('-','').toLowerCase()));
  assert.notEqual(recoveryHash(codes[0]),codes[0]);
});
