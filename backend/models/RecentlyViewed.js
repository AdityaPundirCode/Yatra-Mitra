import mongoose from 'mongoose';

const recentlyViewedSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    slug: { type: String, required: true },
    destinationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Destination' },
    destinationName: { type: String, required: true },
    city: { type: String, default: '' },
    country: { type: String, default: '' },
    category: { type: String, default: '' },
    image: { type: String, default: '' },
    rating: { type: Number, default: 0 },
    budgetTier: { type: String, default: '' },
    dailyBudget: { type: Number, default: 0 },
    viewedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

recentlyViewedSchema.index({ userId: 1, slug: 1 }, { unique: true });
recentlyViewedSchema.index({ userId: 1, viewedAt: -1 });

export const RecentlyViewed = mongoose.model('RecentlyViewed', recentlyViewedSchema);
