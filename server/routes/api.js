import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'node:stream';
import Transaction from '../models/Transaction.js';
import { auth } from '../middleware/auth.js';
import { register, login, logout } from '../controllers/auth.js';
import { verifyLogin, securityStatus, setupTwoFactor, enableTwoFactor, disableTwoFactor, listSessions, revokeSession, revokeOthers, listActivity, recordEvent } from '../controllers/security.js';
import { filters, validateTransaction, overview, monthly, categories, insights, importKey, csvReport, httpError } from '../controllers/finance.js';
import { aiStatus, aiContext, askAssistant } from '../controllers/assistant.js';
import { verifyEmail, resendVerification, verifiedEmail } from '../controllers/emailVerification.js';
import { publicUser } from '../controllers/security.js';
const router = express.Router();
// shortcut: in-memory login limits are for one server; use a shared limiter when scaling.
const attempts = new Map();
setInterval(() => { const now = Date.now(); for (const [key, value] of attempts) if (value.reset < now) attempts.delete(key); }, 60000).unref();
function limit(req, res, next) {
  const key = req.ip, now = Date.now();
  let state = attempts.get(key);
  if (!state || state.reset < now) { state = { count: 0, reset: now + 15 * 60000 }; attempts.set(key, state); }
  if (++state.count > 30) return next(httpError('Too many sign-in attempts. Try again in 15 minutes.', 429));
  next();
}
router.post('/auth/register', limit, register);
router.post('/auth/login', limit, login);
router.post('/auth/verify-2fa', limit, verifyLogin);
router.post('/auth/logout', logout);
router.use(auth);
router.post('/auth/verify-email', limit, verifyEmail);
router.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));
router.post('/auth/resend-verification', limit, resendVerification);
router.use(verifiedEmail);
router.get('/assistant/status', aiStatus);
router.get('/assistant/context', aiContext);
router.post('/assistant/ask', askAssistant);
router.get('/security/two-factor', securityStatus);
router.post('/security/two-factor/setup', limit, setupTwoFactor);
router.post('/security/two-factor/enable', limit, enableTwoFactor);
router.post('/security/two-factor/disable', limit, disableTwoFactor);
router.get('/security/sessions', listSessions);
router.delete('/security/sessions/others', revokeOthers);
router.delete('/security/sessions/:sessionId', revokeSession);
router.get('/security/activity', listActivity);
const rows = req => Transaction.find(filters(req.query, req.user.id)).sort({ date: -1, createdAt: -1 }).lean();
router.get('/transactions', async (req, res) => res.json(await rows(req)));
router.post('/transactions', async (req, res) => res.status(201).json(await Transaction.create({ ...validateTransaction(req.body), userId: req.user.id })));
router.param('id', (req, res, next, id) => mongoose.isValidObjectId(id) ? next() : next(httpError('Invalid transaction ID.')));
router.put('/transactions/:id', async (req, res) => {
  const row = await Transaction.findOneAndUpdate({ _id: req.params.id, userId: req.user.id }, { $set: validateTransaction(req.body), $unset: { importKey: '' } }, { new: true, runValidators: true });
  if (!row) throw httpError('Transaction not found.', 404);
  res.json(row);
});
router.delete('/transactions/:id', async (req, res) => {
  const row = await Transaction.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!row) throw httpError('Transaction not found.', 404);
  await recordEvent(req, 'transaction_deleted');
  res.json({ message: 'Transaction deleted' });
});
router.get('/analytics/overview', async (req, res) => res.json(overview(await rows(req))));
router.get('/analytics/monthly', async (req, res) => res.json(monthly(await rows(req))));
router.get('/analytics/categories', async (req, res) => res.json(categories(await rows(req))));
router.get('/insights', async (req, res) => res.json(insights(await rows(req))));
router.get('/reports/export', async (req, res) => res.type('text/csv').attachment('finsight-report.csv').send(csvReport(await rows(req))));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 }, fileFilter(req, file, cb) { cb(file.originalname.toLowerCase().endsWith('.csv') ? null : httpError('Only CSV files are supported.'), file.originalname.toLowerCase().endsWith('.csv')); } });
router.post('/upload/csv', upload.single('file'), async (req, res) => {
  if (!req.file) throw httpError('Choose a CSV file.');
  const parsed = [], errors = []; let headers = [];
  await new Promise((resolve, reject) => Readable.from(req.file.buffer).pipe(csv({ strict: true, mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim() })).on('headers', h => { headers = h; }).on('data', row => parsed.push(row)).on('error', () => reject(httpError('Malformed CSV. Check the column count and quoting on each row.'))).on('end', resolve));
  if (!['title','amount','type','category','date','description'].every(h => headers.includes(h))) throw httpError('CSV must include title, amount, type, category, date, description.');
  if (!parsed.length || parsed.length > 5000) throw httpError('Upload between 1 and 5,000 rows.');
  const valid = [];
  parsed.forEach((row, i) => { try { valid.push({ ...validateTransaction(row, true), rowNumber: i + 2 }); } catch (err) { errors.push({ row: i + 2, message: err.message }); } });
  const existing = new Set((await Transaction.find({ userId: req.user.id }).lean()).map(importKey));
  const unique = []; let duplicates = 0;
  for (const row of valid) { const key = importKey(row); if (existing.has(key)) { duplicates++; continue; } existing.add(key); const { rowNumber, ...data } = row; unique.push({ ...data, userId: req.user.id, importKey: key }); }
  if (req.body.confirm !== 'true') return res.json({ preview: unique.slice(0, 20), validCount: unique.length, duplicates, errors, total: parsed.length });
  // Validate the original file again at confirmation; never trust preview data sent by a client.
  let imported = 0;
  if (unique.length) {
    const result = await Transaction.bulkWrite(unique.map(row => ({ updateOne: { filter: { userId: req.user.id, importKey: row.importKey }, update: { $setOnInsert: row }, upsert: true } })));
    imported = result.upsertedCount;
  }
  res.json({ imported, duplicates: duplicates + unique.length - imported, errors });
});
export default router;
