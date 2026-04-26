const express = require("express");
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
const AUTH_SECRET = String(process.env.AUTH_SECRET || "change-me");
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_SETUP_KEY = String(process.env.ADMIN_SETUP_KEY || "");
const TARGET_PROFIT_MARGIN = Number(process.env.TARGET_PROFIT_MARGIN || 0.12);
const INSTANT_CRASH_CHANCE = Number(process.env.INSTANT_CRASH_CHANCE || 0.3);
const BASE_HOUSE_EDGE = Number(process.env.BASE_HOUSE_EDGE || 0.02);
const ROUND_DURATION_MS = Number(process.env.ROUND_DURATION_MS || 9000);
const ROUND_GROWTH_RATE = Number(process.env.ROUND_GROWTH_RATE || 0.11);
const MARGIN_SMOOTHING_ALPHA = Number(process.env.MARGIN_SMOOTHING_ALPHA || 0.12);
const MARGIN_HYSTERESIS = Number(process.env.MARGIN_HYSTERESIS || 0.015);
const MIN_INSTANT_CRASH_CHANCE = Number(process.env.MIN_INSTANT_CRASH_CHANCE || 0.03);
const MAX_INSTANT_CRASH_CHANCE = Number(process.env.MAX_INSTANT_CRASH_CHANCE || 0.42);
const MIN_WAGER_PER_ROUND = Number(process.env.MIN_WAGER_PER_ROUND || 1);
const MAX_WAGER_PER_ROUND = Number(process.env.MAX_WAGER_PER_ROUND || 10);
const SLOT_TARGET_PROFIT_MARGIN = Number(process.env.SLOT_TARGET_PROFIT_MARGIN || 0.14);
const SLOT_FORCE_LOSS_BASE_CHANCE = Number(process.env.SLOT_FORCE_LOSS_BASE_CHANCE || 0.24);
const SLOT_MIN_FORCE_LOSS_CHANCE = Number(process.env.SLOT_MIN_FORCE_LOSS_CHANCE || 0.08);
const SLOT_MAX_FORCE_LOSS_CHANCE = Number(process.env.SLOT_MAX_FORCE_LOSS_CHANCE || 0.8);

const shouldUseSsl = Boolean(DATABASE_URL && !DATABASE_URL.includes("localhost"));
const dbPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined
    })
  : null;

const gameState = {
  totalWagered: 0,
  totalPaidOut: 0,
  rounds: 0,
  instantCrashes: 0,
  smoothedMargin: 0,
  consecutiveInstant: 0,
  consecutiveNormal: 0
};

const slotState = {
  totalWagered: 0,
  totalPaidOut: 0
};

