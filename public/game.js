const statusText = document.getElementById("statusText");
const playerLabel = document.getElementById("playerLabel");
const balanceField = document.getElementById("balanceField");
const multiplierField = document.getElementById("multiplierField");
const roundHint = document.getElementById("roundHint");
const wagerInput = document.getElementById("wagerInput");
const autoCashoutInput = document.getElementById("autoCashoutInput");
const soundToggle = document.getElementById("soundToggle");
const effectsToggle = document.getElementById("effectsToggle");
const quickButtons = document.querySelectorAll(".quick-btn");
const chartCanvas = document.getElementById("chartCanvas");
const gamePanel = document.querySelector(".game-panel");
const chartCtx = chartCanvas.getContext("2d");
const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
let sharedAudioCtx = null;
let noiseBuffer = null;

const token = localStorage.getItem("crashUserToken") || "";
const minWager = 1;
const maxWager = 10;
const minAutoCashout = 3;
const bettingWindowMs = 2500;
const betweenRoundsMs = 1200;

const state = {
  balance: 0,
  phase: "idle",
  inRound: false,
  round: null,
  multiplier: 1,
  visualMultiplier: 1,
  hasBet: false,
  hasSettled: false,
  selectedWager: 0,
  selectedAutoCashout: minAutoCashout,
  path: [],
  particles: [],
  profileEmail: "",
  profileRole: "",
  soundEnabled: true,
  effectsEnabled: true,
  roundStartAt: 0,
  nextRoundTimeout: null,
  bettingTimeout: null,
  roundNoise: {
    seedA: Math.random() * Math.PI * 2,
    seedB: Math.random() * Math.PI * 2,
    amplitude: 0.03,
    drift: 0,
    burstAt: 1.2,
    burstWidth: 0.45,
    burstStrength: 0
  }
};

const drawCfg = {
  cssWidth: 960,
  cssHeight: 420,
  margin: 46
};

function setStatus(message, color) {
  statusText.textContent = message;
  statusText.style.color = color || "#eff4ff";
}

function setRoundHint(message) {
  if (roundHint) {
    roundHint.textContent = message;
  }
}

function applyPhaseUi() {
  document.body.dataset.phase = state.phase;
  if (gamePanel) {
    gamePanel.dataset.phase = state.phase;
  }
}

function setPhase(phase) {
  state.phase = phase;
  applyPhaseUi();
}

