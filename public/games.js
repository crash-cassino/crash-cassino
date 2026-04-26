const statusText = document.getElementById("statusText");
const playerField = document.getElementById("playerField");
const creditsField = document.getElementById("creditsField");

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
    playerField.value = data.email;
    creditsField.value = Number(data.credits).toFixed(2);
    setStatus("Pronto para jogar");
  } catch (error) {
    setStatus(error.message, "#ff5d82");
    setTimeout(redirectLogin, 900);
  }
}

init();
