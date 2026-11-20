// ------------------------------------------------------------
// routes/dashboard.js   ->   GET /api/dashboard
// Collects everything the dashboard page needs in ONE request.
// ------------------------------------------------------------
import express from 'express';
import { Trip } from '../models/Trip.js';
import { Wishlist } from '../models/Wishlist.js';
import { TravelHistory } from '../models/TravelHistory.js';
import { SearchHistory } from '../models/SearchHistory.js';
import { Review } from '../models/Review.js';
import { Notification } from '../models/Notification.js';
import { PackingList } from '../models/PackingList.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();
router.use(auth);

// Calculates money spent per month, total money spent and number of countries visited.
function calculateAnalytics(history) {
  const spentPerMonth = {}; // example: { "2026-03": 12000 }
  const countries = new Set(); // a Set keeps each country only once
  let totalSpent = 0;

  for (const trip of history) {
    const expenses = Number(trip.expenses) || 0;
    const date = trip.startDate || trip.createdAt;

    if (date) {
      const month = new Date(date).toISOString().slice(0, 7); // "2026-03"
      spentPerMonth[month] = (spentPerMonth[month] || 0) + expenses;
    }
    totalSpent += expenses;

    if (trip.country) countries.add(String(trip.country).toLowerCase().trim());
  }

  const monthlyExpenses = Object.entries(spentPerMonth)
    .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
    .map(([month, amount]) => ({ month, amount }));

  return { monthlyExpenses, totalSpent, countriesVisited: countries.size };
}

router.get('/', async (req, res) => {
  const userId = req.userId;

  // Promise.all runs all the database queries at the same time (faster).
  const [trips, wishlist, history, searches, reviews, notifications, packing] = await Promise.all([
    Trip.find({ userId }).sort({ updatedAt: -1 }).limit(20),
    Wishlist.find({ userId }).sort({ createdAt: -1 }).limit(10),
    TravelHistory.find({ userId }).sort({ createdAt: -1 }).limit(50),
    SearchHistory.find({ userId }).sort({ createdAt: -1 }).limit(10),
    Review.find({ userId }).sort({ createdAt: -1 }).limit(10),
    Notification.find({ userId, read: false }).sort({ createdAt: -1 }).limit(10),
    PackingList.find({ userId }).sort({ updatedAt: -1 }).limit(5),
  ]);

  const [totalTrips, totalWishlist, totalHistory, totalReviews] = await Promise.all([
    Trip.countDocuments({ userId }),
    Wishlist.countDocuments({ userId }),
    TravelHistory.countDocuments({ userId }),
    Review.countDocuments({ userId }),
  ]);

  res.json({
    stats: { totalTrips, totalWishlist, totalHistory, totalReviews },
    analytics: calculateAnalytics(history),
    trips: trips.map((t) => ({ id: t._id, name: t.name, savedAt: t.savedAt, ...(t.data || {}) })),
    wishlist,
    history,
    searches,
    reviews,
    notifications,
    packing,
    user: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role },
  });
});

export default router;
