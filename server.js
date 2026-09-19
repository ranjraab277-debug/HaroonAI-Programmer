import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import pg from 'pg';
import crypto from 'crypto';
import OpenAI from 'openai';

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 10000);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') ? { rejectUnauthorized: false } : false
});
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'CHANGE_ME',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 }
}));
app.use(express.static('public'));

const oauthStates = new Map();
const AGENT_OFFLINE_MS = 30_000;

const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const random = (bytes = 32) => b64url(crypto.randomBytes(bytes));
const hashPassword = async password => {
  const salt = crypto.randomBytes(16);
  const derived = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key)));
  return `scrypt:${salt.toString('base64')}:${Buffer.from(derived).toString('base64')}`;
};
const verifyPassword = async (password, stored) => {
  try {
    const [scheme, saltB64, hashB64] = String(stored || '').split(':');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await new Promise((resolve, reject) => crypto.scrypt(password, salt, expected.length, (err, key) => err ? reject(err) : resolve(key)));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) { return false; }
};
const pkceChallenge = verifier => b64url(crypto.createHash('sha256').update(verifier).digest());
const requireLogin = (req, res, next) => req.session.userId ? next() : res.status(401).json({ error: 'LOGIN_REQUIRED' });
const agentAuth = (req, res, next) => req.get('x-agent-token') === process.env.AGENT_TOKEN ? next() : res.status(401).json({ error: 'BAD_AGENT_TOKEN' });

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    roblox_id TEXT UNIQUE,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    avatar_url TEXT,
    profile_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // Migration for databases created by the original Roblox-OAuth version.
  await pool.query(`ALTER TABLE users ALTER COLUMN roblox_id DROP NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`).catch(() => {});
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (LOWER(username))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'محادثة جديدة', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY, chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_jobs (
    id UUID PRIMARY KEY, project_id TEXT NOT NULL, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    chat_id UUID REFERENCES chats(id) ON DELETE SET NULL, plan JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_state (
    project_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'offline', snapshot JSONB,
    agent_name TEXT, last_seen TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

app.get('/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: true, version: '3.0.0' }); }
  catch (e) { res.status(503).json({ ok: false, database: false, error: e.message }); }
});

app.post('/auth/register', async (req, res) => {
  try {
    const username = clean(req.body?.username, 40);
    const displayName = clean(req.body?.display_name || username, 80);
    const password = String(req.body?.password || '');
    if (!/^[A-Za-z0-9_\u0600-\u06FF.-]{3,40}$/.test(username)) {
      return res.status(400).json({ error: 'INVALID_USERNAME', message: 'اسم المستخدم يجب أن يكون بين 3 و40 حرفًا.' });
    }
    if (password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: 'INVALID_PASSWORD', message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' });
    }
    const exists = await pool.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1)', [username]);
    if (exists.rowCount) return res.status(409).json({ error: 'USERNAME_TAKEN', message: 'اسم المستخدم مستخدم بالفعل.' });
    const passwordHash = await hashPassword(password);
    const r = await pool.query(
      `INSERT INTO users(username,display_name,password_hash) VALUES($1,$2,$3) RETURNING id,username,display_name,avatar_url,profile_url`,
      [username, displayName || username, passwordHash]
    );
    req.session.userId = r.rows[0].id;
    res.json({ ok: true, user: r.rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'REGISTER_FAILED' }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const username = clean(req.body?.username, 40);
    const password = String(req.body?.password || '');
    const r = await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1', [username]);
    if (!r.rowCount || !r.rows[0].password_hash || !(await verifyPassword(password, r.rows[0].password_hash))) {
      return res.status(401).json({ error: 'INVALID_LOGIN', message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }
    req.session.userId = r.rows[0].id;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'LOGIN_FAILED' }); }
});

app.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const r = await pool.query('SELECT id,username,display_name,avatar_url,profile_url FROM users WHERE id=$1', [req.session.userId]);
  if (!r.rowCount) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, user: r.rows[0] });
});