async function ensureDatabaseSchema() {
  if (!dbPool) {
    throw new Error("DATABASE_URL não configurada");
  }

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      twofa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      credits NUMERIC(14, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT users_role_check CHECK (role IN ('player', 'admin'))
    );
  `);

  // Backward-compatible migrations for older deployments.
  await dbPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;");
  await dbPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();");
  await dbPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;");
  await dbPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN NOT NULL DEFAULT FALSE;");
  await dbPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS credits NUMERIC(14, 2) NOT NULL DEFAULT 0;");

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

function requireDatabase(req, res, next) {
  if (!dbPool) {
    return res.status(503).json({ error: "Banco de dados indisponível" });
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
    req.user = jwt.verify(token, AUTH_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Acesso exclusivo de administrador" });
  }
  return next();
}

function requirePlayer(req, res, next) {
  if (!req.user || req.user.role !== "player") {
    return res.status(403).json({ error: "Acesso exclusivo de jogador" });
  }
  return next();
}

function randomFloat() {
  return Math.random();
}

function calculateCurrentProfit() {
  return gameState.totalWagered - gameState.totalPaidOut;
}

function calculateCurrentMargin() {
  if (gameState.totalWagered === 0) {
    return 0;
  }
  return calculateCurrentProfit() / gameState.totalWagered;
}

function generateBaseCrashPoint() {
  const r = randomFloat();
  const adjusted = Math.max(1e-9, 1 - r);
  const multiplier = ((1 - BASE_HOUSE_EDGE) / adjusted) * (1 - BASE_HOUSE_EDGE * 0.6);
  return Number(Math.max(1.0, multiplier).toFixed(2));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSmoothedMargin(currentMargin) {
  gameState.smoothedMargin =
    gameState.smoothedMargin * (1 - MARGIN_SMOOTHING_ALPHA) + currentMargin * MARGIN_SMOOTHING_ALPHA;
  return gameState.smoothedMargin;
}

function shouldForceInstantCrash(smoothedMargin) {
  const deficit = TARGET_PROFIT_MARGIN - smoothedMargin;

  // Smooth correction: when near target, avoid hard switches that create obvious streaks.
  let dynamicChance = INSTANT_CRASH_CHANCE;
  if (Math.abs(deficit) <= MARGIN_HYSTERESIS) {
    dynamicChance = INSTANT_CRASH_CHANCE * 0.6;
  } else {
    dynamicChance = INSTANT_CRASH_CHANCE + deficit * 1.25;
  }

  // Tiny per-round jitter avoids repetitive deterministic patterns.
  dynamicChance += (randomFloat() - 0.5) * 0.06;

  // Anti-streak control: reduce long blocks of same outcome.
  if (gameState.consecutiveInstant >= 3) {
    dynamicChance -= 0.18;
  }
  if (gameState.consecutiveNormal >= 6) {
    dynamicChance += 0.09;
  }

  dynamicChance = clamp(dynamicChance, MIN_INSTANT_CRASH_CHANCE, MAX_INSTANT_CRASH_CHANCE);
  return randomFloat() < dynamicChance;
}

function createRound() {
  const currentMargin = calculateCurrentMargin();
  const smoothedMargin = getSmoothedMargin(currentMargin);
  const forceInstant = shouldForceInstantCrash(smoothedMargin);
  const rawCrashPoint = forceInstant ? 1.0 : generateBaseCrashPoint();
  const maxCrashPoint = Number(Math.exp(ROUND_GROWTH_RATE * Math.max(0.1, ROUND_DURATION_MS / 1000)).toFixed(2));
  const crashPoint = Number(Math.min(rawCrashPoint, Math.max(1.01, maxCrashPoint)).toFixed(2));

  gameState.rounds += 1;
  if (forceInstant) {
    gameState.instantCrashes += 1;
    gameState.consecutiveInstant += 1;
    gameState.consecutiveNormal = 0;
  } else {
    gameState.consecutiveNormal += 1;
    gameState.consecutiveInstant = 0;
  }

  return {
    id: gameState.rounds,
    crashPoint,
    mode: forceInstant ? "instant_crash" : "normal",
    durationMs: ROUND_DURATION_MS,
    growthRate: ROUND_GROWTH_RATE
  };
}

function pickSlotSymbol() {
  const roll = randomFloat();
  if (roll < 0.34) return "cherry";
  if (roll < 0.60) return "lemon";
  if (roll < 0.78) return "bell";
  if (roll < 0.92) return "seven";
  return "diamond";
}

function getSlotMultiplier(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    if (a === "cherry") return 1.8;
    if (a === "lemon") return 2.8;
    if (a === "bell") return 4.5;
    if (a === "seven") return 8.0;
    if (a === "diamond") return 14.0;
  }

  // Consolation only when there are exactly two cherries.
  const cherries = reels.filter((symbol) => symbol === "cherry").length;
  if (cherries === 2) {
    return 0.2;
  }
  return 0;
}

function calculateSlotMargin() {
  if (slotState.totalWagered <= 0) return 0;
  return (slotState.totalWagered - slotState.totalPaidOut) / slotState.totalWagered;
}

function shouldForceSlotLoss() {
  const margin = calculateSlotMargin();
  const deficit = SLOT_TARGET_PROFIT_MARGIN - margin;
  let chance = SLOT_FORCE_LOSS_BASE_CHANCE + deficit * 1.35;
  chance += (Math.random() - 0.5) * 0.05;
  chance = clamp(chance, SLOT_MIN_FORCE_LOSS_CHANCE, SLOT_MAX_FORCE_LOSS_CHANCE);
  return Math.random() < chance;
}

function generateSlotReels(forceLoss) {
  if (!forceLoss) {
    return [pickSlotSymbol(), pickSlotSymbol(), pickSlotSymbol()];
  }

  for (let i = 0; i < 24; i += 1) {
    const reels = [pickSlotSymbol(), pickSlotSymbol(), pickSlotSymbol()];
    if (getSlotMultiplier(reels) === 0) {
      return reels;
    }
  }

  // Deterministic fallback to avoid any accidental win.
  return ["diamond", "seven", "bell"];
}

async function mapUserFromId(userId) {
  const result = await dbPool.query(
    `SELECT id, email, role, is_active, email_verified, twofa_enabled, credits, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "crash-backend", database: dbPool ? "configured" : "not_configured" });
});

