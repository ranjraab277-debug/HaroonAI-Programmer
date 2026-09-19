# Haroon AI Agent V3

Haroon AI is a Roblox-focused coding agent with:

- Internal Haroon AI accounts (username + password). Roblox OAuth is not required.
- Roblox avatar, username and display name
- Create Account / Login
- PostgreSQL account and chat persistence
- Multiple chats per Roblox account
- Real OpenAI Responses API model selection through `OPENAI_MODEL`
- Project-aware AI planning from an agent snapshot
- Agent queue, heartbeat, status and result reporting
- A Studio Lite project-side bridge under `bridge/`
- No Firebase

## Architecture

Browser → Render Backend → OpenAI → JSON Build Plan → Agent Queue → Lite Bridge (when supported)

## Important Studio Lite limitation

The included bridge is not a Plugin and does not claim editor-level Source editing. Runtime Luau cannot generally set Script.Source. If your Studio Lite build does not allow HttpService, the bridge cannot connect to the web backend either. In that case Haroon AI can still generate plans/code, but automatic editor modification is not available through this package.

## Security

- Keep `OPENAI_API_KEY` only on Render.
- Keep `ROBLOX_CLIENT_SECRET` only on Render.
- Keep `SESSION_SECRET` only on Render.
- Keep `AGENT_TOKEN` secret. The bridge needs the Agent Token, not the OpenAI key.


## Account system
This version uses Haroon AI accounts with username + password. Roblox OAuth and Firebase are not required. Passwords are hashed with Node.js scrypt before storage.
