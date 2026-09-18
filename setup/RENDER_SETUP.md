# Haroon AI Agent V3 — Render setup

1. Create a Render Web Service from this folder/repository.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add every variable from `.env.example`.
5. Create a PostgreSQL database on Render and put its connection string into `DATABASE_URL`.
6. Set `OPENAI_API_KEY` to your new OpenAI API key. Never put it in the browser or Roblox.
7. Set `OPENAI_MODEL=gpt-5.6-luna`.
8. Register a Roblox OAuth application and set `ROBLOX_CLIENT_ID`, `ROBLOX_CLIENT_SECRET`, and `ROBLOX_REDIRECT_URI`.
9. The redirect URI must be exactly `https://YOUR-RENDER-DOMAIN.onrender.com/auth/roblox/callback`.
10. Set a long random `SESSION_SECRET` and `AGENT_TOKEN`.
11. Open `/health` and confirm `ok:true` and `database:true`.
