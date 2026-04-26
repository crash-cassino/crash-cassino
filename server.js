const express = require("express");
const crypto = require("crypto");
const dotenv = require("dotenv");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const TARGET_PROFIT_MARGIN = Number(process.env.TARGET_PROFIT_MARGIN || 0.12);
const INSTANT_CRASH_CHANCE = Number(process.env.INSTANT_CRASH_CHANCE || 0.3);
const BASE_HOUSE_EDGE = Number(process.env.BASE_HOUSE_EDGE || 0.02);
const ROUND_DURATION_MS = Number(process.env.ROUND_DURATION_MS || 9000);
const STREAMER_MODE = String(process.env.STREAMER_MODE || "false").toLowerCase() === "true";
const VISUAL_INTENSITY = Number(process.env.VISUAL_INTENSITY || 1);
const AUTH_SECRET = String(process.env.AUTH_SECRET || "change-me");
const DATABASE_URL = process.env.DATABASE_URL;

const shouldUseSsl = Boolean(DATABASE_URL && !DATABASE_URL.includes("localhost"));
const dbPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined
    })
  : null;

const state = {
  totalWagered: 0,
  totalPaidOut: 0,
  rounds: 0,
  instantCrashes: 0,
  history: []
};

async function ensureDatabaseSchema() {
  if (!dbPool) {
    console.warn("DATABASE_URL não configurada. Endpoints de auth/admin ficarão indisponíveis.");
    return;
  }

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      twofa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      credits NUMERIC(14, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(14, 2) NOT NULL,
      reason TEXT NOT NULL,
      admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function randomFloat() {
  const buffer = crypto.randomBytes(4);
  return buffer.readUInt32BE(0) / 0xffffffff;
}

function calculateCurrentProfit() {
  return state.totalWagered - state.totalPaidOut;
}

function calculateCurrentMargin() {
  if (state.totalWagered === 0) {
    return 0;
  }
  return calculateCurrentProfit() / state.totalWagered;
}

function generateBaseCrashPoint() {
  const r = randomFloat();
  const adjusted = Math.max(1e-9, 1 - r);
  const multiplier = (1 - BASE_HOUSE_EDGE) / adjusted;
  return Number(Math.max(1.0, multiplier).toFixed(2));
}

function getRoundGrowthRate() {
  return STREAMER_MODE ? 0.18 : 0.14;
}

function getMaxCrashPointForDuration() {
  const seconds = Math.max(0.1, ROUND_DURATION_MS / 1000);
  const maxByDuration = Math.exp(getRoundGrowthRate() * seconds);
  return Number(Math.max(1.01, maxByDuration).toFixed(2));
}

function shouldForceInstantCrash(currentMargin) {
  if (currentMargin >= TARGET_PROFIT_MARGIN) {
    return false;
  }
  return randomFloat() < INSTANT_CRASH_CHANCE;
}

function createRound() {
  const currentMargin = calculateCurrentMargin();
  const forceInstant = shouldForceInstantCrash(currentMargin);
  const rawCrashPoint = forceInstant ? 1.0 : generateBaseCrashPoint();
  const maxCrashPoint = getMaxCrashPointForDuration();
  const crashPoint = Number(Math.min(rawCrashPoint, maxCrashPoint).toFixed(2));

  state.rounds += 1;
  if (forceInstant) {
    state.instantCrashes += 1;
  }

  const round = {
    id: state.rounds,
    crashPoint,
    mode: forceInstant ? "instant_crash" : "normal",
    createdAt: new Date().toISOString(),
    durationMs: ROUND_DURATION_MS
  };

  state.history.unshift(round);
  if (state.history.length > 30) {
    state.history.pop();
  }

  return round;
}

function requireDatabase(req, res, next) {
  if (!dbPool) {
    return res.status(503).json({ error: "DATABASE_URL não configurada no ambiente" });
  }
  return next();
}

function signToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      email: user.email
    },
    AUTH_SECRET,
    { expiresIn: "7d" }
  );
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return res.status(401).json({ error: "Token ausente" });
  }

  try {
    const payload = jwt.verify(token, AUTH_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Apenas admin pode acessar esta rota" });
  }
  return next();
}

