const authStatusText = document.getElementById("authStatusText");
const authEmailInput = document.getElementById("authEmailInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const registerButton = document.getElementById("registerButton");
const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");

const state = {
  authToken: localStorage.getItem("crashAuthToken") || ""
};

function setAuthStatus(text, color) {
  authStatusText.textContent = text;
  authStatusText.style.color = color || "#9ca7d7";
}

function getAuthHeaders() {
  if (!state.authToken) {
    return {};
  }
  return { Authorization: `Bearer ${state.authToken}` };
}

async function fetchMe() {
  if (!state.authToken) {
    setAuthStatus("Não autenticado");
    return;
  }
  try {
    const response = await fetch("/auth/me", { headers: getAuthHeaders() });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Sessão inválida");
    }
    setAuthStatus(`Logado: ${data.email} (${data.role})`, "#20ddff");
  } catch (error) {
    state.authToken = "";
    localStorage.removeItem("crashAuthToken");
    setAuthStatus("Sessão expirada", "#ff5a7d");
  }
}

async function registerUser() {
  const email = String(authEmailInput.value || "").trim();
  const password = String(authPasswordInput.value || "");
  if (!email || !password) {
    setAuthStatus("Informe email e senha", "#ff5a7d");
    return;
  }
  try {
    setAuthStatus("Criando conta...", "#20ddff");
    const response = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha ao criar conta");
    }
    setAuthStatus("Conta criada, faça login", "#12d98f");
  } catch (error) {
    setAuthStatus(error.message, "#ff5a7d");
  }
}

async function loginUser() {
  const email = String(authEmailInput.value || "").trim();
  const password = String(authPasswordInput.value || "");
  if (!email || !password) {
    setAuthStatus("Informe email e senha", "#ff5a7d");
    return;
  }
  try {
    setAuthStatus("Entrando...", "#20ddff");
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha no login");
    }
    state.authToken = data.token;
    localStorage.setItem("crashAuthToken", data.token);
    await fetchMe();
    setAuthStatus("Login realizado", "#12d98f");
  } catch (error) {
    setAuthStatus(error.message, "#ff5a7d");
  }
}

function logoutUser() {
  state.authToken = "";
  localStorage.removeItem("crashAuthToken");
  setAuthStatus("Não autenticado");
}

registerButton.addEventListener("click", registerUser);
loginButton.addEventListener("click", loginUser);
logoutButton.addEventListener("click", logoutUser);
fetchMe();
