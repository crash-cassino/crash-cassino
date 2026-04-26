const statusText = document.getElementById("statusText");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const registerButton = document.getElementById("registerButton");
const loginButton = document.getElementById("loginButton");

function setStatus(message, color) {
  statusText.textContent = message;
  statusText.style.color = color || "#9ca9d8";
}

async function register() {
  const email = String(emailInput.value || "").trim();
  const password = String(passwordInput.value || "");
  if (!email || !password) {
    setStatus("Informe email e senha", "#ff5d82");
    return;
  }

  try {
    setStatus("Criando conta...", "#20ddff");
    const response = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha ao criar conta");
    }
    setStatus("Conta criada. Faça login.", "#1fcd8b");
  } catch (error) {
    setStatus(error.message, "#ff5d82");
  }
}

async function login() {
  const email = String(emailInput.value || "").trim();
  const password = String(passwordInput.value || "");
  if (!email || !password) {
    setStatus("Informe email e senha", "#ff5d82");
    return;
  }

  try {
    setStatus("Entrando...", "#20ddff");
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha no login");
    }
    localStorage.setItem("crashUserToken", data.token);
    window.location.href = "/game.html";
  } catch (error) {
    setStatus(error.message, "#ff5d82");
  }
}

registerButton.addEventListener("click", register);
loginButton.addEventListener("click", login);
