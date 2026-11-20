// ------------------------------------------------------------
// routes/bookings.js   ->   /api/bookings
// Hotel bookings (list, create, cancel).
// ------------------------------------------------------------
import crypto from 'node:crypto';
import express from 'express';
import { Booking } from '../models/Booking.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();
router.use(auth);

const ONE_DAY = 24 * 60 * 60 * 1000; // milliseconds in one day

// Makes a booking code like "YM-LX3K9A-4F2B".
function makeReference() {
  const time = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `YM-${time}-${random}`;
}

// GET /api/bookings  -> the user's latest 50 bookings
router.get('/', async (req, res) => {
  const items = await Booking.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50);
  res.json({ items });
});

// POST /api/bookings  -> create a booking
router.post('/', async (req, res) => {
  const body = req.body || {};

  // 1. Check the hotel name
  if (!body.hotelName || !String(body.hotelName).trim()) {
    return res.status(400).json({ error: 'hotelName is required.' });
  }

  // 2. Check the dates
  const checkIn = new Date(body.checkIn);
  const checkOut = new Date(body.checkOut);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    return res.status(400).json({ error: 'Valid check-in and check-out dates are required.' });
  }

  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / ONE_DAY);
  if (nights < 1) return res.status(400).json({ error: 'Check-out must be after check-in.' });

  // 3. Clean the numbers (at least 1 room / 1 guest, price never negative)
  const rooms = Math.max(1, Number(body.rooms) || 1);
  const guests = Math.max(1, Number(body.guests) || 1);
  const pricePerNight = Math.max(0, Number(body.pricePerNight) || 0);

  // 4. Save the booking
  const booking = await Booking.create({
    userId: req.userId,
    reference: makeReference(),
    hotelId: body.hotelId || '',
    hotelName: String(body.hotelName).trim(),
    hotelType: body.hotelType || '',
    hotelAddress: body.hotelAddress || '',
    hotelLat: Number.isFinite(Number(body.hotelLat)) ? Number(body.hotelLat) : undefined,
    hotelLon: Number.isFinite(Number(body.hotelLon)) ? Number(body.hotelLon) : undefined,
    hotelRating: Number(body.hotelRating) || 0,
    attractionName: body.attractionName || '',
    destinationName: body.destinationName || '',
    checkIn,
    checkOut,
    nights,
    rooms,
    guests,
    pricePerNight,
    totalPrice: pricePerNight * nights * rooms,
    contactName: body.contactName || '',
    contactEmail: body.contactEmail || '',
    contactPhone: body.contactPhone || '',
    notes: body.notes || '',
  });

  res.status(201).json({ booking });
});

// DELETE /api/bookings/:id  -> cancel (we keep the record, only change the status)
router.delete('/:id', async (req, res) => {
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' }
  );
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ booking });
});

export default router;
