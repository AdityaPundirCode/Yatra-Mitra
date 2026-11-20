// ------------------------------------------------------------
// services/destinationService.js
// All the logic for finding destinations in the database:
// search, autocomplete, categories, filters, popular, trending.
// ------------------------------------------------------------
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Destination } from '../models/Destination.js';
import { seedDestinations } from '../data/destinations.js';
import { photonSearch } from './placesApi.js';
import {
  CATEGORY_LABELS, BUDGET_OPTIONS, SORT_OPTIONS,
  inferBudgetTier, slugify, normalise, includesText, escapeRegex,
  mapDestination, addExtraDetails,
} from '../utils/destinationHelpers.js';

// A number between min and max (used for "limit" values from the URL).
function clamp(value, fallback, min, max) {
  return Math.min(max, Math.max(min, Number(value) || fallback));
}

// ============================================================
// 1. SEEDING - put our built-in destinations into the database (once)
// ============================================================
let alreadySeeded = false;
const COUNTRY_ALIASES = new Map([
  ['us', 'United States'],
  ['usa', 'United States'],
  ['uk', 'United Kingdom'],
  ['uae', 'United Arab Emirates'],
]);

export async function ensureSeeded() {
  if (alreadySeeded) return;

  const count = await Destination.countDocuments({ source: 'curated' });
  if (count < seedDestinations.length) {
    // "upsert" = update if it exists, otherwise insert
    const operations = seedDestinations.map((destination) => ({
      updateOne: {
        filter: { slug: destination.slug },
        update: {
          $set: {
            ...destination,
            budgetTier: destination.budgetTier || inferBudgetTier(destination.dailyBudget),
            source: 'curated',
          },
        },
        upsert: true,
      },
    }));
    await Destination.bulkWrite(operations);
  }
  alreadySeeded = true;
}

// ============================================================
// 2. SEARCH
// ============================================================

