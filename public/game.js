const statusText = document.getElementById("statusText");
const playerLabel = document.getElementById("playerLabel");
const balanceField = document.getElementById("balanceField");
const multiplierField = document.getElementById("multiplierField");
const targetCrashLabel = document.getElementById("targetCrashLabel");
const wagerInput = document.getElementById("wagerInput");
const autoCashoutInput = document.getElementById("autoCashoutInput");
const soundToggle = document.getElementById("soundToggle");
const effectsToggle = document.getElementById("effectsToggle");
const startRoundButton = document.getElementById("startRoundButton");
const cashoutButton = document.getElementById("cashoutButton");
const quickButtons = document.querySelectorAll(".quick-btn");
const chartCanvas = document.getElementById("chartCanvas");
const chartCtx = chartCanvas.getContext("2d");
const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
let sharedAudioCtx = null;

const token = localStorage.getItem("crashUserToken") || "";

const state = {
  balance: 0,
  inRound: false,
  round: null,
  multiplier: 1,
  lastMultiplier: 1,
  hasSettled: false,
  path: [],
  particles: [],
  profileEmail: "",
  profileRole: "",
  soundEnabled: true,
  effectsEnabled: true,
  roundNoise: {
    seedA: Math.random() * Math.PI * 2,
    seedB: Math.random() * Math.PI * 2,
    amplitude: 0.03
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
  const base = Math.exp(0.14 * seconds);
  const waveA = Math.sin(seconds * 4.2 + state.roundNoise.seedA) * state.roundNoise.amplitude;
  const waveB = Math.cos(seconds * 2.5 + state.roundNoise.seedB) * (state.roundNoise.amplitude * 0.6);
  const noisy = Math.max(1.0, base * (1 + waveA + waveB));
  const stable = Math.max(state.lastMultiplier + 0.01, noisy);
  return Number(stable.toFixed(2));
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

  if (state.path.length < 2) {
    return;
  }

  chartCtx.beginPath();
  chartCtx.lineWidth = 4;
  chartCtx.strokeStyle = state.inRound ? "#1bddff" : "#ff5a83";
  chartCtx.shadowColor = state.inRound ? "rgba(27, 221, 255, 0.6)" : "rgba(255, 90, 131, 0.6)";
  chartCtx.shadowBlur = 18;

  state.path.forEach((point, index) => {
    const x = toCanvasX(point.x);
    const y = toCanvasY(point.y);
    if (index === 0) {
      chartCtx.moveTo(x, y);
    } else {
      chartCtx.lineTo(x, y);
    }
  });
  chartCtx.stroke();
  chartCtx.shadowBlur = 0;

  const last = state.path[state.path.length - 1];
  const lastX = toCanvasX(last.x);
  const lastY = toCanvasY(last.y);
  chartCtx.fillStyle = state.inRound ? "#1ecf8d" : "#ff5a83";
  chartCtx.beginPath();
  chartCtx.arc(lastX, lastY, 6, 0, Math.PI * 2);
  chartCtx.fill();

  if (state.inRound) {
    drawRocket(lastX, lastY);
  }

  drawParticles();
}

function drawRocket(x, y) {
  chartCtx.save();
  chartCtx.translate(x, y);
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
  if (!state.effectsEnabled) return;
  if (state.path.length === 0) return;
  const last = state.path[state.path.length - 1];
  const x = toCanvasX(last.x);
  const y = toCanvasY(last.y);
  state.particles = Array.from({ length: 26 }).map(() => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3.2;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 28 + Math.floor(Math.random() * 18),
      ttl: 28 + Math.floor(Math.random() * 18)
    };
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
  if (!state.soundEnabled) return;
  if (!AudioCtxClass) return;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtxClass();
  }
  const ctx = sharedAudioCtx;
  if (ctx.state === "suspended") {
    return;
  }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.value = 0.0001;
  if (type === "launch") {
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.18);
  } else if (type === "cashout") {
    osc.frequency.setValueAtTime(380, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(620, ctx.currentTime + 0.15);
  } else {
    osc.frequency.setValueAtTime(260, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.22);
  }
  gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.24);
  osc.start();
  osc.stop(ctx.currentTime + 0.26);
}

