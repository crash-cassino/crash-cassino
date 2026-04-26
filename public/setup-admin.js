const statusText = document.getElementById("statusText");
const setupKeyInput = document.getElementById("setupKeyInput");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const createAdminButton = document.getElementById("createAdminButton");

function setStatus(message, color) {
  statusText.textContent = message;
  statusText.style.color = color || "#9ca9d8";
}

async function createInitialAdmin() {
  const setupKey = String(setupKeyInput.value || "");
  const email = String(emailInput.value || "").trim();
  const password = String(passwordInput.value || "");

  if (!setupKey || !email || !password) {
    setStatus("Preencha todos os campos.", "#ff5d82");
    return;
  }

  try {
    setStatus("Criando admin...", "#20ddff");
    const response = await fetch("/setup/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setupKey, email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha ao criar admin");
    }
    setStatus("Admin criado com sucesso. Vá para /admin-login.html", "#1fcd8b");
  } catch (error) {
    setStatus(error.message, "#ff5d82");
  }
}

createAdminButton.addEventListener("click", createInitialAdmin);
