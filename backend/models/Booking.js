import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reference: { type: String, required: true, unique: true, index: true },
    hotelId: { type: String, default: '' },
    hotelName: { type: String, required: true, trim: true },
    hotelType: { type: String, default: '' },
    hotelAddress: { type: String, default: '' },
    hotelLat: { type: Number },
    hotelLon: { type: Number },
    hotelRating: { type: Number, default: 0 },
    attractionName: { type: String, default: '' },
    destinationName: { type: String, default: '' },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true },
    nights: { type: Number, required: true, min: 1 },
    rooms: { type: Number, default: 1, min: 1 },
    guests: { type: Number, default: 1, min: 1 },
    pricePerNight: { type: Number, default: 0, min: 0 },
    totalPrice: { type: Number, default: 0, min: 0 },
    contactName: { type: String, default: '', trim: true },
    contactEmail: { type: String, default: '', trim: true },
    contactPhone: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
  },
  { timestamps: true }
);

bookingSchema.index({ userId: 1, createdAt: -1 });
export const Booking = mongoose.model('Booking', bookingSchema);
