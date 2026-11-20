// ------------------------------------------------------------
// server.js  -  the starting point of the backend
//
// What happens here:
//   1. Load settings from the .env file
//   2. Create the Express app and add "middleware"
//   3. Connect each URL (/api/...) to its route file
//   4. Connect to MongoDB and start listening
// ------------------------------------------------------------
import 'dotenv/config'; // reads backend/.env
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { connectDb } from './config/db.js';
import { getAiStatus } from './services/aiService.js';

import authRoutes from './routes/auth.js';
import tripRoutes from './routes/trips.js';
import wishlistRoutes from './routes/wishlist.js';
import historyRoutes from './routes/history.js';
import reviewRoutes from './routes/reviews.js';
import searchHistoryRoutes from './routes/searchHistory.js';
import notificationRoutes from './routes/notifications.js';
import packingRoutes from './routes/packing.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';
import destinationRoutes from './routes/destinations.js';
import bookingRoutes from './routes/bookings.js';
import routeCompareRoutes from './routes/routeCompare.js';
import aiRoutes from './routes/ai.js';

const app = express();
const PORT = Number(process.env.PORT || 8787);

// ---------- Middleware (runs for every request, in this order) ----------
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true })); // allow the React app to call us
app.use(express.json({ limit: '2mb' })); // read JSON sent in the request body
app.use(cookieParser()); // read cookies

// Limit each visitor to 300 requests per 15 minutes (protects against spam).
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

// ---------- Routes ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ...getAiStatus() });
});

app.use('/api/auth', authRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/search-history', searchHistoryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/packing', packingRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/destinations', destinationRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/routes', routeCompareRoutes);
app.use('/api/ai', aiRoutes);

// ---------- If no route matched: 404 ----------
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---------- Error handler ----------
// Express 5 sends any error thrown inside an async route here automatically,
// so our routes do not need their own try/catch.
app.use((err, req, res, next) => {
  // Bad client input should be a 4xx answer, not a 500 crash.
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid id or value.' });
  if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err.code === 11000) return res.status(409).json({ error: 'That item already exists.' });

  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message || 'Internal server error' });
});

// ---------- Start ----------
async function startServer() {
  try {
    await connectDb();
    app.listen(PORT, () => console.log(`Yatra Mitra backend running at http://localhost:${PORT}`));
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
