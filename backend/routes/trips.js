// ------------------------------------------------------------
// routes/trips.js   ->   /api/trips
// Save, list and delete the trips a user planned.
// ------------------------------------------------------------
import express from 'express';
import { Trip } from '../models/Trip.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();
router.use(auth); // every route in this file needs a logged-in user

// Shape a trip the way the frontend expects it.
function tripForClient(trip) {
  return { id: String(trip._id), name: trip.name, savedAt: trip.savedAt, ...(trip.data || {}) };
}

// GET /api/trips  -> the user's 10 most recent trips
router.get('/', async (req, res) => {
  const trips = await Trip.find({ userId: req.userId }).sort({ updatedAt: -1 }).limit(10);
  res.json({ trips: trips.map(tripForClient) });
});

// POST /api/trips  -> save a new trip
router.post('/', async (req, res) => {
  const { name, ...data } = req.body || {}; // "name" is separate, everything else is the trip data
  if (!name) return res.status(400).json({ error: 'Trip name is required.' });

  const trip = await Trip.create({ userId: req.userId, name, data, savedAt: data.savedAt || new Date() });
  res.status(201).json({ trip: tripForClient(trip) });
});

// DELETE /api/trips/:id  -> delete one trip
router.delete('/:id', async (req, res) => {
  const trip = await Trip.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });
  res.json({ ok: true });
});

export default router;
