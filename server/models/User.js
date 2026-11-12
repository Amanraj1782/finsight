import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  emailVerified: { type: Boolean, default: false },
  emailVerifiedAt: Date,
  // Legacy link hashes are only removed on resend; the OTP endpoint never accepts them.
  emailVerificationTokenHash: { type: String, select: false, index: { unique: true, sparse: true } },
  emailVerificationCodeHash: { type: String, select: false },
  emailVerificationChallenge: { type: String, select: false },
  emailVerificationAttempts: { type: Number, default: 0, select: false },
  emailVerificationLockedUntil: { type: Date, select: false },
  emailVerificationExpiresAt: { type: Date, select: false },
  emailVerificationSentAt: { type: Date, select: false },
  securityVersion: { type: Number, default: 0 },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, select: false },
  pendingSecret: { type: String, select: false },
  pendingExpires: { type: Date, select: false },
  recoveryHashes: { type: [String], select: false, default: [] },
  lastTotpStep: { type: Number, default: -1, select: false },
}, { timestamps: true });
export default mongoose.model('User', schema);
