import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import connectDB from './config/db.js';
import User from './models/User.js';
import Transaction from './models/Transaction.js';
import { importKey } from './controllers/finance.js';
if (process.env.NODE_ENV === 'production') throw new Error('Seed is for development only.');
await connectDB();
const email = 'demo@finsight.local';
let user = await User.findOne({ email });
if (!user) user = await User.create({ name: 'Alex Morgan', email, password: await bcrypt.hash('FinSight123!', 12), emailVerified: true });
// Development-only synthetic account; .local mailboxes cannot receive a real verification email.
if (!user.emailVerified) await User.updateOne({ _id: user.id }, { $set: { emailVerified: true } });
const now = new Date();
const samples = [ ['Monthly salary', 8500000, 'income', 'Salary', 2], ['Freelance design', 2450000, 'income', 'Freelance', 9], ['Apartment rent', 2200000, 'expense', 'Housing', 4], ['Weekly groceries', 465000, 'expense', 'Food', 12], ['Software subscriptions', 249900, 'expense', 'Software', 14], ['Coffee & lunch', 128000, 'expense', 'Food', 18], ['Internet & electricity', 380000, 'expense', 'Utilities', 21], ['Metro & transport', 180000, 'expense', 'Transport', 24] ];
let count = 0;
for (let ago = 5; ago >= 0; ago--) for (const [title, base, type, category, day] of samples) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - ago, day)).toISOString().slice(0,10);
  if (date > now.toISOString().slice(0,10)) continue;
  const row = { title, amount: Math.round(base * (1 - ago * 0.035)), type, category, date, description: 'Development sample transaction' };
  const result = await Transaction.updateOne({ userId: user.id, importKey: importKey(row) }, { $setOnInsert: { ...row, userId: user.id, importKey: importKey(row) } }, { upsert: true });
  count += result.upsertedCount;
}
console.log(`Added ${count} sample transactions. Demo login: ${email} / FinSight123!`);
await mongoose.disconnect();