// Saves a place found on the internet (Photon) in our database so we can reuse it.
async function savePhotonPlace(place) {
  // Skip it if we already have the same place in our curated list.
  const exactName = new RegExp(`^${escapeRegex(place.name)}$`, 'i');
  const exactCountry = new RegExp(`^${escapeRegex(place.country)}$`, 'i');
  const duplicate = await Destination.findOne({
    source: 'curated',
    $or: [{ name: exactName, country: exactCountry }, { 'attractions.name': exactName }],
  }).lean();
  if (duplicate) return null;

  // Already saved before?
  if (place.placeId) {
    const existing = await Destination.findOne({ placeId: place.placeId });
    if (existing) return existing.toObject();
  }

  const shortId = crypto.createHash('sha1').update(String(place.placeId || `${place.lat},${place.lon}`)).digest('hex').slice(0, 8);
  const slug = `${slugify(`${place.name} ${place.city || place.country || ''}`)}-${shortId}`;

  const doc = await Destination.findOneAndUpdate(
    { slug },
    {
      $set: {
        slug,
        placeId: place.placeId || '',
        name: place.name,
        city: place.city || '',
        country: place.country || '',
        region: place.region || '',
        category: place.category || 'place',
        description: place.description || '',
        location: { lat: place.lat, lon: place.lon },
        source: 'OpenStreetMap/Photon',
        data: place.data || {},
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  return doc?.toObject ? doc.toObject() : null;
}

// Removes destinations that have the same name + city.
function removeDuplicates(docs) {
  const seen = new Set();
  const result = [];
  for (const doc of docs) {
    if (!doc) continue;
    const key = `${normalise(doc.name)}|${normalise(doc.city || doc.country)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(doc);
  }
  return result;
}

// Gives a destination points for how well it matches the search text.
function relevanceScore(item, query) {
  if (!query) return 0;
  const q = normalise(query);
  const name = normalise(item.name);
  const city = normalise(item.city);
  const country = normalise(item.country);
  let score = 0;

  if (name === q) score += 120;
  else if (name.startsWith(q)) score += 90;
  else if (name.includes(q)) score += 70;

  if (city === q) score += 60;
  else if (city.includes(q)) score += 35;

  if (country === q) score += 50;
  else if (country.includes(q)) score += 25;

  for (const attraction of item.attractions || []) {
    const attractionName = normalise(attraction.name);
    if (attractionName === q) score += 65;
    else if (attractionName.includes(q)) score += 30;
  }
  for (const tag of item.tags || []) {
    if (normalise(tag).includes(q)) score += 20;
  }
  return score + Math.min(30, Number(item.popularity) / 4 || 0);
}

// Keeps only the destinations that match the chosen filters.
function applyFilters(items, filters) {
  let result = items;

  if (filters.country) {
    result = result.filter((item) => includesText(item.country, filters.country));
  }
  if (filters.city) {
    result = result.filter((item) => includesText(item.city, filters.city) || includesText(item.region, filters.city));
  }
  if (filters.category && filters.category !== 'all') {
    const wanted = normalise(filters.category);
    result = result.filter(
      (item) => normalise(item.category) === wanted || (item.tags || []).some((tag) => normalise(tag) === wanted)
    );
  }

  // budget can be several tiers separated by commas: "budget,mid"
  const tiers = String(filters.budget || '').split(',').map(normalise).filter((t) => t && t !== 'all');
  if (tiers.length) {
    result = result.filter((item) => tiers.includes(normalise(item.budgetTier)));
  }

  const maxBudget = Number(filters.maxBudget);
  if (Number.isFinite(maxBudget) && maxBudget > 0) result = result.filter((item) => Number(item.dailyBudget) <= maxBudget);

  const minBudget = Number(filters.minBudget);
  if (Number.isFinite(minBudget) && minBudget > 0) result = result.filter((item) => Number(item.dailyBudget) >= minBudget);

  const minRating = Number(filters.minRating);
  if (Number.isFinite(minRating) && minRating > 0) result = result.filter((item) => Number(item.rating) >= minRating);

  return result;
}

// Sorts the list. A negative number from the compare function means "a comes first".
function sortItems(items, sort, query) {
  const list = [...items];
  const byPopularity = (a, b) => b.popularity - a.popularity || b.rating - a.rating;

  if (sort === 'rating') return list.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
  if (sort === 'popularity') return list.sort(byPopularity);
  if (sort === 'trending') return list.sort((a, b) => b.trendingScore - a.trendingScore || b.popularity - a.popularity);
  if (sort === 'budget_low') return list.sort((a, b) => (a.dailyBudget || Infinity) - (b.dailyBudget || Infinity));
  if (sort === 'budget_high') return list.sort((a, b) => b.dailyBudget - a.dailyBudget);
  if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'relevance' && query) {
    return list.sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query) || byPopularity(a, b));
  }
  return list.sort(byPopularity);
}

// Database filter: the text can be in the name, city, country, tags, etc.
function makeTextFilter(query) {
  const regex = new RegExp(escapeRegex(query), 'i'); // 'i' = ignore upper/lower case
  return {
    $or: [
      { name: regex }, { city: regex }, { country: regex }, { region: regex },
      { category: regex }, { tags: regex }, { description: regex },
      { 'attractions.name': regex }, { 'attractions.description': regex },
    ],
  };
}

export async function searchDestinations(params = {}) {
  await ensureSeeded();

  const query = String(params.q || '')
    .trim()
    .replace(/^(?:(?:famous|popular|top)\s+)?(?:places|destinations|tourist attractions)\s+(?:in|of|around)\s+/i, '')
    .trim();
  const page = Math.max(1, Number(params.page) || 1);
  const limit = clamp(params.limit, 12, 1, 48);

  // Step 1: search our own database
  const alias = COUNTRY_ALIASES.get(normalise(query));
  const textFilter = query ? makeTextFilter(query) : {};
  const searchFilter = alias
    ? { $or: [...textFilter.$or, { country: new RegExp(`^${escapeRegex(alias)}$`, 'i') }] }
    : textFilter;
  let docs = await Destination.find(searchFilter).limit(400).lean();

  // Step 2: also search the internet (Photon) and save those places
  let usedExternal = false;
  let externalUnavailable = false;
  if (query.length >= 2 && params.includeExternal !== 'false') {
    try {
      const places = await photonSearch(query, 10);
      const saved = [];
      for (const place of places) {
        const doc = await savePhotonPlace(place);
        if (doc) saved.push(doc);
      }
      if (saved.length) usedExternal = true;
      docs = removeDuplicates([...docs, ...saved]);
    } catch {
      externalUnavailable = true;
    }
  }

  // Step 3: clean -> filter -> sort -> cut one page
  let items = docs.map(mapDestination);
  items = applyFilters(items, params);
  items = sortItems(items, params.sort || (query ? 'relevance' : 'popularity'), query);

  const total = items.length;
  const start = (page - 1) * limit;

  return {
    results: items.slice(start, start + limit),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    provider: usedExternal ? 'curated+OpenStreetMap' : 'curated',
    note: externalUnavailable
      ? 'Live place search is unavailable right now. Showing saved destinations; try again in a moment.'
      : usedExternal
        ? 'Showing curated highlights plus live OpenStreetMap results. Ratings and prices are shown only when available.'
        : params.includeExternal === 'false'
          ? 'Showing curated destination highlights. Turn on live OpenStreetMap results for broader coverage.'
          : query.length < 2
            ? 'Enter at least 2 characters to search live OpenStreetMap results.'
            : 'No additional live places were found. Showing matching saved destinations.',
    sortOptions: SORT_OPTIONS,
    budgetOptions: BUDGET_OPTIONS,
  };
}

// ============================================================
// 3. AUTOCOMPLETE - suggestions while the user types
// ============================================================
export async function autocompleteDestinations(query, limit = 10) {
  await ensureSeeded();

  const text = String(query || '').trim();
  if (text.length < 1) return [];

  const regex = new RegExp(escapeRegex(text), 'i');
  const docs = await Destination.find(makeTextFilter(text)).limit(12).lean();

  const suggestions = [];
  const usedLabels = new Set(); // so the same label is not shown twice

  function addSuggestion(suggestion) {
    const label = normalise(suggestion.label);
    if (usedLabels.has(label)) return;
    usedLabels.add(label);
    suggestions.push(suggestion);
  }

  for (const doc of docs) {
    const item = mapDestination(doc);

    if (regex.test(item.name) || regex.test(item.city) || regex.test(item.country)) {
      addSuggestion({
        type: 'destination',
        label: item.name,
        subtitle: [item.city, item.country].filter(Boolean).join(', '),
        value: item.name,
        slug: item.slug,
        category: item.category,
      });
    }

    for (const attraction of item.attractions) {
      if (regex.test(attraction.name)) {
        addSuggestion({
          type: 'attraction',
          label: attraction.name,
          subtitle: `Attraction in ${item.city || item.country}`,
          value: attraction.name,
          slug: item.slug,
          category: 'attraction',
        });
      }
    }

    if (item.city && regex.test(item.city)) {
      addSuggestion({ type: 'city', label: item.city, subtitle: `City in ${item.country}`, value: item.city, country: item.country, category: 'city' });
    }
    if (item.country && regex.test(item.country)) {
      addSuggestion({ type: 'country', label: item.country, subtitle: 'Country', value: item.country, category: 'country' });
    }

    if (suggestions.length >= limit) break;
  }

  return suggestions.slice(0, limit);
}

// ============================================================
// 4. CATEGORIES AND FILTER OPTIONS
// ============================================================
export async function getCategories() {
  await ensureSeeded();
  const docs = await Destination.find({ source: 'curated' }).select('category tags').lean();

  // Count how many destinations belong to each category
  const counts = {};
  for (const doc of docs) {
    const keys = new Set([doc.category, ...(doc.tags || [])].filter(Boolean)); // Set: count once per destination
    for (const key of keys) {
      if (CATEGORY_LABELS[key]) counts[key] = (counts[key] || 0) + 1;
    }
  }

  const categories = Object.keys(CATEGORY_LABELS)
    .map((key) => ({ key, label: CATEGORY_LABELS[key], count: counts[key] || 0 }))
    .filter((category) => category.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { categories };
}

export async function getFilterOptions() {
  await ensureSeeded();
  const docs = await Destination.find({ source: 'curated' })
    .select('country city category budgetTier dailyBudget')
    .lean();

  const countries = {}; // { India: 10, ... }
  const cities = {};    // { "Jaipur|India": { name, country, count } }
  const budgets = BUDGET_OPTIONS.map((option) => ({ ...option, count: 0 }));

  for (const doc of docs) {
    if (doc.country) countries[doc.country] = (countries[doc.country] || 0) + 1;

    if (doc.city) {
      const key = `${doc.city}|${doc.country || ''}`;
      if (!cities[key]) cities[key] = { name: doc.city, country: doc.country || '', count: 0 };
      cities[key].count += 1;
    }

    const tier = doc.budgetTier || inferBudgetTier(doc.dailyBudget);
    const budget = budgets.find((b) => b.key === tier);
    if (budget) budget.count += 1;
  }

  return {
    countries: Object.entries(countries)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    cities: Object.values(cities).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    budgets,
    sortOptions: SORT_OPTIONS,
    categories: (await getCategories()).categories,
  };
}

// ============================================================
// 5. POPULAR, TRENDING AND SINGLE DESTINATION
// ============================================================
export async function getPopularDestinations(limit = 8) {
  await ensureSeeded();
  const docs = await Destination.find({ source: 'curated' })
    .sort({ popularity: -1, rating: -1 })
    .limit(clamp(limit, 8, 1, 24))
    .lean();
  return docs.map(mapDestination);
}

export async function getTrendingDestinations(limit = 8) {
  await ensureSeeded();
  const docs = await Destination.find({ source: 'curated' })
    .sort({ trendingScore: -1, popularity: -1 })
    .limit(clamp(limit, 8, 1, 24))
    .lean();
  return docs.map(mapDestination);
}

// Finds one destination by its database id, slug or placeId.
export async function getDestinationByIdentifier(identifier) {
  await ensureSeeded();
  const value = String(identifier || '').trim();
  if (!value) return null;

  let doc = null;
  if (mongoose.isValidObjectId(value)) doc = await Destination.findById(value).lean();
  if (!doc) doc = await Destination.findOne({ $or: [{ slug: value }, { placeId: value }] }).lean();
  if (!doc) return null;

  return addExtraDetails(mapDestination(doc));
}
