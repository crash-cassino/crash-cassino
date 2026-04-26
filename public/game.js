const statusText = document.getElementById("statusText");
const playerLabel = document.getElementById("playerLabel");
const balanceField = document.getElementById("balanceField");
const multiplierField = document.getElementById("multiplierField");
const targetCrashLabel = document.getElementById("targetCrashLabel");
const historyList = document.getElementById("historyList");
const wagerInput = document.getElementById("wagerInput");
const autoCashoutInput = document.getElementById("autoCashoutInput");
const startRoundButton = document.getElementById("startRoundButton");
const cashoutButton = document.getElementById("cashoutButton");
const quickButtons = document.querySelectorAll(".quick-btn");
const chartCanvas = document.getElementById("chartCanvas");
const chartCtx = chartCanvas.getContext("2d");

const token = localStorage.getItem("crashUserToken") || "";

const state = {
  balance: 0,
  inRound: false,
  round: null,
  multiplier: 1,
  hasSettled: false,
  path: [],
  history: [],
  profileEmail: "",
  profileRole: ""
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

function renderHistory() {
  historyList.innerHTML = "";
  state.history.slice(0, 16).forEach((item) => {
    const pill = document.createElement("span");
    pill.className = `history-pill ${item.won ? "win" : "loss"}`;
    pill.textContent = `${item.multiplier.toFixed(2)}x`;
    historyList.appendChild(pill);
  });
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
  return Number(Math.exp(0.14 * seconds).toFixed(2));
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
  chartCtx.fillStyle = state.inRound ? "#1ecf8d" : "#ff5a83";
  chartCtx.beginPath();
  chartCtx.arc(toCanvasX(last.x), toCanvasY(last.y), 6, 0, Math.PI * 2);
  chartCtx.fill();
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
    state.history.unshift({ multiplier: finalMultiplier, won: Boolean(data.won) });
    renderHistory();
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

async function startRound() {
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
    state.path = [{ x: 0, y: 1 }];
    state.multiplier = 1;
    targetCrashLabel.textContent = `${Number(data.crashPoint).toFixed(2)}x`;
    cashoutButton.disabled = false;
    setStatus("Rodada em andamento", "#1bddff");
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

window.addEventListener("resize", () => {
  resizeCanvas();
  drawChart();
});

resizeCanvas();
drawChart();
fetchMe().then((ok) => {
  if (ok) {
    setStatus("Sessão ativa. Boa sorte!", "#1ecf8d");
  }
});