app.get("/api", (req, res) => {
  res.json({
    message: "Auth and user management API online",
    docs: {
      setupAdmin: "POST /setup/admin",
      register: "POST /auth/register",
      userLogin: "POST /auth/login",
      adminLogin: "POST /auth/admin/login",
      me: "GET /auth/me",
      adminUsers: "GET /admin/users",
      adminCreateUser: "POST /admin/users",
      adminSetStatus: "PATCH /admin/users/:id/status",
      adminAddCredits: "POST /admin/credits/add",
      startRound: "POST /round/start",
      settleBet: "POST /bet/settle",
      slotSpin: "POST /slot/spin"
    }
  });
});

app.post("/setup/admin", requireDatabase, async (req, res) => {
  const setupKey = String(req.body.setupKey || "");
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!ADMIN_SETUP_KEY) {
    return res.status(400).json({ error: "ADMIN_SETUP_KEY não configurada no ambiente" });
  }
  if (setupKey !== ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: "Chave de setup inválida" });
  }
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Email inválido" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });
  }

  try {
    const adminCount = await dbPool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
    if (adminCount.rows[0].count > 0) {
      return res.status(409).json({ error: "Já existe admin cadastrado" });
    }

    const hash = await bcrypt.hash(password, 10);
    const created = await dbPool.query(
      `INSERT INTO users (email, password_hash, role, email_verified, credits)
       VALUES ($1, $2, 'admin', TRUE, 0)
       RETURNING id, email, role, is_active, credits, created_at`,
      [email, hash]
    );
    return res.status(201).json({ message: "Admin inicial criado", user: created.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao criar admin inicial" });
  }
});

app.post("/auth/register", requireDatabase, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Email inválido" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await dbPool.query(
      `INSERT INTO users (email, password_hash, role, email_verified, credits)
       VALUES ($1, $2, 'player', FALSE, 0)
       RETURNING id, email, role, is_active, email_verified, twofa_enabled, credits, created_at`,
      [email, passwordHash]
    );
    return res.status(201).json({ message: "Conta criada com sucesso", user: created.rows[0] });
  } catch (error) {
    if (String(error.message).includes("duplicate key")) {
      return res.status(409).json({ error: "Email já cadastrado" });
    }
    return res.status(500).json({ error: "Falha ao criar conta" });
  }
});

app.post("/auth/login", requireDatabase, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  try {
    const found = await dbPool.query(
      `SELECT id, email, role, is_active, password_hash, email_verified, twofa_enabled, credits
       FROM users WHERE email = $1`,
      [email]
    );
    if (found.rows.length === 0) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const user = found.rows[0];
    if (user.role !== "player") {
      return res.status(403).json({ error: "Use o login administrativo para esta conta" });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: "Conta desativada. Fale com o administrador." });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const token = signToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        credits: Number(user.credits),
        emailVerified: user.email_verified,
        twofaEnabled: user.twofa_enabled
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha no login de usuário" });
  }
});

app.post("/auth/admin/login", requireDatabase, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  try {
    const found = await dbPool.query(
      `SELECT id, email, role, is_active, password_hash, email_verified, twofa_enabled, credits
       FROM users WHERE email = $1`,
      [email]
    );
    if (found.rows.length === 0) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const user = found.rows[0];
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Conta sem permissão administrativa" });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: "Conta admin desativada" });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const token = signToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        credits: Number(user.credits),
        emailVerified: user.email_verified,
        twofaEnabled: user.twofa_enabled
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha no login administrativo" });
  }
});