async function unlockAudio() {
  if (!AudioCtxClass) return;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtxClass();
  }
  if (sharedAudioCtx.state === "suspended") {
    try {
      await sharedAudioCtx.resume();
    } catch (error) {
      // Ignore browser resume errors; user can still retry by interacting.
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
    if (!response.ok) {
      throw new Error(data.error || "Sessão inválida");
    }
    if (data.role !== "player") {
      redirectLogin();
      return false;
    }
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
  if (!state.round || state.hasSettled) return;
  state.hasSettled = true;
  const roundRef = state.round;
  try {
    const response = await fetch("/bet/settle", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        wager: Number(wagerInput.value),
        autoCashoutAt: cashoutAt,
        crashPoint: roundRef.crashPoint
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha no cashout");
    }
    state.balance = Number(data.balance || state.balance);
    updateBalanceLabel();
    const finalMultiplier = Number(roundRef.crashPoint || state.multiplier);
    multiplierField.textContent = `${finalMultiplier.toFixed(2)}x`;
    if (data.won) {
      playSound("cashout");
    } else {
      playSound("crash");
      createCrashParticles();
    }
    setStatus(data.won ? "Vitoria na rodada" : "Rodada perdida", data.won ? "#1ecf8d" : "#ff5a83");
  } catch (error) {
    setStatus(error.message, "#ff5a83");
  } finally {
    state.inRound = false;
    cashoutButton.disabled = true;
    startRoundButton.disabled = false;
    state.round = null;
  }
}

function runRoundLoop(startTime) {
  if (!state.inRound || !state.round) {
    drawChart();
    return;
  }

  const elapsed = performance.now() - startTime;
  state.multiplier = getMultiplier(elapsed);
  state.lastMultiplier = state.multiplier;
  multiplierField.textContent = `${state.multiplier.toFixed(2)}x`;
  state.path.push({
    x: Math.min(elapsed / state.round.durationMs, 1),
    y: state.multiplier
  });
  drawChart();

  const autoCashoutTarget = Number(autoCashoutInput.value);
  if (!state.hasSettled && state.multiplier >= autoCashoutTarget) {
    settle(autoCashoutTarget);
    return;
  }
  if (!state.hasSettled && (state.multiplier >= state.round.crashPoint || elapsed >= state.round.durationMs)) {
    settle(autoCashoutTarget);
    return;
  }

  requestAnimationFrame(() => runRoundLoop(startTime));
}

function animate() {
  drawChart();
  requestAnimationFrame(animate);
}

async function startRound() {
  await unlockAudio();
  if (state.inRound) return;
  const wager = Number(wagerInput.value);
  if (!Number.isFinite(wager) || wager <= 0) {
    setStatus("Aposta inválida", "#ff5a83");
    return;
  }
  if (wager > state.balance) {
    setStatus("Saldo insuficiente", "#ff5a83");
    return;
  }
  try {
    setStatus("Iniciando rodada...", "#1bddff");
    startRoundButton.disabled = true;
    const response = await fetch("/round/start", {
      method: "POST",
      headers: authHeaders()
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha ao iniciar rodada");
    }
    state.round = data;
    state.inRound = true;
    state.hasSettled = false;
    state.roundNoise = {
      seedA: Math.random() * Math.PI * 2,
      seedB: Math.random() * Math.PI * 2,
      amplitude: 0.02 + Math.random() * 0.05
    };
    state.path = [{ x: 0, y: 1 }];
    state.multiplier = 1;
    state.lastMultiplier = 1;
    targetCrashLabel.textContent = `${Number(data.crashPoint).toFixed(2)}x`;
    cashoutButton.disabled = false;
    setStatus("Rodada em andamento", "#1bddff");
    playSound("launch");
    runRoundLoop(performance.now());
  } catch (error) {
    startRoundButton.disabled = false;
    setStatus(error.message, "#ff5a83");
  }
}

cashoutButton.addEventListener("click", () => settle(state.multiplier));
startRoundButton.addEventListener("click", startRound);

quickButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const current = Number(wagerInput.value) || 1;
    const action = button.dataset.action;
    if (action === "half") {
      wagerInput.value = Math.max(1, Math.floor(current / 2));
    } else if (action === "double") {
      wagerInput.value = Math.max(1, Math.min(Math.floor(state.balance), current * 2));
    } else if (action === "min") {
      wagerInput.value = 1;
    } else if (action === "max") {
      wagerInput.value = Math.max(1, Math.floor(state.balance));
    }
  });
});

soundToggle.addEventListener("change", () => {
  state.soundEnabled = soundToggle.checked;
  if (state.soundEnabled) {
    unlockAudio();
  }
});
effectsToggle.addEventListener("change", () => {
  state.effectsEnabled = effectsToggle.checked;
  if (!state.effectsEnabled) {
    state.particles = [];
  }
});

window.addEventListener("resize", () => {
  resizeCanvas();
});

resizeCanvas();
animate();
fetchMe().then((ok) => {
  if (ok) {
    setStatus("Sessão ativa. Boa sorte!", "#1ecf8d");
  }
});

document.addEventListener(
  "pointerdown",
  () => {
    if (state.soundEnabled) {
      unlockAudio();
    }
  },
  { once: true }
);
