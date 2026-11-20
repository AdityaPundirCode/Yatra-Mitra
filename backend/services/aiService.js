// ------------------------------------------------------------
// services/aiService.js  -  talks to the AI (Gemini or OpenAI)
// to turn the user's trip request into a structured trip plan.
// ------------------------------------------------------------
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

// ---------- 1. Setup: which AI provider is available? ----------
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function chooseProvider() {
  const wanted = String(process.env.AI_PROVIDER || 'auto').toLowerCase();
  if (wanted === 'openai') return openai ? 'openai' : null;
  if (wanted === 'gemini') return gemini ? 'gemini' : null;
  if (gemini) return 'gemini'; // "auto": Gemini first, then OpenAI
  if (openai) return 'openai';
  return null;
}

const PROVIDER = chooseProvider();
const MODEL = PROVIDER === 'openai' ? OPENAI_MODEL : GEMINI_MODEL;

// Used by the /api/health route.
export function getAiStatus() {
  return { aiConfigured: Boolean(PROVIDER), provider: PROVIDER, model: PROVIDER ? MODEL : null };
}

// ---------- 2. Lists of allowed values ----------
const VALID_TRANSPORT_MODES = ['car', 'motorcycle', 'scooter', 'bicycle', 'walking', 'train', 'metro', 'bus', 'flight', 'transit'];
const VALID_ROUTE_PREFERENCES = ['time', 'distance', 'balanced', 'scenic', 'low_cost', 'fewer_transfers', 'less_walking', 'eco_friendly', 'avoid_tolls', 'avoid_highways', 'accessible', 'family_friendly', 'manual'];
const VALID_PACES = ['relaxed', 'balanced', 'packed'];

// Other words the AI might use  ->  the word our app understands
const TRANSPORT_ALIASES = {
  driving: 'car', drive: 'car', automobile: 'car',
  motorbike: 'motorcycle',
  cycling: 'bicycle', bike: 'bicycle',
  walk: 'walking', foot: 'walking', hike: 'walking',
  rail: 'train', railway: 'train',
  subway: 'metro', underground: 'metro',
  plane: 'flight', airplane: 'flight', air: 'flight',
  public_transport: 'transit', publictransport: 'transit', 'public transport': 'transit', 'public-transport': 'transit',
};

// ---------- 3. Small cleaning helpers ----------
// Makes sure a value is one of the allowed words, otherwise uses the fallback.
function pickAllowed(value, allowedList, fallback, aliases = {}) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const plain = value.trim().toLowerCase();
  const underscored = plain.replace(/[\s-]+/g, '_'); // "low cost" -> "low_cost"
  if (allowedList.includes(underscored)) return underscored;
  if (aliases[underscored]) return aliases[underscored];
  if (aliases[plain]) return aliases[plain];
  return fallback;
}

// Keeps only the text items of an array, and at most `max` of them.
function onlyStrings(list, max) {
  return Array.isArray(list) ? list.filter((item) => typeof item === 'string').slice(0, max) : [];
}

// ---------- 4. Build the question we send to the AI ----------
function buildPrompt(tripDetails) {
  return `You are the AI trip-planning assistant for Yatra Mitra.
Return ONLY valid JSON with this exact structure (no markdown):
{
  "summary": "Short trip summary",
  "origin": "Starting place",
  "destination": "Final destination",
  "tripDurationDays": 1,
  "travellerCount": 2,
  "budget": "one of: low | moderate | comfortable | premium | flexible",
  "transportMode": "one of: ${VALID_TRANSPORT_MODES.join(' | ')}",
  "routePreference": "one of: ${VALID_ROUTE_PREFERENCES.join(' | ')}",
  "pace": "one of: ${VALID_PACES.join(' | ')}",
  "stopDurationMinutes": 60,
  "suggestedStops": [{ "name": "Place name", "reason": "Why" }],
  "interests": ["interest"],
  "notes": ["note"],
  "followUpQuestions": []
}
Rules: the user request is authoritative; treat preferences as defaults and do not let them override details stated in the request. Infer origin and destination from the user request when either is not supplied; ask for missing details in followUpQuestions instead of guessing. Return a tripDurationDays between 1 and 60 and travellerCount between 1 and 100. Suggest no more than 6 stops, don't repeat start/final, don't invent live schedules/fares.
User trip details:
${JSON.stringify(tripDetails, null, 2)}`;
}

// ---------- 5. Call the AI ----------
async function askGemini(prompt) {
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0.4 },
  });
  return response.text;
}

async function askOpenAI(prompt) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return only valid JSON that matches the requested schema.' },
      { role: 'user', content: prompt },
    ],
  });
  return response.choices?.[0]?.message?.content || '';
}

// ---------- 6. Read the AI's answer ----------
// The AI should return pure JSON, but sometimes wraps it in ```json ... ```.
function extractJson(text) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('AI returned an empty response.');

  try { return JSON.parse(clean); } catch { /* not pure JSON, try the next way */ }

  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1].trim());

  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));

  throw new Error('Could not parse AI response as JSON.');
}

