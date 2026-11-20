import mongoose from 'mongoose';

const travelHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    destination: { type: String, required: true, trim: true },
    country: { type: String, default: '' },
    startDate: { type: Date },
    endDate: { type: Date },
    expenses: { type: Number, default: 0 },
    transportation: { type: String, default: '' },
    hotel: { type: String, default: '' },
    notes: { type: String, default: '' },
    photos: [{ type: String }],
    rating: { type: Number, min: 0, max: 5, default: 0 },
  },
  { timestamps: true }
);
travelHistorySchema.index({ userId: 1, createdAt: -1 });
export const TravelHistory = mongoose.model('TravelHistory', travelHistorySchema);
