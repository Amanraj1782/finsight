import mongoose from 'mongoose';
export default async function connectDB() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in server/.env');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
}
