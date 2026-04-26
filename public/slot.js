const statusText = document.getElementById("statusText");
const creditsField = document.getElementById("creditsField");
const wagerInput = document.getElementById("wagerInput");
const wagerMinus = document.getElementById("wagerMinus");
const wagerPlus = document.getElementById("wagerPlus");
const spinButton = document.getElementById("spinButton");
const reelEls = [
  document.getElementById("reel1"),
  document.getElementById("reel2"),
  document.getElementById("reel3")
];

const token = localStorage.getItem("crashUserToken") || "";
const minWager = 1;
const maxWager = 10;
const symbols = {
  cherry: "🍒",
  lemon: "🍋",
  bell: "🔔",
  seven: "7️⃣",
  diamond: "💎"
};

const spinner = ["🍒", "🍋", "🔔", "7️⃣", "💎"];
let spinInterval = null;
const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function setStatus(message, color) {
  statusText.textContent = message;
  statusText.style.color = color || "#9ca9d8";
}

async function unlockAudio() {
  if (!AudioCtxClass) return;
  if (!audioCtx) {
    audioCtx = new AudioCtxClass();
  }
  if (audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
    } catch (error) {
      // Silent on browser restrictions. User interaction can retry.
    }
  }
}

function playTone({ type = "sine", startHz = 220, endHz = 220, attack = 0.02, decay = 0.18, gain = 0.09 }) {
  if (!AudioCtxClass || !audioCtx || audioCtx.state !== "running") return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(startHz, now);
  if (endHz !== startHz) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), now + decay);
  }
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(gain, now + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + decay + 0.02);
}

function playSound(type) {
  if (!AudioCtxClass || !audioCtx || audioCtx.state !== "running") return;

  if (type === "spin") {
    playTone({ type: "sawtooth", startHz: 160, endHz: 360, attack: 0.02, decay: 0.2, gain: 0.06 });
    return;
  }

  if (type === "win") {
    const base = audioCtx.currentTime;
    const notes = [520, 660, 820];
    notes.forEach((hz, idx) => {
      const osc = audioCtx.createOscillator();
      const amp = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(hz, base + idx * 0.09);
      amp.gain.setValueAtTime(0.0001, base + idx * 0.09);
      amp.gain.exponentialRampToValueAtTime(0.08, base + idx * 0.09 + 0.02);
      amp.gain.exponentialRampToValueAtTime(0.0001, base + idx * 0.09 + 0.16);
      osc.connect(amp);
      amp.connect(audioCtx.destination);
      osc.start(base + idx * 0.09);
      osc.stop(base + idx * 0.09 + 0.18);
    });
    return;
  }

  playTone({ type: "square", startHz: 210, endHz: 85, attack: 0.015, decay: 0.22, gain: 0.07 });
}

function normalizeWager(value) {
  if (!Number.isFinite(value)) return minWager;
  return Math.min(maxWager, Math.max(minWager, Math.floor(value)));
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
  await unlockAudio();
  const wager = normalizeWager(Number(wagerInput.value));
  wagerInput.value = String(wager);
  if (!Number.isFinite(wager) || wager < minWager || wager > maxWager) {
    setStatus(`Aposta por giro deve ser entre ${minWager} e ${maxWager}`, "#ff5d82");
    return;
  }
  spinButton.disabled = true;
  setStatus("Girando...", "#20ddff");
  playSound("spin");
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
        playSound("win");
        setStatus(`Ganhou! x${Number(data.multiplier).toFixed(2)} - +${Number(data.payout).toFixed(2)} créditos`, "#1fcd8b");
      } else {
        playSound("lose");
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
wagerInput.addEventListener("input", () => {
  wagerInput.value = String(normalizeWager(Number(wagerInput.value)));
});

wagerMinus.addEventListener("click", () => {
  const next = normalizeWager(Number(wagerInput.value) - 1);
  wagerInput.value = String(next);
});

wagerPlus.addEventListener("click", () => {
  const next = normalizeWager(Number(wagerInput.value) + 1);
  wagerInput.value = String(next);
});

document.addEventListener(
  "pointerdown",
  () => {
    unlockAudio();
  },
  { once: true }
);
loadMe();
