import app from './app.js';
import connectDB from './config/db.js';
await connectDB();
app.listen(process.env.PORT || 5000, () => console.log('FinSight API listening on port ' + (process.env.PORT || 5000)));
