const statusText = document.getElementById("statusText");
const balanceField = document.getElementById("balanceField");
const multiplierField = document.getElementById("multiplierField");
const wagerInput = document.getElementById("wagerInput");
const autoCashoutInput = document.getElementById("autoCashoutInput");
const startRoundButton = document.getElementById("startRoundButton");
const cashoutButton = document.getElementById("cashoutButton");

const token = localStorage.getItem("crashUserToken") || "";

const state = {
  balance: 0,
  inRound: false,
  round: null,
  multiplier: 1
};

function setStatus(message, color) {
  statusText.textContent = message;
  statusText.style.color = color || "#9ca9d8";
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
    balanceField.value = state.balance.toFixed(2);
    return true;
  } catch (error) {
    redirectLogin();
    return false;
  }
}

function getMultiplier(elapsedMs) {
  const seconds = elapsedMs / 1000;
  return Number(Math.exp(0.14 * seconds).toFixed(2));
}

async function settle(cashoutAt) {
  if (!state.round) return;
  try {
    const response = await fetch("/bet/settle", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        wager: Number(wagerInput.value),
        autoCashoutAt: cashoutAt,
        crashPoint: state.round.crashPoint
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha no cashout");
    }
    state.balance = Number(data.balance || state.balance);
    balanceField.value = state.balance.toFixed(2);
    multiplierField.value = `${state.round.crashPoint.toFixed(2)}x`;
    setStatus(data.won ? "Vitoria na rodada" : "Rodada perdida", data.won ? "#1fcd8b" : "#ff5d82");
  } catch (error) {
    setStatus(error.message, "#ff5d82");
  } finally {
    state.inRound = false;
    cashoutButton.disabled = true;
    startRoundButton.disabled = false;
    state.round = null;
  }
}

function runRoundLoop(startTime) {
  if (!state.inRound || !state.round) {
    return;
  }
  const elapsed = performance.now() - startTime;
  state.multiplier = getMultiplier(elapsed);
  multiplierField.value = `${state.multiplier.toFixed(2)}x`;

  if (state.multiplier >= state.round.crashPoint || elapsed >= state.round.durationMs) {
    settle(Number(autoCashoutInput.value));
    return;
  }
  if (state.multiplier >= Number(autoCashoutInput.value)) {
    settle(Number(autoCashoutInput.value));
    return;
  }
  requestAnimationFrame(() => runRoundLoop(startTime));
}

async function startRound() {
  const wager = Number(wagerInput.value);
  if (!Number.isFinite(wager) || wager <= 0) {
    setStatus("Aposta inválida", "#ff5d82");
    return;
  }
  if (wager > state.balance) {
    setStatus("Saldo insuficiente", "#ff5d82");
    return;
  }
  try {
    setStatus("Iniciando rodada...", "#20ddff");
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
    cashoutButton.disabled = false;
    runRoundLoop(performance.now());
  } catch (error) {
    startRoundButton.disabled = false;
    setStatus(error.message, "#ff5d82");
  }
}

cashoutButton.addEventListener("click", () => {
  if (!state.inRound) return;
  settle(state.multiplier);
});
startRoundButton.addEventListener("click", startRound);

fetchMe().then((ok) => {
  if (ok) {
    setStatus("Sessão do jogador ativa", "#1fcd8b");
  }
});