function authHeaders(extra) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`
  };
}

function redirectLogin() {
  localStorage.removeItem("crashUserToken");
  window.location.href = "/";
}

function updateBalanceLabel() {
  balanceField.textContent = state.balance.toFixed(2);
}

function normalizeWager(value) {
  if (!Number.isFinite(value)) return minWager;
  return Math.min(maxWager, Math.max(minWager, Math.floor(value)));
}

function normalizeAutoCashout(value) {
  if (!Number.isFinite(value)) return minAutoCashout;
  return Math.max(minAutoCashout, Number(value.toFixed(2)));
}

function resizeCanvas() {
  const width = Math.max(320, Math.floor(chartCanvas.parentElement.clientWidth - 2));
  const height = Math.max(260, Math.floor(width * 0.44));
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  drawCfg.cssWidth = width;
  drawCfg.cssHeight = height;
  drawCfg.margin = width < 540 ? 26 : 46;
  chartCanvas.width = Math.floor(width * dpr);
  chartCanvas.height = Math.floor(height * dpr);
  chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function getMultiplier(elapsedMs) {
  const seconds = elapsedMs / 1000;
  const growthRate = state.round && Number.isFinite(Number(state.round.growthRate)) ? Number(state.round.growthRate) : 0.11;
  return Number(Math.max(1, Math.exp(growthRate * seconds)).toFixed(2));
}

function getVisualMultiplier(logicalMultiplier, elapsedMs) {
  const seconds = elapsedMs / 1000;
  const waveA = Math.sin(seconds * 4.2 + state.roundNoise.seedA) * state.roundNoise.amplitude;
  const waveB = Math.cos(seconds * 2.5 + state.roundNoise.seedB) * (state.roundNoise.amplitude * 0.55);
  const waveC = Math.sin(seconds * 6.8 + state.roundNoise.seedA * 0.7) * (state.roundNoise.amplitude * 0.25);
  const driftEffect = state.roundNoise.drift * seconds;
  const burstDistance = seconds - state.roundNoise.burstAt;
  const burst = Math.exp(-(burstDistance * burstDistance) / (2 * state.roundNoise.burstWidth * state.roundNoise.burstWidth));
  const burstEffect = burst * state.roundNoise.burstStrength;
  const visualNoise = 1 + waveA + waveB + waveC + driftEffect + burstEffect;
  const boosted = logicalMultiplier * visualNoise;
  const clamped = Math.max(1, Math.min(boosted, logicalMultiplier * 1.08));
  return Number(clamped.toFixed(2));
}

function toCanvasX(normalizedX) {
  return drawCfg.margin + normalizedX * (drawCfg.cssWidth - drawCfg.margin * 1.5);
}

function toCanvasY(multiplier) {
  const maxVisible = 8;
  const clamped = Math.min(multiplier, maxVisible);
  const normalized = (clamped - 1) / (maxVisible - 1);
  return drawCfg.cssHeight - drawCfg.margin - normalized * (drawCfg.cssHeight - drawCfg.margin * 1.6);
}

function drawChart() {
  chartCtx.clearRect(0, 0, drawCfg.cssWidth, drawCfg.cssHeight);
  chartCtx.fillStyle = "rgba(9, 14, 35, 0.9)";
  chartCtx.fillRect(0, 0, drawCfg.cssWidth, drawCfg.cssHeight);

  chartCtx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let x = 0; x < drawCfg.cssWidth; x += 70) {
    chartCtx.beginPath();
    chartCtx.moveTo(x, 0);
    chartCtx.lineTo(x, drawCfg.cssHeight);
    chartCtx.stroke();
  }
  for (let y = 0; y < drawCfg.cssHeight; y += 55) {
    chartCtx.beginPath();
    chartCtx.moveTo(0, y);
    chartCtx.lineTo(drawCfg.cssWidth, y);
    chartCtx.stroke();
  }

  if (state.path.length >= 2) {
    chartCtx.beginPath();
    chartCtx.lineWidth = 4;
    chartCtx.strokeStyle = state.inRound ? "#1bddff" : "#ff5a83";
    chartCtx.shadowColor = state.inRound ? "rgba(27, 221, 255, 0.6)" : "rgba(255, 90, 131, 0.6)";
    chartCtx.shadowBlur = 18;

    state.path.forEach((point, index) => {
      const x = toCanvasX(point.x);
      const y = toCanvasY(point.y);
      if (index === 0) chartCtx.moveTo(x, y);
      else chartCtx.lineTo(x, y);
    });
    chartCtx.stroke();
    chartCtx.shadowBlur = 0;

    const last = state.path[state.path.length - 1];
    const prev = state.path.length >= 2 ? state.path[state.path.length - 2] : last;
    const lastX = toCanvasX(last.x);
    const lastY = toCanvasY(last.y);
    const prevX = toCanvasX(prev.x);
    const prevY = toCanvasY(prev.y);
    const rocketAngle = Math.atan2(lastY - prevY, lastX - prevX) + Math.PI / 2;
    chartCtx.fillStyle = state.inRound ? "#1ecf8d" : "#ff5a83";
    chartCtx.beginPath();
    chartCtx.arc(lastX, lastY, 6, 0, Math.PI * 2);
    chartCtx.fill();

    if (state.inRound) {
      drawRocket(lastX, lastY, rocketAngle);
    }
  }

  drawParticles();
}

function drawRocket(x, y, angleRadians) {
  chartCtx.save();
  chartCtx.translate(x, y);
  chartCtx.rotate(angleRadians);
  chartCtx.fillStyle = "#f5f8ff";
  chartCtx.beginPath();
  chartCtx.moveTo(0, -10);
  chartCtx.lineTo(7, 6);
  chartCtx.lineTo(0, 3);
  chartCtx.lineTo(-7, 6);
  chartCtx.closePath();
  chartCtx.fill();
  chartCtx.fillStyle = "#1bddff";
  chartCtx.beginPath();
  chartCtx.arc(0, -1, 2.4, 0, Math.PI * 2);
  chartCtx.fill();
  chartCtx.fillStyle = "#ffb347";
  chartCtx.beginPath();
  chartCtx.moveTo(0, 6);
  chartCtx.lineTo(3, 13);
  chartCtx.lineTo(-3, 13);
  chartCtx.closePath();
  chartCtx.fill();
  chartCtx.restore();
}

function createCrashParticles() {
  if (!state.effectsEnabled || state.path.length === 0) return;
  const last = state.path[state.path.length - 1];
  const x = toCanvasX(last.x);
  const y = toCanvasY(last.y);
  state.particles = Array.from({ length: 26 }).map(() => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3.2;
    return { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 34, ttl: 34 };
  });
}

function drawParticles() {
  if (!state.particles.length) return;
  state.particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.04;
    p.ttl -= 1;
    const alpha = Math.max(0, p.ttl / p.life);
    chartCtx.fillStyle = `rgba(255, 120, 70, ${alpha})`;
    chartCtx.beginPath();
    chartCtx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    chartCtx.fill();
  });
  state.particles = state.particles.filter((p) => p.ttl > 0);
}

function playSound(type) {
  if (!state.soundEnabled || !AudioCtxClass) return;
  if (!sharedAudioCtx) sharedAudioCtx = new AudioCtxClass();
  const ctx = sharedAudioCtx;
  if (ctx.state === "suspended") return;

  if (type === "launch") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.38);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
    if (!noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 0.45);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    return;
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type === "cashout" ? "triangle" : "square";
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  if (type === "cashout") {
    osc.frequency.setValueAtTime(460, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(860, ctx.currentTime + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.11, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.23);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  } else {
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.38);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }
}

async function unlockAudio() {
  if (!AudioCtxClass) return;
  if (!sharedAudioCtx) sharedAudioCtx = new AudioCtxClass();
  if (sharedAudioCtx.state === "suspended") {
    try {
      await sharedAudioCtx.resume();
    } catch (error) {
      // ignore
    }
  }
}

async function fetchMe() {
  if (!token) {
    redirectLogin();
    return false;
  }
  try {
    const response = await fetch("/auth/me", { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok || data.role !== "player") throw new Error("Sessão inválida");
    state.balance = Number(data.credits || 0);
    state.profileEmail = data.email;
    state.profileRole = data.role;
    playerLabel.textContent = `${data.email} (${data.role})`;
    updateBalanceLabel();
    return true;
  } catch (error) {
    redirectLogin();
    return false;
  }
}

async function settle(cashoutAt) {
  if (!state.round || state.hasSettled || !state.hasBet) return false;
  state.hasSettled = true;
  const roundRef = state.round;
  try {
    const response = await fetch("/bet/settle", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        wager: state.selectedWager,
        autoCashoutAt: cashoutAt,
        crashPoint: roundRef.crashPoint
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha no cashout");
    state.balance = Number(data.balance || state.balance);
    updateBalanceLabel();
    if (data.won) {
      playSound("cashout");
      setStatus(`Cashout com sucesso em ${Number(cashoutAt).toFixed(2)}x`, "#1ecf8d");
    } else {
      playSound("crash");
      createCrashParticles();
      setStatus("Rodada perdida", "#ff5a83");
    }
    return true;
  } catch (error) {
    setStatus(error.message, "#ff5a83");
    return false;
  }
}

function clearTimers() {
  if (state.bettingTimeout) clearTimeout(state.bettingTimeout);
  if (state.nextRoundTimeout) clearTimeout(state.nextRoundTimeout);
  state.bettingTimeout = null;
  state.nextRoundTimeout = null;
}

function scheduleNextRound(delayMs = betweenRoundsMs) {
  clearTimers();
  state.nextRoundTimeout = setTimeout(() => {
    startBettingPhase();
  }, delayMs);
}

async function startBettingPhase() {
  setPhase("betting");
  state.inRound = false;
  state.hasBet = false;
  state.hasSettled = false;
  state.selectedWager = 0;
  state.selectedAutoCashout = normalizeAutoCashout(Number(autoCashoutInput.value));
  autoCashoutInput.value = state.selectedAutoCashout.toFixed(2);
  multiplierField.textContent = "1.00x";
  setRoundHint("Clique no canvas para apostar");
  setStatus("Nova rodada em breve. Clique no canvas para entrar.", "#1bddff");
  try {
    const response = await fetch("/round/start", { method: "POST", headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao preparar rodada");
    state.round = data;
    state.path = [{ x: 0, y: 1 }];
    state.bettingTimeout = setTimeout(() => {
      launchRound();
    }, bettingWindowMs);
  } catch (error) {
    setStatus(error.message, "#ff5a83");
    scheduleNextRound(1800);
  }
}

function launchRound() {
  if (!state.round) {
    scheduleNextRound(900);
    return;
  }
  setPhase("running");
  state.inRound = true;
  state.roundStartAt = performance.now();
  state.multiplier = 1;
  state.visualMultiplier = 1;
  state.roundNoise = {
    seedA: Math.random() * Math.PI * 2,
    seedB: Math.random() * Math.PI * 2,
    amplitude: 0.02 + Math.random() * 0.055,
    drift: (Math.random() - 0.5) * 0.012,
    burstAt: 0.8 + Math.random() * 2.0,
    burstWidth: 0.25 + Math.random() * 0.55,
    burstStrength: (Math.random() - 0.25) * 0.06
  };
  setRoundHint(state.hasBet ? "Clique no canvas para cashout manual" : "Rodada em andamento");
  setStatus(state.hasBet ? "Voando! Clique no canvas para sacar." : "Rodada sem aposta ativa.", "#cdd8ff");
  playSound("launch");
}

async function endRunningRound() {
  state.inRound = false;
  setPhase("settling");
  state.round = null;
  setRoundHint("Preparando próxima rodada...");
  scheduleNextRound();
}

async function handleCanvasClick() {
  await unlockAudio();
  if (state.phase === "betting") {
    const wager = normalizeWager(Number(wagerInput.value));
    const autoCashout = normalizeAutoCashout(Number(autoCashoutInput.value));
    wagerInput.value = String(wager);
    autoCashoutInput.value = autoCashout.toFixed(2);
    if (wager > state.balance) {
      setStatus("Saldo insuficiente para essa aposta", "#ff5a83");
      return;
    }
    state.hasBet = true;
    state.selectedWager = wager;
    state.selectedAutoCashout = autoCashout;
    setStatus(`Aposta confirmada: ${wager.toFixed(2)} | Auto: ${autoCashout.toFixed(2)}x`, "#1ecf8d");
    setRoundHint("Aposta confirmada para a próxima decolagem");
    return;
  }

  if (state.phase === "running" && state.hasBet && !state.hasSettled) {
    await settle(state.multiplier);
    await endRunningRound();
  }
}

function runRoundLoop() {
  if (state.inRound && state.round) {
    const elapsed = performance.now() - state.roundStartAt;
    state.multiplier = getMultiplier(elapsed);
    state.visualMultiplier = getVisualMultiplier(state.multiplier, elapsed);
    multiplierField.textContent = `${state.multiplier.toFixed(2)}x`;
    state.path.push({
      x: Math.min(elapsed / state.round.durationMs, 1),
      y: state.visualMultiplier
    });

    if (state.hasBet && !state.hasSettled && state.multiplier >= state.selectedAutoCashout) {
      settle(state.selectedAutoCashout).then(endRunningRound);
    } else if (state.multiplier >= state.round.crashPoint || elapsed >= state.round.durationMs) {
      if (state.hasBet && !state.hasSettled) {
        settle(state.selectedAutoCashout).then(endRunningRound);
      } else {
        playSound("crash");
        createCrashParticles();
        setStatus("Rodada encerrada. Próxima em instantes.", "#9bb0f0");
        endRunningRound();
      }
    }
  }

  drawChart();
  requestAnimationFrame(runRoundLoop);
}

quickButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const current = normalizeWager(Number(wagerInput.value) || minWager);
    const action = button.dataset.action;
    if (action === "half") wagerInput.value = String(normalizeWager(Math.floor(current / 2)));
    else if (action === "double") wagerInput.value = String(normalizeWager(current * 2));
    else if (action === "min") wagerInput.value = String(minWager);
    else if (action === "max") wagerInput.value = String(maxWager);
  });
});

wagerInput.addEventListener("input", () => {
  wagerInput.value = String(normalizeWager(Number(wagerInput.value)));
});

autoCashoutInput.addEventListener("input", () => {
  autoCashoutInput.value = normalizeAutoCashout(Number(autoCashoutInput.value)).toFixed(2);
});

soundToggle.addEventListener("change", () => {
  state.soundEnabled = soundToggle.checked;
  if (state.soundEnabled) unlockAudio();
});

effectsToggle.addEventListener("change", () => {
  state.effectsEnabled = effectsToggle.checked;
  if (!state.effectsEnabled) state.particles = [];
});

chartCanvas.addEventListener("click", handleCanvasClick);

window.addEventListener("resize", () => {
  resizeCanvas();
});

document.addEventListener(
  "pointerdown",
  () => {
    if (state.soundEnabled) unlockAudio();
  },
  { once: true }
);

resizeCanvas();
applyPhaseUi();
runRoundLoop();
fetchMe().then((ok) => {
  if (ok) {
    setStatus("Sessão ativa. Aguardando rodada contínua...", "#1ecf8d");
    startBettingPhase();
  }
});
