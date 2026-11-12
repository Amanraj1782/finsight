import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Session from '../models/Session.js';
import mongoose from 'mongoose';
import { httpError } from './finance.js';
import { startSession, startChallenge, cookieOptions, recordEvent } from './security.js';
import { deliverVerification } from './emailVerification.js';
export async function register(req, res) {
  const { name, email, password } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) throw httpError('Enter a name, valid email and password of 8–72 bytes.');
  const user = await User.create({ name: name.trim(), email: email.toLowerCase().trim(), password: await bcrypt.hash(password, 12) });
  const delivery = await deliverVerification(user);
  await startSession(req, res, user, 'account_created', delivery);
}
export async function login(req, res) {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || Buffer.byteLength(password) > 72) throw httpError('Invalid email or password.', 401);
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
  if (!user || !await bcrypt.compare(password, user.password)) {
    if (user) await recordEvent(req, 'login_failed', user.id);
    throw httpError('Invalid email or password.', 401);
  }
  if (user.twoFactorEnabled) return startChallenge(req, res, user);
  await startSession(req, res, user);
}
export async function logout(req, res) {
  for (const name of ['token', 'mfa']) {
    let payload;
    try { payload = jwt.verify(req.cookies[name] || '', process.env.JWT_SECRET, { algorithms: ['HS256'] }); } catch { continue; }
    if (!mongoose.isValidObjectId(payload.sid) || !mongoose.isValidObjectId(payload.id) || !['login', 'mfa'].includes(payload.purpose)) continue;
    const session = await Session.findOneAndDelete({ _id: payload.sid, userId: payload.id });
    if (session?.kind === 'login') await recordEvent(req, 'logout', String(session.userId));
  }
  res.clearCookie('token', cookieOptions()); res.clearCookie('mfa', cookieOptions()); res.json({ message: 'Signed out' });
}
