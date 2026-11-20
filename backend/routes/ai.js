// ------------------------------------------------------------
// routes/ai.js   ->   POST /api/ai/plan
// The user describes a trip and the AI suggests stops, transport, etc.
// ------------------------------------------------------------
import express from 'express';
import { auth } from '../middleware/auth.js';
import { createTripPlan, getAiStatus } from '../services/aiService.js';

const router = express.Router();

router.post('/plan', auth, async (req, res) => {
  const { origin = '', destination = '', existingStops = [], userRequest = '', preferences = {} } = req.body || {};

  // 0. Is an AI key configured at all?
  if (!getAiStatus().aiConfigured) {
    return res.status(503).json({ error: 'No AI provider configured. Add GEMINI_API_KEY or OPENAI_API_KEY to backend/.env.' });
  }

  // 1. Check the input
  if (typeof origin !== 'string' || typeof destination !== 'string') {
    return res.status(400).json({ error: 'Starting location and destination must be text.' });
  }
  if (typeof userRequest !== 'string' || !userRequest.trim()) {
    return res.status(400).json({ error: 'Please describe the trip you want.' });
  }
  if (userRequest.length > 6000) {
    return res.status(413).json({ error: 'Keep your trip description under 6,000 characters.' });
  }

  // 2. Collect the trip details we send to the AI
  const tripDetails = {
    origin: origin.trim(),
    destination: destination.trim(),
    existingStops: Array.isArray(existingStops) ? existingStops.slice(0, 10) : [],
    userRequest: userRequest.trim(),
    preferences: preferences && typeof preferences === 'object' ? preferences : {},
  };

  // 3. Ask the AI and send the answer back
  const result = await createTripPlan(tripDetails);
  res.json(result); // { plan, provider }
});

export default router;