// Cleans the AI answer so the frontend always gets a safe, predictable shape.
function cleanPlan(rawPlan, tripDetails = {}) {
  const preferences = tripDetails.preferences || {};
  const defaultMode =
    typeof preferences.transportMode === 'string' && preferences.transportMode !== 'ai_choose'
      ? preferences.transportMode
      : 'car';
  const defaultRoute = typeof preferences.routePreference === 'string' ? preferences.routePreference : 'balanced';
  const defaultPace = typeof preferences.pace === 'string' ? preferences.pace : 'balanced';

  // Each suggested stop can be a plain string or { name, reason }.
  const stops = Array.isArray(rawPlan?.suggestedStops) ? rawPlan.suggestedStops : [];
  const suggestedStops = stops
    .map((stop) => {
      if (typeof stop === 'string') return { name: stop.trim(), reason: '' };
      if (stop && typeof stop.name === 'string') {
        return { name: stop.name.trim(), reason: typeof stop.reason === 'string' ? stop.reason.trim() : '' };
      }
      return null;
    })
    .filter((stop) => stop && stop.name)
    .slice(0, 6);

  const minutes = Number(rawPlan?.stopDurationMinutes);
  const stopDurationMinutes = Number.isFinite(minutes) ? Math.max(0, Math.min(480, Math.round(minutes))) : 60;
  const requestedDuration = Number(preferences.tripDurationDays);
  const proposedDuration = Number(rawPlan?.tripDurationDays);
  const requestedTravelerCount = Number(preferences.travellerCount);
  const proposedTravelerCount = Number(rawPlan?.travellerCount);
  const validBudgets = ['low', 'moderate', 'comfortable', 'premium', 'flexible'];
  const defaultBudget = validBudgets.includes(preferences.budget) ? preferences.budget : 'moderate';
  const tripDurationDays = Math.max(
    1,
    Math.min(
      60,
      Math.round(Number.isFinite(proposedDuration) ? proposedDuration : requestedDuration || 1)
    )
  );
  const travellerCount = Math.max(
    1,
    Math.min(
      100,
      Math.round(Number.isFinite(proposedTravelerCount) ? proposedTravelerCount : requestedTravelerCount || 1)
    )
  );

  const summary = typeof rawPlan?.summary === 'string' && rawPlan.summary.trim()
    ? rawPlan.summary.trim()
    : 'AI trip proposal ready.';

  return {
    summary,
    origin: typeof rawPlan?.origin === 'string' && rawPlan.origin.trim()
      ? rawPlan.origin.trim()
      : (typeof tripDetails.origin === 'string' ? tripDetails.origin.trim() : ''),
    destination: typeof rawPlan?.destination === 'string' && rawPlan.destination.trim()
      ? rawPlan.destination.trim()
      : (typeof tripDetails.destination === 'string' ? tripDetails.destination.trim() : ''),
    tripDurationDays,
    travellerCount,
    budget: pickAllowed(rawPlan?.budget, validBudgets, defaultBudget),
    transportMode: pickAllowed(rawPlan?.transportMode, VALID_TRANSPORT_MODES, defaultMode, TRANSPORT_ALIASES),
    routePreference: pickAllowed(rawPlan?.routePreference, VALID_ROUTE_PREFERENCES, defaultRoute),
    pace: pickAllowed(rawPlan?.pace, VALID_PACES, defaultPace),
    stopDurationMinutes,
    suggestedStops,
    interests: onlyStrings(rawPlan?.interests, 12),
    notes: onlyStrings(rawPlan?.notes, 12),
    followUpQuestions: onlyStrings(rawPlan?.followUpQuestions, 6),
  };
}

// ---------- 7. Main function used by routes/ai.js ----------
export async function createTripPlan(tripDetails) {
  if (!PROVIDER) {
    const error = new Error('No AI provider configured. Add GEMINI_API_KEY or OPENAI_API_KEY to backend/.env.');
    error.status = 503;
    throw error;
  }

  const prompt = buildPrompt(tripDetails);
  let text = '';
  let usedProvider = PROVIDER;

  try {
    if (PROVIDER === 'gemini') {
      try {
        text = await askGemini(prompt);
      } catch (error) {
        // If Gemini fails and OpenAI is available, try OpenAI instead.
        if (!openai) throw error;
        text = await askOpenAI(prompt);
        usedProvider = 'openai';
      }
    } else {
      text = await askOpenAI(prompt);
    }

    const plan = cleanPlan(extractJson(text), tripDetails);
    return { plan, provider: usedProvider };
  } catch (error) {
    console.error('AI planning error:', error.message || error);
    const wrapped = new Error(friendlyAiError(error, PROVIDER));
    wrapped.status = 502;
    throw wrapped;
  }
}

// Turns the raw AI error into a short readable message.
function friendlyAiError(error, provider) {
  const raw = error?.message || String(error || 'Unknown AI API error');

  // Some errors contain a JSON text like {"error": {"message": "...", "code": 403}}
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const found = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (found) {
      try { parsed = JSON.parse(found[0]); } catch { /* ignore */ }
    }
  }

  const message = parsed?.error?.message || raw;
  const status = parsed?.error?.status || '';
  const code = parsed?.error?.code;

  if (provider === 'gemini' && (code === 403 || status === 'PERMISSION_DENIED')) return 'Gemini denied access. ' + message;
  if (provider === 'gemini' && (code === 404 || /no longer available|not found/i.test(message))) return `Gemini model unavailable. ${message}`;
  if (code === 429 || /quota|rate limit/i.test(message)) return `AI rate limit or quota exceeded. ${message}`;
  return message;
}
