import { randomBytes, randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import User from '../models/User.js';
import { httpError } from './finance.js';
import { recordEvent, publicUser } from './security.js';
import { mailOptions, sendVerificationEmail } from '../config/mail.js';
export const newEmailCode = () => String(randomInt(0, 1000000)).padStart(6, '0');
export function hashEmailCode(userId, challenge, code) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  // A keyed hash protects low-entropy codes if someone reads only the database.
  return createHmac('sha256', process.env.JWT_SECRET).update(JSON.stringify(['email-otp', String(userId), challenge, code])).digest('hex');
}
const unlocked = now => ({ $or: [{ emailVerificationLockedUntil: { $lte: now } }, { emailVerificationLockedUntil: { $exists: false } }] });
function lockResponse(res, until) {
  const retryAfter = Math.max(1, Math.ceil((+until - Date.now())/1000));
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ message: 'Too many incorrect codes. Wait 15 minutes before trying again or requesting another OTP.', retryAfter });
}
export async function deliverVerification(user) {
  if (user.emailVerified) return { verificationEmailSent: false, alreadyVerified: true };
  try { mailOptions(); } catch(err) { return { verificationEmailSent: false, verificationMessage: err.message }; }
  const now = new Date(), code = newEmailCode(), challenge = randomBytes(16).toString('hex'), hash = hashEmailCode(user.id, challenge, code);
  const claimed = await User.findOneAndUpdate({ _id: user.id, emailVerified: { $ne: true }, $and: [unlocked(now), { $or: [{ emailVerificationSentAt: { $lte: new Date(+now - 60000) } }, { emailVerificationSentAt: { $exists: false } }] }] }, { $set: { emailVerificationCodeHash: hash, emailVerificationChallenge: challenge, emailVerificationAttempts: 0, emailVerificationExpiresAt: new Date(+now + 10*60000), emailVerificationSentAt: now }, $unset: { emailVerificationTokenHash: '', emailVerificationLockedUntil: '' } });
  if (!claimed) {
    const current = await User.findById(user.id).select('+emailVerificationLockedUntil');
    if (current?.emailVerified) return { verificationEmailSent: false, alreadyVerified: true };
    if (current?.emailVerificationLockedUntil > now) return { verificationEmailSent: false, verificationMessage: 'Too many incorrect codes. Wait 15 minutes before requesting a new OTP.', retryAfter: Math.max(1, Math.ceil((+current.emailVerificationLockedUntil - +now)/1000)) };
    return { verificationEmailSent: false, verificationMessage: 'Wait at least 60 seconds before requesting another OTP.', retryAfter: 60 };
  }
  try {
    await sendVerificationEmail(user.email, code);
    return { verificationEmailSent: true, verificationMessage: 'OTP email accepted by the mail server. Enter the 6-digit code from your inbox or spam folder.', retryAfter: 60 };
  } catch(err) {
    await User.updateOne({ _id: user.id, emailVerificationChallenge: challenge }, { $unset: { emailVerificationCodeHash: '', emailVerificationChallenge: '', emailVerificationExpiresAt: '', emailVerificationSentAt: '' } });
    return { verificationEmailSent: false, verificationMessage: err.message };
  }
}
export async function resendVerification(req, res) {
  const result = await deliverVerification(req.user);
  if (result.verificationEmailSent) await recordEvent(req, 'verification_email_requested');
  res.status(result.verificationEmailSent || result.alreadyVerified ? 200 : result.retryAfter ? 429 : 503).json({ ...result, message: result.verificationMessage || 'Your email is already verified.' });
}
export async function verifyEmail(req, res) {
  const { code } = req.body;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw httpError('Enter the 6-digit OTP from your latest FinSight email.');
  if (req.user.emailVerified) throw httpError('Your email is already verified.');
  const now = new Date();
  const attempt = await User.findOneAndUpdate({ _id: req.user.id, emailVerified: { $ne: true }, emailVerificationCodeHash: { $exists: true }, emailVerificationChallenge: { $exists: true }, emailVerificationExpiresAt: { $gt: now }, emailVerificationAttempts: { $lt: 5 }, ...unlocked(now) }, { $inc: { emailVerificationAttempts: 1 } }, { new: true }).select('+emailVerificationCodeHash +emailVerificationChallenge +emailVerificationAttempts');
  if (!attempt) {
    const current = await User.findById(req.user.id).select('+emailVerificationLockedUntil');
    if (current?.emailVerificationLockedUntil > now) return lockResponse(res, current.emailVerificationLockedUntil);
    throw httpError('This OTP expired, was already used, or is unavailable. Request a new OTP.');
  }
  const digest = hashEmailCode(attempt.id, attempt.emailVerificationChallenge, code);
  if (!timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(attempt.emailVerificationCodeHash, 'hex'))) {
    if (attempt.emailVerificationAttempts >= 5) {
      const until = new Date(Date.now() + 15*60000);
      await User.updateOne({ _id: attempt.id, emailVerified: { $ne: true }, emailVerificationChallenge: attempt.emailVerificationChallenge }, { $set: { emailVerificationLockedUntil: until } });
      return lockResponse(res, until);
    }
    throw httpError(`Incorrect OTP. ${5-attempt.emailVerificationAttempts} attempts remaining.`);
  }
  const user = await User.findOneAndUpdate({ _id: attempt.id, emailVerified: { $ne: true }, emailVerificationChallenge: attempt.emailVerificationChallenge, emailVerificationCodeHash: digest, emailVerificationExpiresAt: { $gt: new Date() }, ...unlocked(new Date()) }, { $set: { emailVerified: true, emailVerifiedAt: new Date(), emailVerificationAttempts: 0 }, $unset: { emailVerificationCodeHash: '', emailVerificationChallenge: '', emailVerificationTokenHash: '', emailVerificationExpiresAt: '', emailVerificationLockedUntil: '' } }, { new: true });
  if (!user) throw httpError('The OTP changed or was already used. Refresh your account status or request a new OTP.');
  await recordEvent(req, 'email_verified', user.id);
  // The existing authenticated session remains; verification never creates a new session or bypasses 2FA.
  res.json({ user: publicUser(user), message: 'Email verified successfully.' });
}
export function verifiedEmail(req, res, next) {
  if (!req.user.emailVerified) return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email address before accessing your financial workspace.' });
  next();
}