app.get('/api/chats', requireLogin, async (req, res) => {
  const r = await pool.query('SELECT id,title,created_at,updated_at FROM chats WHERE user_id=$1 ORDER BY updated_at DESC', [req.session.userId]);
  res.json({ chats: r.rows });
});
app.post('/api/chats', requireLogin, async (req, res) => {
  const id = crypto.randomUUID();
  const title = clean(req.body?.title || 'محادثة جديدة', 120) || 'محادثة جديدة';
  const r = await pool.query('INSERT INTO chats(id,user_id,title) VALUES($1,$2,$3) RETURNING *', [id, req.session.userId, title]);
  res.json({ chat: r.rows[0] });
});
app.get('/api/chats/:id', requireLogin, async (req, res) => {
  const c = await pool.query('SELECT * FROM chats WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
  if (!c.rowCount) return res.status(404).json({ error: 'CHAT_NOT_FOUND' });
  const m = await pool.query('SELECT id,role,content,created_at FROM messages WHERE chat_id=$1 ORDER BY id ASC', [req.params.id]);
  res.json({ chat: c.rows[0], messages: m.rows });
});
app.delete('/api/chats/:id', requireLogin, async (req, res) => {
  const r = await pool.query('DELETE FROM chats WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
  res.json({ ok: !!r.rowCount });
});

const SYSTEM = `You are Haroon AI, an expert Roblox Luau coding agent. You understand Arabic and English. Your job is to turn natural-language requests into safe, precise project operations. Never claim an operation was executed; only say it is queued until an agent reports success. Prefer editing existing objects when requested. Do not destroy or overwrite unrelated project content. Use exact Roblox class names and property names. Return ONLY the requested JSON schema. Allowed operations: create_instance, set_property, set_source, destroy, move. Paths are slash-separated DataModel paths such as Workspace/Checkpoints/Stage1 or ServerScriptService/CheckpointSystem. For create_instance use className. For set_property use property and value. For set_source use source. For move use to. If project snapshot is supplied, use it to target existing objects. If the requested operation cannot be performed safely, explain it in assistant_message and return an empty operations array.`;

async function makePlan(text, history, snapshot) {
  if (!openai) throw new Error('OPENAI_API_KEY is missing');
  const context = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: `Current project snapshot (may be empty): ${JSON.stringify(snapshot || {})}` },
    ...history.slice(-12).map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: x.content })),
    { role: 'user', content: text }
  ];
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna', input: context,
    text: { format: { type: 'json_schema', name: 'haroon_plan', strict: true, schema: {
      type: 'object', additionalProperties: false,
      properties: {
        assistant_message: { type: 'string' },
        operations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          op: { type: 'string', enum: ['create_instance','set_property','set_source','destroy','move'] },
          path: { type: 'string' }, className: { type: 'string' }, property: { type: 'string' },
          value: {}, source: { type: 'string' }, to: { type: 'string' }
        }, required: ['op','path'] } }
      }, required: ['assistant_message','operations']
    }}}
  });
  return JSON.parse(response.output_text);
}

