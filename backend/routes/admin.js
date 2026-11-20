// ------------------------------------------------------------
// routes/admin.js   ->   /api/admin   (admins only)
// ------------------------------------------------------------
import express from 'express';
import { User } from '../models/User.js';
import { Trip } from '../models/Trip.js';
import { Review } from '../models/Review.js';
import { auth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(auth, requireAdmin); // must be logged in AND be an admin

// GET /api/admin/stats  -> totals
router.get('/stats', async (req, res) => {
  const [users, trips, reviews] = await Promise.all([User.countDocuments(), Trip.countDocuments(), Review.countDocuments()]);
  res.json({ users, trips, reviews });
});

// GET /api/admin/users  -> list all users
router.get('/users', async (req, res) => {
  const users = await User.find().select('name email role createdAt');
  res.json({ users });
});

// DELETE /api/admin/reviews/:id  -> remove any review
router.delete('/reviews/:id', async (req, res) => {
  await Review.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
