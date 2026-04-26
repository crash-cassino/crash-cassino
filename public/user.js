const statusText = document.getElementById("statusText");
const welcomeTitle = document.getElementById("welcomeTitle");
const emailField = document.getElementById("emailField");
const roleField = document.getElementById("roleField");
const creditsField = document.getElementById("creditsField");
const activeField = document.getElementById("activeField");
const creditsHighlight = document.getElementById("creditsHighlight");
const activeHighlight = document.getElementById("activeHighlight");
const logoutButton = document.getElementById("logoutButton");

const token = localStorage.getItem("crashUserToken") || "";

function setStatus(message, color) {
  statusText.textContent = message;
  statusText.style.color = color || "#9ca9d8";
}

function logout() {
  localStorage.removeItem("crashUserToken");
  window.location.href = "/login.html";
}

async function loadProfile() {
  if (!token) {
    window.location.href = "/login.html";
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
      localStorage.removeItem("crashUserToken");
      window.location.href = "/login.html";
      return;
    }
    emailField.value = data.email;
    roleField.value = data.role;
    const credits = Number(data.credits).toFixed(2);
    const isActive = data.isActive ? "Sim" : "Não";
    creditsField.value = String(credits);
    activeField.value = isActive;
    creditsHighlight.textContent = credits;
    activeHighlight.textContent = isActive;
    welcomeTitle.textContent = `Olá, ${data.email.split("@")[0]}`;
    setStatus("Conta carregada", "#1fcd8b");
  } catch (error) {
    setStatus(error.message, "#ff5d82");
    setTimeout(logout, 1200);
  }
}

logoutButton.addEventListener("click", logout);
loadProfile();
