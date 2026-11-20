import mongoose from 'mongoose';

const attractionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'attraction' },
    rating: { type: Number, default: 0 },
  },
  { _id: false }
);

const destinationCacheSchema = new mongoose.Schema(
  {
    placeId: { type: String, default: '', index: true },
    slug: { type: String, index: true },
    name: { type: String, required: true, index: true },
    country: { type: String, default: '', index: true },
    city: { type: String, default: '', index: true },
    region: { type: String, default: '' },
    category: { type: String, default: '', index: true },
    tags: [{ type: String }],
    description: { type: String, default: '' },
    location: { type: mongoose.Schema.Types.Mixed, default: {} },
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    popularity: { type: Number, default: 0 },
    trendingScore: { type: Number, default: 0 },
    budgetTier: { type: String, default: '' },
    dailyBudget: { type: Number, default: 0 },
    bestTimeToVisit: { type: String, default: '' },
    idealDurationDays: { type: Number, default: 0 },
    attractions: { type: [attractionSchema], default: [] },
    images: [{ type: String }],
    viewCount: { type: Number, default: 0 },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, default: 'external' },
  },
  { timestamps: true }
);
export const Destination = mongoose.model('Destination', destinationCacheSchema);
