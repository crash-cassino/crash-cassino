const canvas = document.getElementById("crashCanvas");
const ctx = canvas.getContext("2d");

const multiplierEl = document.getElementById("multiplier");
const roundStatusEl = document.getElementById("roundStatus");
const balanceLabel = document.getElementById("balanceLabel");
const roundModeLabel = document.getElementById("roundModeLabel");

const wagerInput = document.getElementById("wagerInput");
const autoCashoutInput = document.getElementById("autoCashoutInput");
const betButton = document.getElementById("betButton");
const cashoutButton = document.getElementById("cashoutButton");
const quickActionButtons = document.querySelectorAll(".chip-btn");

const state = {
  balance: 1000,
  inRound: false,
  crashed: false,
  round: null,
  path: [],
  multiplier: 1.0,
  hasSettled: false,
  explosionTTL: 0,
  streamerMode: false,
  visualIntensity: 1
};

const drawCfg = {
  margin: 56,
  maxVisibleMultiplier: 8,
  cssWidth: 960,
  cssHeight: 480
};

function formatMoney(value) {
  return value.toFixed(2);
}

function setStatus(text, color) {
  roundStatusEl.textContent = text;
  roundStatusEl.style.color = color || "#9ba7d4";
}

function resizeCanvasForViewport() {
  const parent = canvas.parentElement;
  const availableWidth = Math.max(300, Math.floor(parent.clientWidth - 2));
  const cssWidth = Math.min(960, availableWidth);
  const cssHeight = Math.max(260, Math.floor(cssWidth * 0.5));

  drawCfg.cssWidth = cssWidth;
  drawCfg.cssHeight = cssHeight;
  drawCfg.margin = cssWidth < 560 ? 30 : 56;

  canvas.style.height = `${cssHeight}px`;

  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resetRoundState() {
  state.inRound = false;
  state.crashed = false;
  state.round = null;
  state.path = [];
  state.multiplier = 1.0;
  state.hasSettled = false;
  cashoutButton.disabled = true;
  betButton.disabled = false;
  multiplierEl.textContent = "1.00x";
}

async function startRound() {
  const wager = Number(wagerInput.value);
  if (!Number.isFinite(wager) || wager <= 0) {
    setStatus("Aposta inválida", "#ff5a7d");
    return;
  }

  if (wager > state.balance) {
    setStatus("Saldo insuficiente", "#ff5a7d");
    return;
  }

  const autoCashoutAt = Number(autoCashoutInput.value);
  if (!Number.isFinite(autoCashoutAt) || autoCashoutAt < 1.01) {
    setStatus("Auto cashout deve ser >= 1.01x", "#ff5a7d");
    return;
  }

  try {
    betButton.disabled = true;
    setStatus("Iniciando rodada...", "#0fd7ff");

    const response = await fetch("/round/start", { method: "POST" });
    const round = await response.json();
    if (!response.ok) {
      throw new Error(round.error || "Falha ao iniciar rodada");
    }

    state.round = {
      ...round,
      wager,
      autoCashoutAt,
      startTime: performance.now()
    };
    state.inRound = true;
    state.crashed = false;
    state.hasSettled = false;
    state.explosionTTL = 0;
    state.path = [{ x: 0, y: 1 }];
    state.multiplier = 1.0;
    state.balance -= wager;
    balanceLabel.textContent = formatMoney(state.balance);
    roundModeLabel.textContent = round.mode;
    cashoutButton.disabled = false;

    setStatus("Rodada em andamento", "#0fd7ff");
  } catch (error) {
    setStatus(error.message, "#ff5a7d");
    betButton.disabled = false;
  }
}

async function settleBet(cashoutAt) {
  if (!state.round || state.hasSettled) {
    return;
  }

  state.hasSettled = true;
  cashoutButton.disabled = true;

  try {
    const response = await fetch("/bet/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wager: state.round.wager,
        autoCashoutAt: cashoutAt,
        crashPoint: state.round.crashPoint
      })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Falha ao liquidar aposta");
    }

    if (result.payout > 0) {
      state.balance += result.payout;
      setStatus(`Cashout em ${cashoutAt.toFixed(2)}x!`, "#18dc95");
    } else {
      setStatus(`Crash em ${result.crashPoint.toFixed(2)}x`, "#ff5a7d");
    }

    balanceLabel.textContent = formatMoney(state.balance);
  } catch (error) {
    state.hasSettled = false;
    cashoutButton.disabled = false;
    setStatus(error.message, "#ff5a7d");
  }
}

function getMultiplierFromElapsed(elapsedMs) {
  const seconds = elapsedMs / 1000;
  const growthRate = state.streamerMode ? 0.18 : 0.14;
  return Number((Math.exp(growthRate * seconds)).toFixed(2));
}

