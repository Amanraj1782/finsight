import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Session from '../models/Session.js';
import mongoose from 'mongoose';
import { httpError } from '../controllers/finance.js';
export async function auth(req, res, next) {
  let payload;
  try {
    payload = jwt.verify(req.cookies.token || '', process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.purpose !== 'login' || !mongoose.isValidObjectId(payload.sid) || !mongoose.isValidObjectId(payload.id)) throw new Error();
  } catch { return next(httpError('Please sign in to continue.', 401)); }
  try {
    req.session = await Session.findOne({ _id: payload.sid, userId: payload.id, kind: 'login', expiresAt: { $gt: new Date() } });
    req.user = await User.findById(payload.id);
    if (!req.session || !req.user || req.session.securityVersion !== (req.user.securityVersion || 0)) return next(httpError('Your session has ended. Please sign in again.', 401));
    if (Date.now() - req.session.lastSeenAt.getTime() > 60000) await Session.updateOne({ _id: req.session.id }, { $set: { lastSeenAt: new Date() } });
    next();
  } catch (err) { next(err); }
}
export function sameOrigin(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== process.env.CLIENT_ORIGIN) return next(httpError('Request origin is not allowed.', 403));
  next();
}
