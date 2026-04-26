const adminStatusText = document.getElementById("adminStatusText");
const totalUsersField = document.getElementById("totalUsersField");
const activeUsersField = document.getElementById("activeUsersField");
const totalCreditsField = document.getElementById("totalCreditsField");

const newEmailInput = document.getElementById("newEmailInput");
const newPasswordInput = document.getElementById("newPasswordInput");
const newRoleSelect = document.getElementById("newRoleSelect");
const newCreditsInput = document.getElementById("newCreditsInput");
const createUserButton = document.getElementById("createUserButton");

const creditUserSelect = document.getElementById("creditUserSelect");
const creditAmountInput = document.getElementById("creditAmountInput");
const creditReasonInput = document.getElementById("creditReasonInput");
const addCreditsButton = document.getElementById("addCreditsButton");

const refreshUsersButton = document.getElementById("refreshUsersButton");
const usersTableBody = document.getElementById("usersTableBody");
const logoutButton = document.getElementById("logoutButton");

const token = localStorage.getItem("crashAdminToken") || "";
let usersCache = [];

function setStatus(message, color) {
  adminStatusText.textContent = message;
  adminStatusText.style.color = color || "#9ca9d8";
}

function authHeaders(extra) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`
  };
}

function logout() {
  localStorage.removeItem("crashAdminToken");
  window.location.href = "/admin-login.html";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Erro na requisição");
  }
  return data;
}

async function validateAdminSession() {
  if (!token) {
    logout();
    return false;
  }
  try {
    const me = await fetchJson("/auth/me", {
      headers: authHeaders()
    });
    if (me.role !== "admin") {
      logout();
      return false;
    }
    return true;
  } catch (error) {
    logout();
    return false;
  }
}

function renderUsersTable() {
  usersTableBody.innerHTML = "";
  usersCache.forEach((user) => {
    const tr = document.createElement("tr");
    const badge = user.isActive
      ? '<span class="badge">Ativo</span>'
      : '<span class="badge">Inativo</span>';
    const actionLabel = user.isActive ? "Desativar" : "Ativar";
    tr.innerHTML = `
      <td>${user.id}</td>
      <td>${user.email}</td>
      <td>${user.role}</td>
      <td>${badge}</td>
      <td>${Number(user.credits).toFixed(2)}</td>
      <td><button class="btn btn-primary" data-id="${user.id}" data-active="${user.isActive}">${actionLabel}</button></td>
    `;
    usersTableBody.appendChild(tr);
  });

  usersTableBody.querySelectorAll("button[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const userId = Number(button.dataset.id);
      const currentState = button.dataset.active === "true";
      toggleUserStatus(userId, !currentState);
    });
  });

  creditUserSelect.innerHTML = "";
  usersCache.filter((u) => u.role === "player").forEach((user) => {
    const option = document.createElement("option");
    option.value = String(user.id);
    option.textContent = `${user.email} (saldo: ${Number(user.credits).toFixed(2)})`;
    creditUserSelect.appendChild(option);
  });
}

async function loadOverview() {
  const overview = await fetchJson("/admin/overview", {
    headers: authHeaders()
  });
  totalUsersField.value = String(overview.totalUsers);
  activeUsersField.value = String(overview.activeUsers);
  totalCreditsField.value = String(Number(overview.totalCredits).toFixed(2));
}

async function loadUsers() {
  const response = await fetchJson("/admin/users", {
    headers: authHeaders()
  });
  usersCache = Array.isArray(response.users) ? response.users : [];
  renderUsersTable();
}

async function toggleUserStatus(userId, isActive) {
  try {
    await fetchJson(`/admin/users/${userId}/status`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ isActive })
    });
    setStatus("Status atualizado", "#1fcd8b");
    await loadUsers();
    await loadOverview();
  } catch (error) {
    setStatus(error.message, "#ff5d82");
  }
}

async function createUser() {
  const email = String(newEmailInput.value || "").trim();
  const password = String(newPasswordInput.value || "");
  const role = String(newRoleSelect.value || "player");
  const initialCredits = Number(newCreditsInput.value || 0);

  if (!email || !password) {
    setStatus("Informe email e senha para criar usuário", "#ff5d82");
    return;
  }

  try {
    await fetchJson("/admin/users", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ email, password, role, initialCredits })
    });
    setStatus("Usuário criado com sucesso", "#1fcd8b");
    newEmailInput.value = "";
    newPasswordInput.value = "";
    await loadUsers();
    await loadOverview();
  } catch (error) {
    setStatus(error.message, "#ff5d82");
  }
}

async function addCredits() {
  const userId = Number(creditUserSelect.value);
  const amount = Number(creditAmountInput.value || 0);
  const reason = String(creditReasonInput.value || "admin_credit");

  if (!Number.isInteger(userId) || userId <= 0) {
    setStatus("Selecione um jogador válido", "#ff5d82");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    setStatus("Valor de créditos inválido", "#ff5d82");
    return;
  }

  try {
    await fetchJson("/admin/credits/add", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ userId, amount, reason })
    });
    setStatus("Créditos adicionados", "#1fcd8b");
    await loadUsers();
    await loadOverview();
  } catch (error) {
    setStatus(error.message, "#ff5d82");
  }
}

async function init() {
  const ok = await validateAdminSession();
  if (!ok) {
    return;
  }
  try {
    await loadOverview();
    await loadUsers();
    setStatus("Painel carregado", "#20ddff");
  } catch (error) {
    setStatus(error.message, "#ff5d82");
  }
}

createUserButton.addEventListener("click", createUser);
addCreditsButton.addEventListener("click", addCredits);
refreshUsersButton.addEventListener("click", async () => {
  await loadUsers();
  await loadOverview();
  setStatus("Lista atualizada", "#20ddff");
});
logoutButton.addEventListener("click", logout);

init();
