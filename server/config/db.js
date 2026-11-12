import mongoose from 'mongoose';
let connecting;
export default async function connectDB() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in server/.env');
  if (mongoose.connection.readyState === 1) return;
  if (!connecting) connecting = mongoose.connect(process.env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 }).then(() => { console.log('MongoDB connected'); }).finally(() => { connecting = undefined; });
  await connecting;
}
