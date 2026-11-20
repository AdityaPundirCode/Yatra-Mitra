import mongoose from 'mongoose';

const packingListSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', default: null },
    destination: { type: String, default: '' },
    items: [{ name: String, packed: { type: Boolean, default: false }, category: { type: String, default: 'general' } }],
  },
  { timestamps: true }
);
export const PackingList = mongoose.model('PackingList', packingListSchema);
