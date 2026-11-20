See ../BACKEND_EXPLAINED.md for the folder structure and a simple explanation of how the backend works.


Yatra Mitra AI backend
This Express service keeps the Google Gemini API key on the server and powers the AI Trip Copilot.

Setup (Windows PowerShell)
Open a terminal in the backend folder:
cd path\to\smart-multi-stop-planner\backend
Install dependencies:
npm install
Copy .env.example to .env.
Put your own Gemini API key in .env as GEMINI_API_KEY=....
If Atlas startup fails with `querySrv ECONNREFUSED` while DNS works in Windows, set `MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1` in `.env` and restart the backend.
Optional: if Gemini is unavailable, set OPENAI_API_KEY (and optionally AI_PROVIDER=openai).
Start the API with npm run dev.
Confirm http://localhost:8787/api/health reports "ok": true and "aiConfigured": true.
In a second terminal, start the React/Vite frontend from frontend using npm run dev.
The frontend proxies /api/ai/plan to http://localhost:8787. Keep both terminals running while developing.
The Yatra Mitra app is a travel app that provides trip planning for solo or group trips and uses a Gemini API key for trip assistance.
AI and privacy
Never put GEMINI_API_KEY in frontend React code or commit .env to Git.
API use may incur charges. Review usage and billing limits in your Google AI account.
The AI interprets the trip brief, chooses a transport mode and route priorities, and suggests places. The frontend geocodes suggestions and calculates supported routes.
Voice input uses browser speech recognition where supported and requires microphone permission. Users can choose English (India), Hindi, or English (US); typed input remains available.
Set GEMINI_MODEL in .env to a text-generation model available to your API key. The default is gemini-3.8-flash.
If /api/ai/plan returns 502 with PERMISSION_DENIED, create a fresh key at https://aistudio.google.com/apikey, confirm the project is not flagged Unavailable, update GEMINI_API_KEY, and restart the backend.
Transport coverage and limitations
Car routes use OSRM / OpenStreetMap road data.
Walking and bicycle routes use public OpenStreetMap routing profiles.
Motorcycle and scooter routes use a car-compatible approximation.
Train, metro, bus, and general public transport open Google Maps transit directions and per-leg searches. This app does not fetch live timetables, fares, transfer details, or draw actual transit tracks inside its map.
Flight mode opens a Google Flights search for the origin and destination. The in-app connector is schematic, not an actual flight path; fares and flight availability are not fetched by this app.
Scenic, eco-friendly, accessible, avoid-tolls/highways, fewer-transfers, and less-walking preferences guide AI recommendations but are not guaranteed unless the routing provider explicitly supports them.
Verify schedules, prices, opening hours, accessibility, and service availability with official providers before travel.
Place suggestions are resolved using Photon geocoding. Confirm that each result is the intended place.
API endpoints
GET /api/health — checks whether the backend has an API key configured.
POST /api/ai/plan — creates a structured AI trip proposal.
