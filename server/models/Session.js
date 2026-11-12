import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['login', 'challenge'], required: true },
  securityVersion: { type: Number, required: true },
  ip: String,
  userAgent: String,
  attempts: { type: Number, default: 0 },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });
export default mongoose.model('Session', schema);
