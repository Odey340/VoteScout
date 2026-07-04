# VoteScout

Enter your address. See your ballot. Understand your local elections.

VoteScout maps your exact polling locations using ArcGIS and uses AI to generate neutral summaries of the candidates on your specific ballot. Built with a Rust backend because it's the best language ever created.

## Features

- **Address Lookup**: Fetches exact elections, candidates, and polling places via Google Civic API.
- **Interactive Map**: ArcGIS integration with color-coded pins for polling locations and drop boxes.
- **AI Race Briefings**: Claude-generated, neutral summaries of candidates and key issues (cached in Rust to save API costs).
- **Voting Plan**: Generates a personalized voting plan and a downloadable .ics calendar reminder.

## 🛠️ Tech Stack

- **Backend**: Rust, Axum, Tokio, Reqwest, Serde
- **Frontend**: React, Vite
- **Mapping**: ArcGIS Maps SDK for JavaScript
- **AI**: Claude (via OpenRouter)
- **Data**: Google Civic Information API

## Setup

```powershell
# Backend env file — then fill in your API keys
Copy-Item backend\.env.example backend\.env

# Frontend dependencies
cd frontend
npm install
```

## Running (two terminals)

**Terminal 1 — backend** (http://localhost:3001):

```powershell
cd backend
cargo run
```

**Terminal 2 — frontend** (http://localhost:5173):

```powershell
cd frontend
npm run dev
```

Then open http://localhost:5173, enter a ZIP code and street address, and click **Find my elections**.

## Configuration

`backend/.env` (gitignored; see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Backend listen port |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `GOOGLE_CIVIC_API_KEY` | — | Google Civic Information API key (required) |
| `OPENROUTER_API_KEY` | — | OpenRouter key for AI briefings and voting plans (optional; AI features return 503 without it) |

The frontend reads `VITE_API_BASE` (defaults to `http://localhost:3001`) if you need to point it elsewhere.

## API

| Endpoint | Description |
|---|---|
| `GET /api/elections?address=...` | Elections, polling places, early voting, drop-offs, and contests for an address (`?demo=true` for mock data) |
| `POST /api/candidate-summary` | Neutral AI briefing for one race (in-memory cached) |
| `POST /api/voting-plan` | Personalized voting-plan email + .ics calendar file |