function updateRound(now) {
  if (!state.inRound || !state.round) {
    return;
  }

  const elapsed = now - state.round.startTime;
  const nextMultiplier = getMultiplierFromElapsed(elapsed);
  state.multiplier = nextMultiplier;
  multiplierEl.textContent = `${nextMultiplier.toFixed(2)}x`;

  const normalizedX = Math.min(elapsed / state.round.durationMs, 1);
  state.path.push({ x: normalizedX, y: nextMultiplier });

  if (!state.hasSettled && nextMultiplier >= state.round.autoCashoutAt) {
    settleBet(state.round.autoCashoutAt);
  }

  const shouldCrash = nextMultiplier >= state.round.crashPoint || elapsed >= state.round.durationMs;
  if (shouldCrash) {
    state.crashed = true;
    state.inRound = false;
    multiplierEl.textContent = `${state.round.crashPoint.toFixed(2)}x`;
    state.explosionTTL = 26;

    if (!state.hasSettled) {
      settleBet(state.round.autoCashoutAt);
    }

    setTimeout(() => {
      setStatus("Aguardando próxima aposta");
      resetRoundState();
    }, 1500);
  }
}

function drawGrid() {
  const width = drawCfg.cssWidth;
  const height = drawCfg.cssHeight;
  const stepX = 70;
  const stepY = 52;
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;

  for (let x = 0; x < width; x += stepX) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = 0; y < height; y += stepY) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawSceneGlow() {
  const grd = ctx.createLinearGradient(0, 0, 0, drawCfg.cssHeight);
  grd.addColorStop(0, "rgba(21, 35, 83, 0.16)");
  grd.addColorStop(1, "rgba(5, 8, 20, 0.30)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, drawCfg.cssWidth, drawCfg.cssHeight);
}

function toCanvasX(normalizedX) {
  return drawCfg.margin + normalizedX * (drawCfg.cssWidth - drawCfg.margin * 1.4);
}

function toCanvasY(multiplier) {
  const clamped = Math.min(multiplier, drawCfg.maxVisibleMultiplier);
  const normalized = (clamped - 1) / (drawCfg.maxVisibleMultiplier - 1);
  return drawCfg.cssHeight - drawCfg.margin - normalized * (drawCfg.cssHeight - drawCfg.margin * 1.6);
}

function drawPath() {
  if (state.path.length < 2) {
    return;
  }

  ctx.beginPath();
  const lineWidth = state.streamerMode ? 5 : 4;
  const glow = state.streamerMode ? 26 : 18;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = state.crashed ? "#ff5a7d" : "#0fd7ff";
  ctx.shadowColor = state.crashed ? "rgba(255,90,125,0.6)" : "rgba(15,215,255,0.6)";
  ctx.shadowBlur = glow * state.visualIntensity;

  state.path.forEach((point, index) => {
    const x = toCanvasX(point.x);
    const y = toCanvasY(point.y);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();
  ctx.shadowBlur = 0;

  const last = state.path[state.path.length - 1];
  const dotX = toCanvasX(last.x);
  const dotY = toCanvasY(last.y);
  ctx.fillStyle = state.crashed ? "#ff5a7d" : "#18dc95";
  ctx.beginPath();
  ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
  ctx.fill();

  if (!state.crashed) {
    drawRocket(dotX, dotY);
  }
}

function drawRocket(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#f2f5ff";
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(7, 6);
  ctx.lineTo(0, 2);
  ctx.lineTo(-7, 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#20ddff";
  ctx.beginPath();
  ctx.arc(0, -1, 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffb347";
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(3, 14);
  ctx.lineTo(-3, 14);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCrashExplosion() {
  if (state.explosionTTL <= 0 || state.path.length === 0) {
    return;
  }

  const last = state.path[state.path.length - 1];
  const x = toCanvasX(last.x);
  const y = toCanvasY(last.y);
  const frame = 26 - state.explosionTTL;
  const radius = 8 + frame * 3.2;

  ctx.save();
  ctx.globalAlpha = Math.max(0, state.explosionTTL / 26);
  ctx.strokeStyle = "rgba(255, 76, 117, 0.85)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 200, 60, 0.7)";
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  state.explosionTTL -= 1;
}

function render(now) {
  updateRound(now);

  ctx.clearRect(0, 0, drawCfg.cssWidth, drawCfg.cssHeight);
  drawSceneGlow();
  drawGrid();
  drawPath();
  drawCrashExplosion();

  requestAnimationFrame(render);
}

async function refreshStats() {
  try {
    const response = await fetch("/stats");
    const stats = await response.json();
    if (!response.ok) {
      throw new Error(stats.error || "Falha ao buscar estatísticas");
    }
    const cfg = stats.config || {};
    state.streamerMode = Boolean(cfg.streamerMode);
    state.visualIntensity = Number(cfg.visualIntensity || 1);
    if (state.streamerMode) {
      setStatus("Modo streamer ativo", "#20ddff");
    }
  } catch (error) {
    setStatus("Falha ao carregar stats", "#ff5a7d");
  }
}

quickActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const current = Number(wagerInput.value) || 1;
    const action = button.dataset.action;
    if (action === "half") {
      wagerInput.value = Math.max(1, Math.floor(current / 2));
    } else if (action === "double") {
      wagerInput.value = Math.min(Math.floor(state.balance), Math.max(1, current * 2));
    } else if (action === "min") {
      wagerInput.value = 1;
    } else if (action === "max") {
      wagerInput.value = Math.max(1, Math.floor(state.balance));
    }
  });
});

betButton.addEventListener("click", startRound);
cashoutButton.addEventListener("click", () => {
  if (!state.round) {
    return;
  }
  settleBet(state.multiplier);
});

window.addEventListener("resize", resizeCanvasForViewport);
resizeCanvasForViewport();
refreshStats();
setInterval(refreshStats, 3000);
requestAnimationFrame(render);
