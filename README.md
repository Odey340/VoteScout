# VoteScout
Enter your address. See your ballot. Understand your local elections

VoteScout maps your exact polling locations using ArcGIs and uses AI to generate nuetral summaries of the candidates on your specific ballot. Built with Rust backend because it's the best language ever created.

Features:

Addres
Address Lookup: Fetches exact elections, candidates, and polling places via Google Civic API.
Interactive Map: ArcGIS integration with color-coded pins for polling locations and drop boxes.
AI Race Briefings: Claude-generated, neutral summaries of candidates and key issues (cached in Rust to save API costs).
Voting Plan: Generates a personalized voting plan and a downloadable .ics calendar reminder.
Live Results Demo: Real-time simulated election night results streamed via Server-Sent Events (SSE).

🛠️ Tech Stack
Backend: Rust, Axum, Tokio, Reqwest, Serde
Frontend: React, Vite, Tailwind CSS
Mapping: ArcGIS Maps SDK for JavaScript
AI: Claude (via OpenRouter)
Data: Google Civic Information API
