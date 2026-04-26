const express = require("express");
const crypto = require("crypto");
const dotenv = require("dotenv");
const path = require("path");

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

const state = {
  totalWagered: 0,
  totalPaidOut: 0,
  rounds: 0,
  instantCrashes: 0,
  history: []
};

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

app.get("/api", (req, res) => {
  res.json({
    message: "Crash backend online",
    docs: {
      health: "GET /health",
      stats: "GET /stats",
      startRound: "POST /round/start",
      settleBet: "POST /bet/settle"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "crash-backend" });
});

app.post("/round/start", (req, res) => {
  const round = createRound();
  res.json(round);
});

app.post("/bet/settle", (req, res) => {
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

  state.totalWagered += numericWager;

  const won = numericAutoCashoutAt < numericCrashPoint;
  const payout = won ? Number((numericWager * numericAutoCashoutAt).toFixed(2)) : 0;
  state.totalPaidOut += payout;

  return res.json({
    won,
    wager: numericWager,
    autoCashoutAt: numericAutoCashoutAt,
    crashPoint: numericCrashPoint,
    payout,
    houseProfit: Number(calculateCurrentProfit().toFixed(2)),
    profitMargin: Number(calculateCurrentMargin().toFixed(4))
  });
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

app.listen(PORT, () => {
  console.log(`Crash backend rodando em http://localhost:${PORT}`);
});
