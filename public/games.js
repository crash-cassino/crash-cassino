const statusText = document.getElementById("statusText");
const playerField = document.getElementById("playerField");
const creditsField = document.getElementById("creditsField");
const welcomeTitle = document.getElementById("welcomeTitle");

const token = localStorage.getItem("crashUserToken") || "";

function setStatus(message, color) {
  statusText.textContent = message;
  statusText.style.color = color || "#9ca9d8";
}

function redirectLogin() {
  localStorage.removeItem("crashUserToken");
  window.location.href = "/";
}

async function init() {
  if (!token) {
    redirectLogin();
    return;
  }
  try {
    const response = await fetch("/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Sessão inválida");
    }
    if (data.role !== "player") {
      redirectLogin();
      return;
    }
    playerField.textContent = data.email;
    creditsField.textContent = Number(data.credits).toFixed(2);
    welcomeTitle.textContent = `Bem-vindo, ${data.email.split("@")[0]}`;
    setStatus("Tudo pronto. Escolha um jogo e divirta-se.");
  } catch (error) {
    setStatus(error.message, "#ff5d82");
    setTimeout(redirectLogin, 900);
  }
}

init();
