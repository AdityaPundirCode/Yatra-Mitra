import mongoose from 'mongoose';

const searchHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    query: { type: String, required: true, trim: true },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
searchHistorySchema.index({ userId: 1, createdAt: -1 });
export const SearchHistory = mongoose.model('SearchHistory', searchHistorySchema);
