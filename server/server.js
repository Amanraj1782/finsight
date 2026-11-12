import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import connectDB from './config/db.js';
import api from './routes/api.js';
import { sameOrigin } from './middleware/auth.js';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('replace-')) throw new Error('Set a random JWT_SECRET of at least 32 characters in server/.env');
if (!process.env.CLIENT_ORIGIN) throw new Error('Set CLIENT_ORIGIN in server/.env');
if (process.env.MFA_ENCRYPTION_KEY && process.env.MFA_ENCRYPTION_KEY.length < 32) throw new Error('MFA_ENCRYPTION_KEY must have at least 32 characters.');
const app = express();
app.disable('x-powered-by');
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 2) throw new Error('TRUST_PROXY_HOPS must be 0, 1 or 2.');
if (proxyHops) app.set('trust proxy', proxyHops);
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'no-store'); next(); });
app.use(express.json({ limit: '64kb' }), cookieParser(), sameOrigin);
app.get('/api/health', (req, res) => res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: mongoose.connection.readyState === 1 ? 'ok' : 'unavailable' }));
app.use('/api', api);
if (process.env.NODE_ENV === 'production') {
  const clientDist = fileURLToPath(new URL('../client/dist/', import.meta.url));
  app.use(express.static(clientDist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || path.extname(req.path) || !req.accepts('html')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}
app.use((req, res) => res.status(404).json({ message: 'Endpoint not found.' }));
app.use((err, req, res, next) => {
  const status = err.code === 11000 ? 409 : err.code === 'LIMIT_FILE_SIZE' ? 413 : err.name === 'MulterError' || err.name === 'ValidationError' || err.name === 'CastError' || err instanceof SyntaxError ? 400 : err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ message: err.code === 11000 ? 'This record already exists.' : status === 413 ? 'CSV files must be 2 MB or smaller.' : status === 500 ? 'An unexpected server error occurred.' : err.message });
});
await connectDB();
app.listen(process.env.PORT || 5000, () => console.log('FinSight API listening on port ' + (process.env.PORT || 5000)));