app.get("/api", (req, res) => {
  res.json({
    message: "Crash backend online",
    docs: {
      health: "GET /health",
      stats: "GET /stats",
      startRound: "POST /round/start",
      settleBet: "POST /bet/settle",
      register: "POST /auth/register",
      login: "POST /auth/login",
      me: "GET /auth/me"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "crash-backend", database: Boolean(dbPool) ? "configured" : "not_configured" });
});

app.post("/auth/register", requireDatabase, async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const rawPassword = String(password || "");

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return res.status(400).json({ error: "Email inválido" });
  }
  if (rawPassword.length < 6) {
    return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });
  }

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Email já cadastrado" });
    }

    const adminCount = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
    const role = adminCount.rows[0].count === 0 ? "admin" : "player";
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const created = await client.query(
      `
      INSERT INTO users (email, password_hash, role, email_verified, credits)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, role, email_verified, twofa_enabled, credits, created_at
      `,
      [normalizedEmail, passwordHash, role, false, 0]
    );

    await client.query("COMMIT");
    const user = created.rows[0];
    return res.status(201).json({
      message: "Conta criada com sucesso",
      user
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Falha ao criar conta" });
  } finally {
    client.release();
  }
});

app.post("/auth/login", requireDatabase, async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const rawPassword = String(password || "");

  if (!normalizedEmail || !rawPassword) {
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  }

  try {
    const found = await dbPool.query(
      "SELECT id, email, password_hash, role, email_verified, twofa_enabled, credits FROM users WHERE email = $1",
      [normalizedEmail]
    );
    if (found.rows.length === 0) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const user = found.rows[0];
    const isValid = await bcrypt.compare(rawPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const token = signToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.email_verified,
        twofaEnabled: user.twofa_enabled,
        credits: Number(user.credits)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha no login" });
  }
});

app.get("/auth/me", requireDatabase, requireAuth, async (req, res) => {
  try {
    const found = await dbPool.query(
      "SELECT id, email, role, email_verified, twofa_enabled, credits, created_at FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const user = found.rows[0];
    return res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.email_verified,
      twofaEnabled: user.twofa_enabled,
      credits: Number(user.credits),
      createdAt: user.created_at
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar perfil" });
  }
});

app.get("/admin/users", requireDatabase, requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await dbPool.query(
      "SELECT id, email, role, email_verified, twofa_enabled, credits, created_at FROM users ORDER BY created_at DESC LIMIT 200"
    );
    const users = result.rows.map((item) => ({
      id: item.id,
      email: item.email,
      role: item.role,
      emailVerified: item.email_verified,
      twofaEnabled: item.twofa_enabled,
      credits: Number(item.credits),
      createdAt: item.created_at
    }));
    return res.json({ users });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar usuários" });
  }
});

