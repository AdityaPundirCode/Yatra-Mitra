// ------------------------------------------------------------
// services/recentlyViewedService.js
// Remembers the last destinations a user opened (max 15).
// ------------------------------------------------------------
import mongoose from 'mongoose';
import { Destination } from '../models/Destination.js';
import { RecentlyViewed } from '../models/RecentlyViewed.js';
import { getDestinationByIdentifier } from './destinationService.js';
import { categoryLabel, budgetLabel } from '../utils/destinationHelpers.js';

// Shape one saved item for the frontend.
function formatItem(item) {
  return {
    id: String(item._id),
    slug: item.slug,
    destinationName: item.destinationName,
    city: item.city,
    country: item.country,
    category: item.category,
    image: item.image,
    rating: item.rating,
    budgetTier: item.budgetTier,
    dailyBudget: item.dailyBudget,
    viewedAt: item.viewedAt,
  };
}

// Save that the user opened a destination.
export async function recordRecentlyViewed(userId, identifier) {
  const destination = await getDestinationByIdentifier(identifier);
  if (!destination) return null;

  const item = await RecentlyViewed.findOneAndUpdate(
    { userId, slug: destination.slug },
    {
      $set: {
        userId,
        slug: destination.slug,
        destinationId: mongoose.isValidObjectId(destination.id) ? destination.id : undefined,
        destinationName: destination.name,
        city: destination.city,
        country: destination.country,
        category: destination.category,
        image: destination.image,
        rating: destination.rating,
        budgetTier: destination.budgetTier,
        dailyBudget: destination.dailyBudget,
        viewedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  // Add 1 to the destination's view counter (we don't wait for it to finish).
  Destination.updateOne({ slug: destination.slug }, { $inc: { viewCount: 1 } }).catch(() => {});

  // Keep only the 15 newest items: delete the older ones.
  const oldItems = await RecentlyViewed.find({ userId }).sort({ viewedAt: -1 }).skip(15).select('_id').lean();
  if (oldItems.length) {
    await RecentlyViewed.deleteMany({ _id: { $in: oldItems.map((entry) => entry._id) } });
  }

  return formatItem(item);
}

// List the user's recently viewed destinations.
export async function listRecentlyViewed(userId, limit = 12) {
  const maxItems = Math.min(24, Math.max(1, Number(limit) || 12));
  const items = await RecentlyViewed.find({ userId }).sort({ viewedAt: -1 }).limit(maxItems).lean();

  return items.map((item) => ({
    ...formatItem(item),
    categoryLabel: categoryLabel(item.category),
    budgetLabel: budgetLabel(item.budgetTier),
  }));
}

// Remove one item. Returns true if something was deleted.
export async function removeRecentlyViewed(userId, id) {
  if (!mongoose.isValidObjectId(id)) return false;
  const result = await RecentlyViewed.deleteOne({ _id: id, userId });
  return result.deletedCount > 0;
}

// Remove everything.
export async function clearRecentlyViewed(userId) {
  await RecentlyViewed.deleteMany({ userId });
}
