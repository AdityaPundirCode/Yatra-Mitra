import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    destinationKey: { type: String, required: true, index: true }, // placeId or normalized name
    destinationName: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
    photos: [{ type: String }],
    source: { type: String, enum: ['user', 'google'], default: 'user' },
  },
  { timestamps: true }
);
reviewSchema.index({ userId: 1, destinationKey: 1 }, { unique: true, partialFilterExpression: { source: 'user' } });
export const Review = mongoose.model('Review', reviewSchema);