app.post("/admin/credits/add", requireDatabase, requireAuth, requireAdmin, async (req, res) => {
  const userId = Number(req.body.userId);
  const amount = Number(req.body.amount);
  const reason = String(req.body.reason || "admin_credit");

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "userId inválido" });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount deve ser maior que 0" });
  }

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      "UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING id, email, credits",
      [amount, userId]
    );
    if (updated.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    await client.query(
      "INSERT INTO credit_transactions (user_id, amount, reason, admin_user_id) VALUES ($1, $2, $3, $4)",
      [userId, amount, reason, req.user.userId]
    );
    await client.query("COMMIT");

    const user = updated.rows[0];
    return res.json({
      message: "Créditos adicionados",
      user: {
        id: user.id,
        email: user.email,
        credits: Number(user.credits)
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Falha ao adicionar créditos" });
  } finally {
    client.release();
  }
});

app.post("/round/start", requireDatabase, requireAuth, async (req, res) => {
  try {
    const user = await dbPool.query("SELECT credits FROM users WHERE id = $1", [req.user.userId]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    const credits = Number(user.rows[0].credits || 0);
    if (credits <= 0) {
      return res.status(400).json({ error: "Saldo insuficiente para iniciar aposta" });
    }
  } catch (error) {
    return res.status(500).json({ error: "Falha ao validar saldo" });
  }

  const round = createRound();
  res.json(round);
});

app.post("/bet/settle", requireDatabase, requireAuth, async (req, res) => {
  const { wager, autoCashoutAt, crashPoint } = req.body;

  const numericWager = Number(wager);
  const numericAutoCashoutAt = Number(autoCashoutAt);
  const numericCrashPoint = Number(crashPoint);

  if (!Number.isFinite(numericWager) || numericWager <= 0) {
    return res.status(400).json({ error: "wager deve ser um número maior que 0" });
  }

  if (!Number.isFinite(numericAutoCashoutAt) || numericAutoCashoutAt < 1) {
    return res.status(400).json({ error: "autoCashoutAt deve ser >= 1.0" });
  }

  if (!Number.isFinite(numericCrashPoint) || numericCrashPoint < 1) {
    return res.status(400).json({ error: "crashPoint inválido" });
  }

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    const found = await client.query("SELECT credits FROM users WHERE id = $1 FOR UPDATE", [req.user.userId]);
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const currentCredits = Number(found.rows[0].credits || 0);
    if (currentCredits < numericWager) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    const won = numericAutoCashoutAt < numericCrashPoint;
    const payout = won ? Number((numericWager * numericAutoCashoutAt).toFixed(2)) : 0;
    const newCredits = Number((currentCredits - numericWager + payout).toFixed(2));

    await client.query("UPDATE users SET credits = $1 WHERE id = $2", [newCredits, req.user.userId]);
    await client.query(
      "INSERT INTO credit_transactions (user_id, amount, reason, admin_user_id) VALUES ($1, $2, $3, $4)",
      [req.user.userId, -numericWager, "bet_wager", null]
    );
    if (payout > 0) {
      await client.query(
        "INSERT INTO credit_transactions (user_id, amount, reason, admin_user_id) VALUES ($1, $2, $3, $4)",
        [req.user.userId, payout, "bet_payout", null]
      );
    }

    state.totalWagered += numericWager;
    state.totalPaidOut += payout;
    await client.query("COMMIT");

    return res.json({
      won,
      wager: numericWager,
      autoCashoutAt: numericAutoCashoutAt,
      crashPoint: numericCrashPoint,
      payout,
      balance: newCredits,
      houseProfit: Number(calculateCurrentProfit().toFixed(2)),
      profitMargin: Number(calculateCurrentMargin().toFixed(4))
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Falha ao liquidar aposta" });
  } finally {
    client.release();
  }
});

app.get("/stats", (req, res) => {
  res.json({
    rounds: state.rounds,
    instantCrashes: state.instantCrashes,
    totalWagered: Number(state.totalWagered.toFixed(2)),
    totalPaidOut: Number(state.totalPaidOut.toFixed(2)),
    houseProfit: Number(calculateCurrentProfit().toFixed(2)),
    profitMargin: Number(calculateCurrentMargin().toFixed(4)),
    config: {
      targetProfitMargin: TARGET_PROFIT_MARGIN,
      instantCrashChance: INSTANT_CRASH_CHANCE,
      baseHouseEdge: BASE_HOUSE_EDGE,
      roundDurationMs: ROUND_DURATION_MS,
      streamerMode: STREAMER_MODE,
      visualIntensity: VISUAL_INTENSITY
    },
    recentRounds: state.history
  });
});

ensureDatabaseSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Crash backend rodando em http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Falha ao inicializar banco de dados:", error.message);
    process.exit(1);
  });
