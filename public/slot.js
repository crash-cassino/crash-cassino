const statusText = document.getElementById("statusText");
const creditsField = document.getElementById("creditsField");
const wagerInput = document.getElementById("wagerInput");
const spinButton = document.getElementById("spinButton");
const reelEls = [
  document.getElementById("reel1"),
  document.getElementById("reel2"),
  document.getElementById("reel3")
];

const token = localStorage.getItem("crashUserToken") || "";
const symbols = {
  cherry: "🍒",
  lemon: "🍋",
  bell: "🔔",
  seven: "7️⃣",
  diamond: "💎"
};

const spinner = ["🍒", "🍋", "🔔", "7️⃣", "💎"];
let spinInterval = null;

function setStatus(message, color) {
  statusText.textContent = message;
  statusText.style.color = color || "#9ca9d8";
}

function redirectLogin() {
  localStorage.removeItem("crashUserToken");
  window.location.href = "/";
}

function headers(extra) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`
  };
}

async function loadMe() {
  if (!token) {
    redirectLogin();
    return false;
  }
  try {
    const response = await fetch("/auth/me", { headers: headers() });
    const data = await response.json();
    if (!response.ok || data.role !== "player") {
      throw new Error(data.error || "Sessão inválida");
    }
    creditsField.textContent = Number(data.credits).toFixed(2);
    setStatus("Pronto para girar");
    return true;
  } catch (error) {
    setStatus(error.message, "#ff5d82");
    setTimeout(redirectLogin, 900);
    return false;
  }
}

function startVisualSpin() {
  spinInterval = setInterval(() => {
    reelEls.forEach((el) => {
      const symbol = spinner[Math.floor(Math.random() * spinner.length)];
      el.textContent = symbol;
    });
  }, 80);
}

function stopVisualSpin(finalReels) {
  if (spinInterval) {
    clearInterval(spinInterval);
    spinInterval = null;
  }
  reelEls.forEach((el, index) => {
    const key = finalReels[index];
    el.textContent = symbols[key] || "❔";
  });
}

async function spin() {
  const wager = Number(wagerInput.value);
  if (!Number.isFinite(wager) || wager <= 0) {
    setStatus("Aposta inválida", "#ff5d82");
    return;
  }
  spinButton.disabled = true;
  setStatus("Girando...", "#20ddff");
  startVisualSpin();

  try {
    const response = await fetch("/slot/spin", {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ wager })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha no giro");
    }

    setTimeout(() => {
      stopVisualSpin(data.reels || []);
      creditsField.textContent = Number(data.balance || 0).toFixed(2);
      if (data.won) {
        setStatus(`Ganhou! x${Number(data.multiplier).toFixed(2)} - +${Number(data.payout).toFixed(2)} créditos`, "#1fcd8b");
      } else {
        setStatus("Não foi dessa vez", "#ff5d82");
      }
      spinButton.disabled = false;
    }, 900);
  } catch (error) {
    stopVisualSpin([]);
    setStatus(error.message, "#ff5d82");
    spinButton.disabled = false;
  }
}

spinButton.addEventListener("click", spin);
loadMe();
