import { randomBytes, createHmac, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret() {
  let bits = '';
  for (const byte of randomBytes(20)) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g).map(part => alphabet[parseInt(part, 2)]).join('');
}
function decode(secret) {
  const bits = [...secret].map(char => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  return Buffer.from(bits.match(/.{8}/g).map(part => parseInt(part, 2)));
}
// RFC 6238 / RFC 4226: 30-second HMAC-SHA1 counters and dynamic truncation.
export function totp(secret, step, digits = 6) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', decode(secret)).update(counter).digest();
  const offset = mac.at(-1) & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
export function matchingStep(secret, code, lastStep = -1, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (candidate >= 0 && candidate > lastStep && timingSafeEqual(Buffer.from(totp(secret, candidate)), Buffer.from(code))) return candidate;
  }
  return null;
}
function key() {
  // A separate stable key can be supplied for production; no new local setup is required.
  return createHash('sha256').update('finsight-mfa\0' + (process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET)).digest();
}
export function encryptSecret(secret) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, encrypted, cipher.getAuthTag()].map(b => b.toString('base64url')).join('.');
}
export function decryptSecret(value) {
  const [iv, encrypted, tag] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv); cipher.setAuthTag(tag);
  return cipher.update(encrypted, undefined, 'utf8') + cipher.final('utf8');
}
export function recoveryHash(code) { return createHash('sha256').update(code.replaceAll('-', '').toUpperCase()).digest('hex'); }
export function newRecoveryCodes() { return Array.from({ length: 10 }, () => randomBytes(10).toString('hex').toUpperCase().match(/.{4}/g).join('-')); }
