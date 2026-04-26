const statusText = document.getElementById("statusText");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginButton = document.getElementById("loginButton");

function setStatus(message, color) {
  statusText.textContent = message;
  statusText.style.color = color || "#9ca9d8";
}

async function adminLogin() {
  const email = String(emailInput.value || "").trim();
  const password = String(passwordInput.value || "");
  if (!email || !password) {
    setStatus("Informe email e senha", "#ff5d82");
    return;
  }

  try {
    setStatus("Entrando no painel...", "#20ddff");
    const response = await fetch("/auth/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha no login admin");
    }
    localStorage.setItem("crashAdminToken", data.token);
    window.location.href = "/admin.html";
  } catch (error) {
    setStatus(error.message, "#ff5d82");
  }
}

loginButton.addEventListener("click", adminLogin);
