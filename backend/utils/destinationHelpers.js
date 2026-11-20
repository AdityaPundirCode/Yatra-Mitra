// ------------------------------------------------------------
// utils/destinationHelpers.js
// Small lists and helper functions used by the destination code.
// ------------------------------------------------------------

export const CATEGORY_LABELS = {
  adventure: 'Adventure',
  historical: 'Historical',
  nature: 'Nature',
  religious: 'Religious',
  beach: 'Beach',
  entertainment: 'Entertainment',
  viewpoint: 'Viewpoint',
  food: 'Food & Drink',
  romantic: 'Romantic',
  wildlife: 'Wildlife',
  shopping: 'Shopping',
  city: 'City Break',
};

export const BUDGET_OPTIONS = [
  { key: 'budget', label: 'Budget', range: 'Up to Rs 3,500 / day' },
  { key: 'mid', label: 'Mid-range', range: 'Rs 3,500 - 8,000 / day' },
  { key: 'premium', label: 'Premium', range: 'Rs 8,000 - 15,000 / day' },
  { key: 'luxury', label: 'Luxury', range: 'Rs 15,000+ / day' },
];

export const SORT_OPTIONS = [
  { key: 'relevance', label: 'Best match' },
  { key: 'popularity', label: 'Most popular' },
  { key: 'rating', label: 'Top rated' },
  { key: 'trending', label: 'Trending now' },
  { key: 'budget_low', label: 'Budget: low to high' },
  { key: 'budget_high', label: 'Budget: high to low' },
  { key: 'name', label: 'Name A-Z' },
];

// "food" -> "Food & Drink"
export function categoryLabel(key) {
  if (!key) return 'Destination';
  return CATEGORY_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

// "mid" -> "Mid-range"
export function budgetLabel(key) {
  const match = BUDGET_OPTIONS.find((option) => option.key === key);
  return match ? match.label : 'Flexible';
}

// Decides the budget tier from the daily cost in rupees.
export function inferBudgetTier(cost) {
  const value = Number(cost) || 0;
  if (!value) return '';
  if (value <= 3500) return 'budget';
  if (value <= 8000) return 'mid';
  if (value <= 15000) return 'premium';
  return 'luxury';
}

// "Hawa Mahal, Jaipur" -> "hawa-mahal-jaipur"  (used in URLs)
export function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Lower-case + trimmed text, so we can compare words easily.
export function normalise(value) {
  return String(value || '').trim().toLowerCase();
}

// true if `text` contains `word` (ignoring upper/lower case)
export function includesText(text, word) {
  return normalise(text).includes(normalise(word));
}

// Makes text safe to use inside a regular expression.
export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A placeholder picture when a destination has no images.
function fallbackImage(slug) {
  return `https://picsum.photos/seed/${encodeURIComponent(slug || 'destination')}/900/600`;
}

// Turns a database document into the clean object the frontend uses.
export function mapDestination(doc) {
  const raw = doc?.toObject ? doc.toObject() : doc || {};

  const slug = raw.slug || slugify(`${raw.name || 'destination'} ${raw.city || ''} ${raw.country || ''}`);
  const images = Array.isArray(raw.images) && raw.images.filter(Boolean).length
    ? raw.images.filter(Boolean)
    : [fallbackImage(raw.slug)];
  const dailyBudget = Number(raw.dailyBudget || raw.data?.dailyBudget || 0);
  const budgetTier = raw.budgetTier || inferBudgetTier(dailyBudget);

  return {
    id: raw._id ? String(raw._id) : slug,
    placeId: raw.placeId || '',
    slug,
    name: raw.name || 'Unknown destination',
    city: raw.city || '',
    country: raw.country || '',
    region: raw.region || '',
    category: raw.category || 'destination',
    categoryLabel: categoryLabel(raw.category),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    description: raw.description || '',
    image: images[0],
    images,
    rating: raw.rating ?? 0,
    reviewCount: raw.reviewCount ?? 0,
    popularity: raw.popularity ?? 0,
    trendingScore: raw.trendingScore ?? 0,
    budgetTier,
    budgetLabel: budgetLabel(budgetTier),
    dailyBudget,
    bestTimeToVisit: raw.bestTimeToVisit || '',
    idealDurationDays: raw.idealDurationDays || 0,
    attractions: Array.isArray(raw.attractions) ? raw.attractions : [],
    viewCount: raw.viewCount || 0,
    lat: raw.location?.lat ?? raw.lat ?? null,
    lon: raw.location?.lon ?? raw.lon ?? null,
    source: raw.source || 'curated',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

// Adds extra details used on the destination page (map link and budget breakdown).
export function addExtraDetails(item) {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const perDay = Number(item.dailyBudget) || 0;
  const days = Number(item.idealDurationDays) || 0;

  return {
    ...item,
    maps: hasCoordinates
      ? {
          embed: `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.08}%2C${lat - 0.06}%2C${lon + 0.08}%2C${lat + 0.06}&layer=mapnik&marker=${lat}%2C${lon}`,
          link: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=13/${lat}/${lon}`,
        }
      : null,
    budgetBreakdown: [
      { key: 'budget', label: 'Budget', perDay: perDay ? Math.round(perDay * 0.7) : 0, note: 'Hostels, local transport, street food' },
      { key: 'mid', label: 'Mid-range', perDay, note: 'Comfortable stays, mix of local dining and tours' },
      { key: 'premium', label: 'Premium', perDay: perDay ? Math.round(perDay * 1.8) : 0, note: 'Premium stays, guided experiences, fine dining' },
    ],
    estimatedTripCost: perDay && days ? perDay * days : 0,
    sortOptions: SORT_OPTIONS,
  };
}
