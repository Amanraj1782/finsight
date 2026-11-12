import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, maxlength: 120 },
  amount: { type: Number, required: true, min: 1, max: 100000000000, validate: Number.isSafeInteger },
  type: { type: String, enum: ['income', 'expense'], required: true },
  category: { type: String, required: true, maxlength: 60 },
  date: { type: Date, required: true },
  description: { type: String, maxlength: 1000, default: '' },
  importKey: { type: String },
}, { timestamps: true });
schema.index({ userId: 1, date: -1 });
schema.index({ userId: 1, importKey: 1 }, { unique: true, partialFilterExpression: { importKey: { $type: 'string' } } });
export default mongoose.model('Transaction', schema);