app.post('/api/chats/:id/message', requireLogin, async (req, res) => {
  try {
    const text = clean(req.body?.content, 8000);
    if (!text) return res.status(400).json({ error: 'EMPTY_MESSAGE' });
    const c = await pool.query('SELECT * FROM chats WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    if (!c.rowCount) return res.status(404).json({ error: 'CHAT_NOT_FOUND' });
    const h = await pool.query('SELECT role,content FROM messages WHERE chat_id=$1 ORDER BY id ASC', [req.params.id]);
    const a = await pool.query('SELECT snapshot FROM agent_state WHERE project_id=$1', [process.env.DEFAULT_PROJECT_ID || 'main-project']);
    await pool.query('INSERT INTO messages(chat_id,role,content) VALUES($1,$2,$3)', [req.params.id, 'user', text]);
    const plan = await makePlan(text, h.rows, a.rows[0]?.snapshot || {});
    await pool.query('INSERT INTO messages(chat_id,role,content) VALUES($1,$2,$3)', [req.params.id, 'assistant', plan.assistant_message]);
    await pool.query('UPDATE chats SET updated_at=NOW(),title=CASE WHEN title=$2 THEN $3 ELSE title END WHERE id=$1', [req.params.id, 'محادثة جديدة', clean(text.slice(0, 60)) || 'محادثة جديدة']);
    let job = null;
    if (plan.operations?.length) {
      const id = crypto.randomUUID();
      const r = await pool.query('INSERT INTO agent_jobs(id,project_id,user_id,chat_id,plan) VALUES($1,$2,$3,$4,$5) RETURNING id,status', [id, process.env.DEFAULT_PROJECT_ID || 'main-project', req.session.userId, req.params.id, JSON.stringify(plan)]);
      job = r.rows[0];
    }
    res.json({ message: plan.assistant_message, plan, job });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/agent/status', requireLogin, async (req, res) => {
  const project = clean(req.query.project_id || process.env.DEFAULT_PROJECT_ID || 'main-project', 120);
  const r = await pool.query('SELECT * FROM agent_state WHERE project_id=$1', [project]);
  const row = r.rows[0];
  const online = !!row?.last_seen && Date.now() - new Date(row.last_seen).getTime() < AGENT_OFFLINE_MS;
  res.json({ project_id: project, online, state: row || null });
});

app.get('/api/agent/poll', agentAuth, async (req, res) => {
  const project = clean(req.query.project_id || process.env.DEFAULT_PROJECT_ID || 'main-project', 120);
  await pool.query(`INSERT INTO agent_state(project_id,status,last_seen,updated_at) VALUES($1,'online',NOW(),NOW()) ON CONFLICT(project_id) DO UPDATE SET status='online',last_seen=NOW(),updated_at=NOW()`, [project]);
  const r = await pool.query(`SELECT id,project_id,plan FROM agent_jobs WHERE project_id=$1 AND status='queued' ORDER BY created_at ASC LIMIT 1`, [project]);
  if (!r.rowCount) return res.json({ job: null });
  await pool.query('UPDATE agent_jobs SET status=$2,updated_at=NOW() WHERE id=$1', [r.rows[0].id, 'running']);
  res.json({ job: r.rows[0] });
});

app.post('/api/agent/heartbeat', agentAuth, async (req, res) => {
  const project = clean(req.body?.project_id || process.env.DEFAULT_PROJECT_ID || 'main-project', 120);
  const snapshot = req.body?.snapshot || {};
  const name = clean(req.body?.agent_name || 'Haroon Lite Agent', 120);
  await pool.query(`INSERT INTO agent_state(project_id,status,snapshot,agent_name,last_seen,updated_at) VALUES($1,'online',$2,$3,NOW(),NOW()) ON CONFLICT(project_id) DO UPDATE SET status='online',snapshot=$2,agent_name=$3,last_seen=NOW(),updated_at=NOW()`, [project, JSON.stringify(snapshot), name]);
  res.json({ ok: true });
});

app.post('/api/agent/result', agentAuth, async (req, res) => {
  const { job_id, status, result } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id required' });
  const finalStatus = status === 'success' ? 'success' : 'failed';
  await pool.query('UPDATE agent_jobs SET status=$2,result=$3,updated_at=NOW() WHERE id=$1', [job_id, finalStatus, JSON.stringify(result || {})]);
  res.json({ ok: true });
});

app.get('/api/jobs/:id', requireLogin, async (req, res) => {
  const r = await pool.query('SELECT id,status,result,created_at,updated_at FROM agent_jobs WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
  if (!r.rowCount) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  res.json({ job: r.rows[0] });
});


initDb().then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Haroon AI Agent V3 listening on ${PORT}`))).catch(e => { console.error(e); process.exit(1); });
