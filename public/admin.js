const adminStatusText = document.getElementById("adminStatusText");
const adminUserSelect = document.getElementById("adminUserSelect");
const adminCreditAmountInput = document.getElementById("adminCreditAmountInput");
const adminCreditReasonInput = document.getElementById("adminCreditReasonInput");
const refreshUsersButton = document.getElementById("refreshUsersButton");
const addCreditsButton = document.getElementById("addCreditsButton");

const state = {
  authToken: localStorage.getItem("crashAuthToken") || "",
  users: []
};

function setAdminStatus(text, color) {
  adminStatusText.textContent = text;
  adminStatusText.style.color = color || "#9ca7d7";
}

function getAuthHeaders() {
  if (!state.authToken) {
    return {};
  }
  return { Authorization: `Bearer ${state.authToken}` };
}

function renderUsers() {
  adminUserSelect.innerHTML = "";
  state.users.forEach((user) => {
    const option = document.createElement("option");
    option.value = String(user.id);
    option.textContent = `${user.email} (saldo: ${Number(user.credits).toFixed(2)})`;
    adminUserSelect.appendChild(option);
  });
}

async function fetchUsers() {
  if (!state.authToken) {
    setAdminStatus("Faça login primeiro em /auth.html", "#ff5a7d");
    return;
  }

  try {
    const response = await fetch("/admin/users", { headers: getAuthHeaders() });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha ao listar usuários");
    }
    state.users = Array.isArray(data.users) ? data.users : [];
    renderUsers();
    setAdminStatus("Usuários carregados", "#20ddff");
  } catch (error) {
    setAdminStatus(error.message, "#ff5a7d");
  }
}

async function addCredits() {
  const userId = Number(adminUserSelect.value);
  const amount = Number(adminCreditAmountInput.value);
  const reason = String(adminCreditReasonInput.value || "admin_credit");

  if (!Number.isInteger(userId) || userId <= 0) {
    setAdminStatus("Selecione um jogador", "#ff5a7d");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    setAdminStatus("Quantidade inválida", "#ff5a7d");
    return;
  }

  try {
    const response = await fetch("/admin/credits/add", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({ userId, amount, reason })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Falha ao adicionar créditos");
    }
    setAdminStatus("Créditos adicionados com sucesso", "#12d98f");
    await fetchUsers();
  } catch (error) {
    setAdminStatus(error.message, "#ff5a7d");
  }
}

refreshUsersButton.addEventListener("click", fetchUsers);
addCreditsButton.addEventListener("click", addCredits);
fetchUsers();
