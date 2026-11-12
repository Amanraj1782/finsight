import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Session from '../models/Session.js';
import SecurityEvent from '../models/SecurityEvent.js';
import { httpError } from './finance.js';
import { newSecret, encryptSecret, decryptSecret, matchingStep, newRecoveryCodes, recoveryHash } from './totp.js';
export const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
export const publicUser = user => ({ id: user.id, name: user.name, email: user.email, emailVerified: !!user.emailVerified });
const version = user => user.securityVersion || 0;
export const versionFilter = user => version(user) === 0 ? { $or: [{ securityVersion: 0 }, { securityVersion: { $exists: false } }] } : { securityVersion: version(user) };
export function clientInfo(req) { return { ip: String(req.ip || '').slice(0,80), userAgent: String(req.get('user-agent') || 'Unknown browser').slice(0,300) }; }
export async function recordEvent(req, action, userId = req.user?.id) { if (userId) await SecurityEvent.create({ userId, action, ...clientInfo(req) }); }
export async function startSession(req, res, user, action = 'login_success', extra = {}) {
  const session = await Session.create({ userId: user.id, kind: 'login', securityVersion: version(user), ...clientInfo(req), expiresAt: new Date(Date.now() + 7 * 86400000) });
  await recordEvent(req, action, user.id);
  res.clearCookie('mfa', cookieOptions());
  res.cookie('token', jwt.sign({ id: user.id, sid: session.id, purpose: 'login' }, process.env.JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' }), { ...cookieOptions(), maxAge: 7 * 86400000 });
  res.json({ user: publicUser(user), ...extra });
}
export async function startChallenge(req, res, user) {
  const challenge = await Session.create({ userId: user.id, kind: 'challenge', securityVersion: version(user), ...clientInfo(req), expiresAt: new Date(Date.now() + 5 * 60000) });
  await recordEvent(req, 'login_password_verified', user.id);
  res.cookie('mfa', jwt.sign({ id: user.id, sid: challenge.id, purpose: 'mfa' }, process.env.JWT_SECRET, { expiresIn: '5m', algorithm: 'HS256' }), { ...cookieOptions(), maxAge: 5 * 60000 });
  res.json({ requiresTwoFactor: true });
}
export async function consumeFactor(user, code, allowRecovery = true) {
  if (typeof code !== 'string' || code.length > 64) return false;
  if (/^\d{6}$/.test(code)) {
    const step = matchingStep(decryptSecret(user.twoFactorSecret), code, user.lastTotpStep ?? -1);
    if (step === null) return false;
    return !!await User.findOneAndUpdate({ _id: user.id, twoFactorEnabled: true, ...versionFilter(user), $and: [{ $or: [{ lastTotpStep: { $lt: step } }, { lastTotpStep: { $exists: false } }] }] }, { $set: { lastTotpStep: step } });
  }
  if (!allowRecovery || !/^[A-Fa-f0-9-]{20,24}$/.test(code)) return false;
  const hash = recoveryHash(code);
  return !!await User.findOneAndUpdate({ _id: user.id, twoFactorEnabled: true, ...versionFilter(user), recoveryHashes: hash }, { $pull: { recoveryHashes: hash } });
}
export async function verifyLogin(req, res) {
  let payload;
  try { payload = jwt.verify(req.cookies.mfa || '', process.env.JWT_SECRET, { algorithms: ['HS256'] }); } catch { throw httpError('Verification expired. Sign in again.', 401); }
  if (payload.purpose !== 'mfa' || !mongoose.isValidObjectId(payload.sid)) throw httpError('Sign in again.', 401);
  const challenge = await Session.findOneAndUpdate({ _id: payload.sid, userId: payload.id, kind: 'challenge', expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } }, { $inc: { attempts: 1 } }, { new: true });
  if (!challenge) throw httpError('Verification expired or too many attempts. Sign in again.', 401);
  const user = await User.findById(payload.id).select('+twoFactorSecret +lastTotpStep');
  if (!user?.twoFactorEnabled || version(user) !== challenge.securityVersion) throw httpError('Sign in again.', 401);
  if (!await consumeFactor(user, req.body.code)) { await recordEvent(req, 'two_factor_failed', user.id); throw httpError('Invalid or already used code. Try a new authenticator code or an unused recovery code.', 400); }
  if (!await Session.findOneAndDelete({ _id: challenge.id, kind: 'challenge' })) throw httpError('This verification was already completed. Sign in again.', 401);
  await startSession(req, res, user);
}
async function passwordUser(req) {
  const user = await User.findById(req.user.id).select('+password +twoFactorSecret +pendingSecret +pendingExpires +lastTotpStep');
  const password = req.body.password;
  if (!user || typeof password !== 'string' || Buffer.byteLength(password) > 72 || !await bcrypt.compare(password, user.password)) { await recordEvent(req, 'security_verification_failed'); throw httpError('Current password is incorrect.', 400); }
  return user;
}
export async function securityStatus(req, res) {
  const user = await User.findById(req.user.id).select('+recoveryHashes');
  res.json({ enabled: user.twoFactorEnabled, recoveryCodesRemaining: user.recoveryHashes.length });
}
export async function setupTwoFactor(req, res) {
  const user = await passwordUser(req);
  if (user.twoFactorEnabled) throw httpError('Two-factor authentication is already enabled.');
  const secret = newSecret();
  const saved = await User.findOneAndUpdate({ _id: user.id, twoFactorEnabled: { $ne: true }, ...versionFilter(user) }, { $set: { pendingSecret: encryptSecret(secret), pendingExpires: new Date(Date.now() + 10 * 60000) } });
  if (!saved) throw httpError('Security settings changed. Reload this page.', 409);
  await recordEvent(req, 'two_factor_setup_started');
  res.json({ secret, expiresInMinutes: 10 });
}
async function keepCurrentSession(req, updatedUser) {
  await Session.updateOne({ _id: req.session.id }, { $set: { securityVersion: version(updatedUser) } });
  await Session.deleteMany({ userId: req.user.id, _id: { $ne: req.session._id }, securityVersion: { $ne: version(updatedUser) } });
}
export async function enableTwoFactor(req, res) {
  const user = await passwordUser(req);
  if (user.twoFactorEnabled || !user.pendingSecret || user.pendingExpires <= new Date()) throw httpError('Setup expired or already completed. Start setup again.');
  const step = matchingStep(decryptSecret(user.pendingSecret), req.body.code);
  if (step === null) { await recordEvent(req, 'two_factor_setup_failed'); throw httpError('Invalid code. Check your authenticator and try again.'); }
  const codes = newRecoveryCodes();
  const updated = await User.findOneAndUpdate({ _id: user.id, twoFactorEnabled: { $ne: true }, pendingSecret: user.pendingSecret, pendingExpires: { $gt: new Date() }, ...versionFilter(user) }, { $set: { twoFactorEnabled: true, twoFactorSecret: user.pendingSecret, recoveryHashes: codes.map(recoveryHash), lastTotpStep: step }, $unset: { pendingSecret: '', pendingExpires: '' }, $inc: { securityVersion: 1 } }, { new: true });
  if (!updated) throw httpError('Setup changed. Start again.', 409);
  await keepCurrentSession(req, updated);
  await recordEvent(req, 'two_factor_enabled');
  res.json({ recoveryCodes: codes, message: 'Two-factor authentication enabled. Other sessions were signed out.' });
}
export async function disableTwoFactor(req, res) {
  const user = await passwordUser(req);
  if (!user.twoFactorEnabled || !await consumeFactor(user, req.body.code)) { await recordEvent(req, 'security_verification_failed'); throw httpError('Enter a new authenticator code or an unused recovery code.'); }
  const updated = await User.findOneAndUpdate({ _id: user.id, twoFactorEnabled: true, ...versionFilter(user) }, { $set: { twoFactorEnabled: false, recoveryHashes: [], lastTotpStep: -1 }, $unset: { twoFactorSecret: '', pendingSecret: '', pendingExpires: '' }, $inc: { securityVersion: 1 } }, { new: true });
  if (!updated) throw httpError('Security settings changed. Reload this page.', 409);
  await keepCurrentSession(req, updated); await recordEvent(req, 'two_factor_disabled');
  res.json({ message: 'Two-factor authentication disabled. Other sessions were signed out.' });
}
export async function listSessions(req, res) {
  const sessions = await Session.find({ userId: req.user.id, kind: 'login', securityVersion: version(req.user), expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).select('ip userAgent createdAt lastSeenAt expiresAt').lean();
  res.json(sessions.map(s => ({ ...s, current: String(s._id) === req.session.id })));
}
export async function revokeSession(req, res) {
  if (!mongoose.isValidObjectId(req.params.sessionId)) throw httpError('Invalid session.');
  if (req.params.sessionId === req.session.id) throw httpError('Use Log out to end your current session.');
  const session = await Session.findOneAndDelete({ _id: req.params.sessionId, userId: req.user.id, kind: 'login' });
  if (!session) throw httpError('Session not found.', 404);
  await recordEvent(req, 'session_revoked'); res.json({ message: 'Session signed out.' });
}
export async function revokeOthers(req, res) {
  // Increment the account version so in-flight challenges and old sessions are invalid too.
  const user = await User.findOneAndUpdate({ _id: req.user.id, ...versionFilter(req.user) }, { $inc: { securityVersion: 1 } }, { new: true });
  if (!user) throw httpError('Security settings changed. Reload this page.', 409);
  await keepCurrentSession(req, user); await recordEvent(req, 'other_sessions_revoked');
  res.json({ message: 'All other sessions signed out.' });
}
export async function listActivity(req, res) {
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  if (!Number.isInteger(page)) throw httpError('Invalid page.');
  const events = await SecurityEvent.find({ userId: req.user.id }).sort({ createdAt: -1, _id: -1 }).skip((page-1)*20).limit(21).select('-userId -__v').lean();
  res.json({ events: events.slice(0,20), hasMore: events.length > 20 });
}
