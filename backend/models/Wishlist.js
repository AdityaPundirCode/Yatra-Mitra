import mongoose from 'mongoose';

const wishlistSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    destinationName: { type: String, required: true, trim: true },
    placeId: { type: String, default: '' },
    location: { type: String, default: '' },
    image: { type: String, default: '' },
    rating: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
wishlistSchema.index({ userId: 1, destinationName: 1 });
export const Wishlist = mongoose.model('Wishlist', wishlistSchema);