app.get("/auth/me", requireDatabase, requireAuth, async (req, res) => {
  try {
    const user = await mapUserFromId(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    return res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.is_active,
      emailVerified: user.email_verified,
      twofaEnabled: user.twofa_enabled,
      credits: Number(user.credits),
      createdAt: user.created_at
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar perfil" });
  }
});

app.get("/admin/overview", requireDatabase, requireAuth, requireAdmin, async (req, res) => {
  try {
    const [usersCount, activeUsersCount, totalCredits] = await Promise.all([
      dbPool.query("SELECT COUNT(*)::int AS count FROM users"),
      dbPool.query("SELECT COUNT(*)::int AS count FROM users WHERE is_active = TRUE"),
      dbPool.query("SELECT COALESCE(SUM(credits), 0)::numeric AS total FROM users")
    ]);
    return res.json({
      totalUsers: usersCount.rows[0].count,
      activeUsers: activeUsersCount.rows[0].count,
      totalCredits: Number(totalCredits.rows[0].total || 0)
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar overview" });
  }
});

app.get("/admin/users", requireDatabase, requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await dbPool.query(
      `SELECT id, email, role, is_active, email_verified, twofa_enabled, credits, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    return res.json({
      users: result.rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        isActive: u.is_active,
        emailVerified: u.email_verified,
        twofaEnabled: u.twofa_enabled,
        credits: Number(u.credits),
        createdAt: u.created_at
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar usuários" });
  }
});

app.post("/admin/users", requireDatabase, requireAuth, requireAdmin, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = req.body.role === "admin" ? "admin" : "player";
  const initialCredits = Number(req.body.initialCredits || 0);

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Email inválido" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });
  }
  if (!Number.isFinite(initialCredits) || initialCredits < 0) {
    return res.status(400).json({ error: "Créditos iniciais inválidos" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const created = await dbPool.query(
      `INSERT INTO users (email, password_hash, role, email_verified, credits)
       VALUES ($1, $2, $3, FALSE, $4)
       RETURNING id, email, role, is_active, email_verified, twofa_enabled, credits, created_at`,
      [email, hash, role, initialCredits]
    );
    return res.status(201).json({ message: "Usuário criado com sucesso", user: created.rows[0] });
  } catch (error) {
    if (String(error.message).includes("duplicate key")) {
      return res.status(409).json({ error: "Email já cadastrado" });
    }
    return res.status(500).json({ error: "Falha ao criar usuário" });
  }
});

app.patch("/admin/users/:id/status", requireDatabase, requireAuth, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const isActive = Boolean(req.body.isActive);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "ID de usuário inválido" });
  }

  try {
    const updated = await dbPool.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, role, is_active, credits`,
      [isActive, userId]
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    return res.json({ message: "Status atualizado", user: updated.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao atualizar status" });
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
      "UPDATE users SET credits = credits + $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, credits",
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
    return res.json({ message: "Créditos adicionados", user: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Falha ao adicionar créditos" });
  } finally {
    client.release();
  }
});

app.post("/round/start", requireDatabase, requireAuth, requirePlayer, async (req, res) => {
  try {
    const user = await mapUserFromId(req.user.userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: "Conta de jogador inativa" });
    }
    if (Number(user.credits) <= 0) {
      return res.status(400).json({ error: "Saldo insuficiente" });
    }
    return res.json(createRound());
  } catch (error) {
    return res.status(500).json({ error: "Falha ao iniciar rodada" });
  }
});

app.post("/bet/settle", requireDatabase, requireAuth, requirePlayer, async (req, res) => {
  const wager = Number(req.body.wager);
  const autoCashoutAt = Number(req.body.autoCashoutAt);
  const crashPoint = Number(req.body.crashPoint);

  if (!Number.isFinite(wager) || wager < MIN_WAGER_PER_ROUND || wager > MAX_WAGER_PER_ROUND) {
    return res
      .status(400)
      .json({ error: `A aposta por rodada deve ser entre ${MIN_WAGER_PER_ROUND} e ${MAX_WAGER_PER_ROUND} créditos` });
  }
  if (!Number.isFinite(autoCashoutAt) || autoCashoutAt < 1) {
    return res.status(400).json({ error: "Auto cashout inválido" });
  }
  if (!Number.isFinite(crashPoint) || crashPoint < 1) {
    return res.status(400).json({ error: "Crash point inválido" });
  }

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT credits, is_active FROM users WHERE id = $1 FOR UPDATE", [req.user.userId]);
    if (found.rows.length === 0 || !found.rows[0].is_active) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Conta inativa" });
    }

    const credits = Number(found.rows[0].credits || 0);
    if (credits < wager) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    const won = autoCashoutAt < crashPoint;
    const payout = won ? Number((wager * autoCashoutAt).toFixed(2)) : 0;
    const newBalance = Number((credits - wager + payout).toFixed(2));

    await client.query("UPDATE users SET credits = $1, updated_at = NOW() WHERE id = $2", [newBalance, req.user.userId]);
    await client.query(
      "INSERT INTO credit_transactions (user_id, amount, reason, admin_user_id) VALUES ($1, $2, $3, $4)",
      [req.user.userId, -wager, "bet_wager", null]
    );
    if (payout > 0) {
      await client.query(
        "INSERT INTO credit_transactions (user_id, amount, reason, admin_user_id) VALUES ($1, $2, $3, $4)",
        [req.user.userId, payout, "bet_payout", null]
      );
    }
    await client.query("COMMIT");

    gameState.totalWagered += wager;
    gameState.totalPaidOut += payout;

    return res.json({
      won,
      payout,
      balance: newBalance,
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

app.post("/slot/spin", requireDatabase, requireAuth, requirePlayer, async (req, res) => {
  const wager = Number(req.body.wager);
  if (!Number.isFinite(wager) || wager < MIN_WAGER_PER_ROUND || wager > MAX_WAGER_PER_ROUND) {
    return res
      .status(400)
      .json({ error: `A aposta por rodada deve ser entre ${MIN_WAGER_PER_ROUND} e ${MAX_WAGER_PER_ROUND} créditos` });
  }

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT credits, is_active FROM users WHERE id = $1 FOR UPDATE", [req.user.userId]);
    if (found.rows.length === 0 || !found.rows[0].is_active) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Conta inativa" });
    }

    const credits = Number(found.rows[0].credits || 0);
    if (credits < wager) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    const forceLoss = shouldForceSlotLoss();
    const reels = generateSlotReels(forceLoss);
    const multiplier = getSlotMultiplier(reels);
    const payout = Number((wager * multiplier).toFixed(2));
    const newBalance = Number((credits - wager + payout).toFixed(2));

    await client.query("UPDATE users SET credits = $1, updated_at = NOW() WHERE id = $2", [newBalance, req.user.userId]);
    await client.query(
      "INSERT INTO credit_transactions (user_id, amount, reason, admin_user_id) VALUES ($1, $2, $3, $4)",
      [req.user.userId, -wager, "slot_wager", null]
    );
    if (payout > 0) {
      await client.query(
        "INSERT INTO credit_transactions (user_id, amount, reason, admin_user_id) VALUES ($1, $2, $3, $4)",
        [req.user.userId, payout, "slot_payout", null]
      );
    }
    await client.query("COMMIT");
    slotState.totalWagered += wager;
    slotState.totalPaidOut += payout;

    return res.json({
      reels,
      multiplier,
      payout,
      won: payout > 0,
      balance: newBalance
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Falha no giro do caça-níquel" });
  } finally {
    client.release();
  }
});

ensureDatabaseSchema()
  .then(async () => {
    const adminCount = await dbPool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
    if (adminCount.rows[0].count === 0) {
      console.warn("Nenhum admin cadastrado. Crie um admin via SQL ou endpoint /admin/users com token admin bootstrap.");
    }
    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Falha ao inicializar banco de dados:", error.message);
    process.exit(1);
  });
