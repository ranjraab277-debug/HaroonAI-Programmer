# Roblox Account setup

Haroon AI uses Roblox OAuth 2.0 + PKCE. It does not ask for a Roblox password.

1. Open the Roblox Creator Dashboard credentials/OAuth area.
2. Register an OAuth application.
3. Add the exact Render callback URL:
   `https://YOUR-RENDER-DOMAIN.onrender.com/auth/roblox/callback`
4. Request the `openid profile` scopes.
5. Put the client ID and client secret into Render environment variables.
6. Open Haroon AI and choose `Create Account with Roblox`.
7. After authorization, Haroon AI stores the stable Roblox subject ID plus username, display name and avatar URL in PostgreSQL.
8. `Login with Roblox` only logs into an existing Haroon AI account.
