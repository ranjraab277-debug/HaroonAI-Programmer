# Haroon AI Agent V1
Web UI -> Render backend -> OpenAI -> JSON build plan -> Roblox Studio-side executor.

Render Build: npm install
Render Start: npm start
Environment: OPENAI_API_KEY, OPENAI_MODEL=gpt-5.6-luna, AGENT_TOKEN

Firebase: create your own project, enable Google Authentication and Firestore, then use firebase/firestore.rules.

IMPORTANT: a normal Roblox game script is not a Studio editor plugin. The included executor is for a Studio/plugin-style environment. Studio Lite may not expose the same editor APIs; direct automatic editing of the place from an external web server is not guaranteed.
