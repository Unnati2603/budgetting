const API = window.location.hostname === "localhost" ? "http://localhost:5000" : "/api";

const DEFAULT_CATEGORIES = [
  { name: "Savings & Investments", budget: 60000 },
  { name: "Rent",                  budget: 21000 },
  { name: "Food & Groceries",      budget: 4000  },
  { name: "Fruits & Healthy Eating", budget: 4000 },
  { name: "Mobile & Subscriptions", budget: 500  },
  { name: "Eating Out / Fun",       budget: 4000  },
  { name: "Shopping / Personal Care", budget: 2500 },
  { name: "Emergency / Buffer",     budget: 2000  },
];

const state = {
  view: "plans",
  plans: [],
  activePlan: null,
  periods: [],
  activePeriod: null,
  expenses: [],
  prevExpenses: [],
  activeTab: "transactions",
  editMode: false,
  editDraft: null,
  editingExpenseId: null,
  incomes: [],
  editingIncomeId: null,
  analytics: null,
  token: localStorage.getItem("token") || null,
  currentUser: null,
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt(n) {
  return "₹" + Math.abs(n).toLocaleString("en-IN");
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d) {
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function toInputDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function autoEndDate(startStr, type) {
  if (!startStr) return "";
  const d = new Date(startStr);
  if (type === "monthly") return new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()).toISOString().slice(0, 10);
  if (type === "weekly")  { d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); }
  if (type === "yearly")  return new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()).toISOString().slice(0, 10);
  return "";
}

function autoLabel(startStr, type) {
  if (!startStr) return "";
  const d = new Date(startStr);
  if (type === "monthly") {
    const end = new Date(autoEndDate(startStr, "monthly"));
    return end.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }
  if (type === "weekly") return "Week of " + d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  if (type === "yearly")  return String(d.getFullYear());
  return "";
}

function nextPeriodStart(periods) {
  if (!periods.length) {
    const now = new Date();
    const d = now.getDate(), y = now.getFullYear(), m = now.getMonth();
    return d >= 25 ? new Date(y, m, 25) : new Date(y, m - 1, 25);
  }
  return new Date([...periods].sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0].endDate);
}

function dayOfPeriod(period) {
  const today = new Date();
  const start = new Date(period.startDate);
  const end   = new Date(period.endDate);
  if (today < start || today > end) return null;
  const day   = Math.floor((today - start) / 864e5) + 1;
  const total = Math.floor((end - start) / 864e5);
  return { day, total };
}

// ─── Authenticated fetch ──────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401 && state.token) { logout(); throw new Error("Session expired"); }
  return r;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function setAuth(token, user) {
  state.token = token;
  state.currentUser = user;
  localStorage.setItem("token", token);
  loadPlans().then(() => { state.view = "plans"; render(); });
}

function logout() {
  state.token = null;
  state.currentUser = null;
  localStorage.removeItem("token");
  Object.assign(state, {
    view: "plans", plans: [], activePlan: null, periods: [], activePeriod: null,
    expenses: [], prevExpenses: [], incomes: [], analytics: null,
  });
  render();
}

async function loginEmail() {
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!email || !password) { alert("Email and password required"); return; }
  try {
    const data = await fetch(`${API}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then(r => r.json());
    if (data.error) { alert(data.error); return; }
    setAuth(data.token, data.user);
  } catch { alert("Login failed — is the server running?"); }
}

async function registerEmail() {
  const name     = document.getElementById("reg-name").value.trim();
  const email    = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  if (!email || !password) { alert("Email and password required"); return; }
  try {
    const data = await fetch(`${API}/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    }).then(r => r.json());
    if (data.error) { alert(data.error); return; }
    setAuth(data.token, data.user);
  } catch { alert("Registration failed — is the server running?"); }
}

async function handleGoogleCredential(response) {
  try {
    const data = await fetch(`${API}/auth/google`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential }),
    }).then(r => r.json());
    if (data.error) { alert("Google sign-in failed: " + data.error); return; }
    setAuth(data.token, data.user);
  } catch { alert("Google sign-in failed"); }
}

async function initGoogleButton() {
  const container = document.getElementById("google-btn");
  if (!container) return;
  if (!window.google?.accounts?.id) { setTimeout(initGoogleButton, 200); return; }
  if (!window._googleClientId) {
    try {
      const cfg = await fetch(`${API}/auth/config`).then(r => r.json());
      window._googleClientId = cfg.googleClientId;
    } catch { return; }
  }
  if (!window._googleClientId) return;
  google.accounts.id.initialize({ client_id: window._googleClientId, callback: handleGoogleCredential });
  google.accounts.id.renderButton(container, { theme: "filled_black", size: "large", width: "340" });
}

// ─── View: Login ──────────────────────────────────────────────────────────────

function renderLogin() {
  return `
    <div class="login-wrap">
      <div class="login-brand">Budget Tracker</div>
      <div class="login-card">
        <div id="google-btn"></div>
        <div class="login-divider"><span>or</span></div>
        <div class="field"><label>Email</label><input id="login-email" type="email" placeholder="you@example.com" onkeydown="if(event.key==='Enter')loginEmail()"></div>
        <div class="field"><label>Password</label><input id="login-password" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')loginEmail()"></div>
        <button onclick="loginEmail()">Sign In</button>
        <button class="secondary-btn" onclick="state.view='register'; render()">Create Account</button>
      </div>
    </div>
  `;
}

function renderRegister() {
  return `
    <div class="login-wrap">
      <div class="login-brand">Budget Tracker</div>
      <div class="login-card">
        <h2 class="login-title">Create Account</h2>
        <div class="field"><label>Name</label><input id="reg-name" type="text" placeholder="Your name"></div>
        <div class="field"><label>Email</label><input id="reg-email" type="email" placeholder="you@example.com"></div>
        <div class="field"><label>Password</label><input id="reg-password" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')registerEmail()"></div>
        <button onclick="registerEmail()">Create Account</button>
        <button class="secondary-btn" onclick="state.view='plans'; render()">Back to Sign In</button>
      </div>
    </div>
  `;
}

// ─── Render dispatcher ────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById("app");
  if (!state.token) {
    app.innerHTML = state.view === "register" ? renderRegister() : renderLogin();
    requestAnimationFrame(initGoogleButton);
    return;
  }
  const views = { "plans": renderPlans, "new-plan": renderNewPlan,
    "periods": renderPeriods, "new-period": renderNewPeriod, "period": renderPeriod };
  app.innerHTML = (views[state.view] || renderPlans)();
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function loadPlans() {
  state.plans = await apiFetch(`${API}/plans`).then(r => r.json());
}

async function loadPeriods() {
  state.periods = await apiFetch(`${API}/plans/${state.activePlan._id}/periods`).then(r => r.json());
}

async function loadExpenses() {
  state.expenses = await apiFetch(`${API}/periods/${state.activePeriod._id}/expenses`).then(r => r.json());
}

function getPreviousPeriod() {
  const cur = new Date(state.activePeriod.startDate);
  return [...state.periods]
    .filter(p => new Date(p.endDate) <= cur)
    .sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0] || null;
}

async function loadPrevExpenses() {
  const prev = getPreviousPeriod();
  state.prevExpenses = prev
    ? await apiFetch(`${API}/periods/${prev._id}/expenses`).then(r => r.json())
    : [];
}

async function loadIncomes() {
  state.incomes = await apiFetch(`${API}/periods/${state.activePeriod._id}/incomes`).then(r => r.json());
}

async function loadAnalytics() {
  state.analytics = await apiFetch(`${API}/plans/${state.activePlan._id}/analytics`).then(r => r.json());
}

async function autoCreatePeriodIfNeeded() {
  if (!state.periods.length) return;
  let latest = [...state.periods].sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0];
  if (latest.type === "custom") return;
  const now = new Date();
  let created = false;
  for (let i = 0; i < 24; i++) {
    if (new Date(latest.endDate) >= now) break;
    const s = toInputDate(new Date(latest.endDate));
    const e = autoEndDate(s, latest.type);
    const l = autoLabel(s, latest.type);
    const r = await apiFetch(`${API}/plans/${state.activePlan._id}/periods`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: l, type: latest.type, startDate: s, endDate: e }),
    });
    latest = await r.json();
    created = true;
  }
  if (created) await loadPeriods();
}

// ─── Navigation ───────────────────────────────────────────────────────────────

async function openPlan(id) {
  state.activePlan = state.plans.find(p => p._id === id);
  await loadPeriods();
  await autoCreatePeriodIfNeeded();
  await loadAnalytics();
  state.view = "periods";
  state.editMode = false;
  render();
}

async function openPeriod(id) {
  state.activePeriod = state.periods.find(p => p._id === id);
  await Promise.all([loadExpenses(), loadPrevExpenses(), loadIncomes()]);
  state.view = "period";
  state.activeTab = "transactions";
  state.editingExpenseId = null;
  state.editingIncomeId = null;
  render();
}

function goPlans() {
  Object.assign(state, { view: "plans", activePlan: null, periods: [],
    activePeriod: null, expenses: [], prevExpenses: [], incomes: [], analytics: null });
  render();
}

function goPeriods() {
  Object.assign(state, { view: "periods", activePeriod: null, expenses: [],
    prevExpenses: [], editMode: false, editingExpenseId: null,
    incomes: [], editingIncomeId: null });
  render();
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.add("active");
  document.getElementById(`content-${tab}`).classList.add("active");
}

// ─── Plans CRUD ───────────────────────────────────────────────────────────────

async function createPlan() {
  const name         = document.getElementById("np-name").value.trim();
  const salary       = Number(document.getElementById("np-salary").value);
  const carryForward = document.getElementById("np-carry").checked;
  if (!name || !salary) { alert("Name and salary are required"); return; }
  const categories = [];
  document.querySelectorAll(".np-cat-row").forEach(row => {
    const n = row.querySelector(".np-cat-name").value.trim();
    const b = Number(row.querySelector(".np-cat-budget").value);
    if (n) categories.push({ name: n, budget: b || 0 });
  });
  await apiFetch(`${API}/plans`, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, salary, categories, carryForward }) });
  await loadPlans();
  state.view = "plans";
  render();
}

async function savePlan() {
  const draft = state.editDraft;
  draft.name         = document.getElementById("edit-name").value.trim();
  draft.salary       = Number(document.getElementById("edit-salary").value);
  draft.carryForward = document.getElementById("edit-carry").checked;
  const categories = [];
  document.querySelectorAll(".edit-cat-row").forEach(row => {
    const n = row.querySelector(".edit-cat-name").value.trim();
    const b = Number(row.querySelector(".edit-cat-budget").value);
    if (n) categories.push({ name: n, budget: b || 0 });
  });
  draft.categories = categories;
  state.activePlan = await apiFetch(`${API}/plans/${draft._id}`, { method: "PUT",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }).then(r => r.json());
  state.editMode = false;
  state.editDraft = null;
  await loadPlans();
  await loadAnalytics();
  render();
}

async function deletePlan(id) {
  if (!confirm("Delete this plan and all its periods and transactions?")) return;
  await apiFetch(`${API}/plans/${id}`, { method: "DELETE" });
  await loadPlans();
  goPlans();
}

// ─── Periods CRUD ─────────────────────────────────────────────────────────────

async function createPeriod() {
  const label = document.getElementById("per-label").value.trim();
  const type  = document.getElementById("per-type").value;
  const start = document.getElementById("per-start").value;
  const end   = document.getElementById("per-end").value;
  if (!start || !end) { alert("Start and end dates are required"); return; }
  await apiFetch(`${API}/plans/${state.activePlan._id}/periods`, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: label || autoLabel(start, type), type, startDate: start, endDate: end }) });
  await loadPeriods();
  state.view = "periods";
  render();
}

async function deletePeriod(id) {
  if (!confirm("Delete this period and all its transactions?")) return;
  await apiFetch(`${API}/periods/${id}`, { method: "DELETE" });
  await loadPeriods();
  goPeriods();
}

// ─── Expenses CRUD ────────────────────────────────────────────────────────────

function buildCreatedAt(dateStr) {
  if (!dateStr) return new Date().toISOString();
  return new Date(dateStr + "T" + new Date().toTimeString().slice(0, 8)).toISOString();
}

async function addExpense() {
  const category  = document.getElementById("cat-select").value;
  const amount    = Number(document.getElementById("amt-input").value);
  const note      = document.getElementById("note-input").value.trim();
  const date      = document.getElementById("exp-date").value;
  const recurring = document.getElementById("exp-recurring").checked;
  if (!amount) { alert("Enter an amount"); return; }

  await apiFetch(`${API}/periods/${state.activePeriod._id}/expenses`, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, amount, note, recurring, createdAt: buildCreatedAt(date) }) });

  document.getElementById("amt-input").value = "";
  document.getElementById("note-input").value = "";
  document.getElementById("exp-recurring").checked = false;
  await loadExpenses();
  render();
}

async function saveExpenseEdit(id) {
  const category  = document.getElementById(`edit-cat-${id}`).value;
  const amount    = Number(document.getElementById(`edit-amt-${id}`).value);
  const note      = document.getElementById(`edit-note-${id}`).value.trim();
  const date      = document.getElementById(`edit-date-${id}`).value;
  const recurring = document.getElementById(`edit-rec-${id}`).checked;
  await apiFetch(`${API}/expenses/${id}`, { method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, amount, note, recurring, createdAt: buildCreatedAt(date) }) });
  state.editingExpenseId = null;
  await loadExpenses();
  render();
}

function cancelExpenseEdit() {
  state.editingExpenseId = null;
  render();
}

async function deleteExpense(id) {
  state.editingExpenseId = null;
  await apiFetch(`${API}/expenses/${id}`, { method: "DELETE" });
  await loadExpenses();
  render();
}

async function importRecurring() {
  const recurring = state.prevExpenses.filter(e => e.recurring);
  await Promise.all(recurring.map(e =>
    apiFetch(`${API}/periods/${state.activePeriod._id}/expenses`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: e.category, amount: e.amount, note: e.note,
        recurring: true, createdAt: new Date(state.activePeriod.startDate).toISOString() }) })
  ));
  await loadExpenses();
  render();
}

function periodBudgetTotal() {
  const cats = state.activePeriod?.categoryBudgets?.length
    ? state.activePeriod.categoryBudgets
    : state.activePlan?.categories || [];
  return cats.reduce((s, c) => s + c.budget, 0);
}

async function addIncome() {
  const source    = document.getElementById("inc-source").value.trim();
  const amount    = Number(document.getElementById("inc-amount").value);
  const note      = document.getElementById("inc-note").value.trim();
  const date      = document.getElementById("inc-date").value;
  const recurring = document.getElementById("inc-recurring").checked;
  if (!source) { alert("Enter a source"); return; }
  if (!amount) { alert("Enter an amount"); return; }
  const limit        = periodBudgetTotal();
  const currentTotal = state.incomes.reduce((s, i) => s + i.amount, 0);
  if (limit > 0 && currentTotal + amount > limit) {
    alert(`Total income would exceed the combined category budget of ${fmt(limit)}.\nCurrently logged: ${fmt(currentTotal)} · Trying to add: ${fmt(amount)}`);
    return;
  }
  await apiFetch(`${API}/periods/${state.activePeriod._id}/incomes`, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, amount, note, recurring, createdAt: buildCreatedAt(date) }) });
  await loadIncomes();
  render();
}

async function saveIncomeEdit(id) {
  const source    = document.getElementById(`edit-inc-source-${id}`).value.trim();
  const amount    = Number(document.getElementById(`edit-inc-amt-${id}`).value);
  const note      = document.getElementById(`edit-inc-note-${id}`).value.trim();
  const date      = document.getElementById(`edit-inc-date-${id}`).value;
  const recurring = document.getElementById(`edit-inc-rec-${id}`).checked;
  const limit        = periodBudgetTotal();
  const otherTotal   = state.incomes.filter(i => i._id !== id).reduce((s, i) => s + i.amount, 0);
  if (limit > 0 && otherTotal + amount > limit) {
    alert(`Total income would exceed the combined category budget of ${fmt(limit)}.`);
    return;
  }
  await apiFetch(`${API}/incomes/${id}`, { method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, amount, note, recurring, createdAt: buildCreatedAt(date) }) });
  state.editingIncomeId = null;
  await loadIncomes();
  render();
}

function cancelIncomeEdit() {
  state.editingIncomeId = null;
  render();
}

async function deleteIncome(id) {
  state.editingIncomeId = null;
  await apiFetch(`${API}/incomes/${id}`, { method: "DELETE" });
  await loadIncomes();
  render();
}

function exportCSV() {
  const period = state.activePeriod;
  const rows = [
    ["Date & Time", "Category", "Amount (INR)", "Note", "Recurring"],
    ...state.expenses.map(e => [
      fmtDateTime(e.createdAt), e.category, e.amount, e.note || "", e.recurring ? "Yes" : "No"
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `${period.label || "expenses"}.csv`;
  a.click();
}

// ─── View: Plans list ─────────────────────────────────────────────────────────

function renderPlans() {
  const cards = state.plans.map(p => `
    <div class="plan-card" onclick="openPlan('${p._id}')">
      <div class="plan-card-header">
        <span class="plan-card-name">${p.name}</span>
        <span class="plan-card-salary">${fmt(p.salary)} / mo</span>
      </div>
      <div class="plan-card-sub">${p.periodCount} period${p.periodCount !== 1 ? "s" : ""} · ${p.categories.length} categories</div>
    </div>
  `).join("") || `<div class="empty">No plans yet. Create your first one.</div>`;

  const userLabel = state.currentUser?.name || state.currentUser?.email || "";
  return `
    <div class="container">
      <header class="list-header">
        <h1>Budget Tracker</h1>
        <button onclick="state.view='new-plan'; render()">+ New Plan</button>
      </header>
      ${userLabel ? `<div class="user-bar"><span>${userLabel}</span><button class="ghost-btn" onclick="logout()">Log out</button></div>` : ""}
      <div class="plan-list">${cards}</div>
    </div>
  `;
}

// ─── View: New Plan ───────────────────────────────────────────────────────────

function renderNewPlan() {
  const seed = state.plans.length ? state.plans[0].categories : DEFAULT_CATEGORIES;
  const catRows = seed.map(c => `
    <div class="np-cat-row">
      <input class="np-cat-name"   type="text"   value="${c.name}"   placeholder="Category">
      <input class="np-cat-budget" type="number" value="${c.budget}" placeholder="Budget">
      <button class="icon-btn" onclick="this.closest('.np-cat-row').remove()">×</button>
    </div>
  `).join("");

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="goPlans()">← Back</button>
        <h1>New Plan</h1><span></span>
      </header>
      <div class="form-card">
        <div class="np-meta-row">
          <div class="field"><label>Plan Name</label><input id="np-name" type="text" placeholder="e.g. Main Budget"></div>
          <div class="field"><label>Monthly Income</label><input id="np-salary" type="number" placeholder="98000"></div>
        </div>
        <label class="plan-option">
          <input type="checkbox" id="np-carry">
          <span>Carry unused budget forward to next period</span>
        </label>
      </div>
      <div class="section-label">Categories</div>
      <div class="form-card">
        <div id="np-cat-list">${catRows}</div>
        <button class="ghost-btn" onclick="addNpCatRow()">+ Add Category</button>
      </div>
      <div class="action-row">
        <button class="secondary-btn" onclick="goPlans()">Cancel</button>
        <button onclick="createPlan()">Create Plan</button>
      </div>
    </div>
  `;
}

function addNpCatRow() {
  const row = document.createElement("div");
  row.className = "np-cat-row";
  row.innerHTML = `
    <input class="np-cat-name" type="text" placeholder="Category">
    <input class="np-cat-budget" type="number" placeholder="Budget">
    <button class="icon-btn" onclick="this.closest('.np-cat-row').remove()">×</button>
  `;
  document.getElementById("np-cat-list").appendChild(row);
}

// ─── View: Plan Dashboard ─────────────────────────────────────────────────────

function renderPlanDashboard() {
  const a = state.analytics;
  if (!a) return "";
  const { summary, wishySavings, perPeriod } = a;
  const avgPerPeriod = summary.periodCount > 0
    ? Math.round(summary.totalSpent / summary.periodCount) : 0;

  const statsHtml = `
    <div class="dash-grid">
      <div class="dash-stat">
        <div class="dash-label">Total Spent</div>
        <div class="dash-val">${fmt(summary.totalSpent)}</div>
        <div class="dash-sub">${summary.periodCount} period${summary.periodCount !== 1 ? "s" : ""}</div>
      </div>
      <div class="dash-stat">
        <div class="dash-label">Avg / Period</div>
        <div class="dash-val">${fmt(avgPerPeriod)}</div>
      </div>
      <div class="dash-stat">
        <div class="dash-label">Wishy Wish</div>
        <div class="dash-val wishy-val">${fmt(summary.totalWishySaved)}</div>
        <div class="dash-sub">unused budget</div>
      </div>
    </div>
  `;

  const wishyHtml = (!state.activePlan.carryForward && wishySavings.length) ? `
    <div class="wishy-section">
      <div class="wishy-header">✦ Wishy Wish Savings — by Category</div>
      ${wishySavings.map(w => {
        const pct = summary.totalWishySaved > 0
          ? Math.round((w.accumulated / summary.totalWishySaved) * 100) : 0;
        return `
          <div class="wishy-row">
            <div class="wishy-cat">${w.name}</div>
            <div class="wishy-bar-track"><div class="wishy-bar-fill" style="width:${pct}%"></div></div>
            <div class="wishy-amt">${fmt(w.accumulated)}</div>
          </div>
        `;
      }).join("")}
    </div>
  ` : "";

  return `<div class="dash-section">${statsHtml}${wishyHtml}</div>`;
}

// ─── View: Periods list ───────────────────────────────────────────────────────

function renderPeriods() {
  const p = state.activePlan;
  if (state.editMode) return renderEditPlan(p);

  const cards = state.periods.map(period => {
    const spent = period.spent || 0;
    const pct   = Math.min(Math.round((spent / p.salary) * 100), 100);
    const typeLabel = { monthly: "Monthly", weekly: "Weekly", yearly: "Yearly", custom: "Custom" }[period.type] || "";
    return `
      <div class="plan-card" onclick="openPeriod('${period._id}')">
        <div class="plan-card-header">
          <span class="plan-card-name">${period.label || fmtDate(period.startDate)}</span>
          <span class="period-type-chip">${typeLabel}</span>
        </div>
        <div class="plan-card-sub">${fmtDate(period.startDate)} – ${fmtDate(period.endDate)}</div>
        <div class="plan-card-bar-track">
          <div class="plan-card-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="plan-card-footer">
          <span>${fmt(spent)} spent</span>
          <span>${fmt(p.salary - spent)} left</span>
        </div>
      </div>
    `;
  }).join("") || `<div class="empty">No periods yet. Add your first one.</div>`;

  const sorted = [...state.periods].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const trendHtml = state.periods.length > 1 ? `
    <div class="section-label" style="margin-top:32px;margin-bottom:12px">Spending Trend</div>
    <div class="trend-chart">
      ${sorted.map(period => {
        const pct = Math.min(Math.round((period.spent / p.salary) * 100), 100);
        return `
          <div class="trend-row">
            <div class="trend-label">${period.label || fmtDate(period.startDate)}</div>
            <div class="trend-bar-track"><div class="trend-bar-fill" style="width:${pct}%"></div></div>
            <div class="trend-amount">${fmt(period.spent)} <span>${pct}%</span></div>
          </div>
        `;
      }).join("")}
    </div>
  ` : "";

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="goPlans()">← Plans</button>
        <div class="plan-header-center">
          <h1>${p.name}</h1>
          <p>${fmt(p.salary)} / month · ${p.categories.length} categories</p>
        </div>
        <button class="edit-btn" onclick="enterEditMode()">Edit</button>
      </header>
      ${renderPlanDashboard()}
      <div class="plan-list">${cards}</div>
      ${trendHtml}
      <div class="action-row" style="margin-top:20px">
        <button class="danger-btn" onclick="deletePlan('${p._id}')">Delete Plan</button>
        <button onclick="state.view='new-period'; render()">+ New Period</button>
      </div>
    </div>
  `;
}

// ─── View: Edit Plan ──────────────────────────────────────────────────────────

function renderEditPlan(p) {
  const catRows = p.categories.map(c => `
    <div class="edit-cat-row">
      <input class="edit-cat-name"   type="text"   value="${c.name}">
      <input class="edit-cat-budget" type="number" value="${c.budget}">
      <button class="icon-btn" onclick="this.closest('.edit-cat-row').remove()">×</button>
    </div>
  `).join("");

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="cancelEdit()">Cancel</button>
        <h1>Edit Plan</h1>
        <button onclick="savePlan()">Save</button>
      </header>
      <div class="form-card">
        <div class="np-meta-row">
          <div class="field"><label>Plan Name</label><input id="edit-name" type="text" value="${p.name}"></div>
          <div class="field"><label>Monthly Income</label><input id="edit-salary" type="number" value="${p.salary}"></div>
        </div>
        <label class="plan-option">
          <input type="checkbox" id="edit-carry" ${p.carryForward ? "checked" : ""}>
          <span>Carry unused budget forward to next period</span>
        </label>
      </div>
      <div class="section-label">Categories</div>
      <div class="form-card">
        <div id="edit-cat-list">${catRows}</div>
        <button class="ghost-btn" onclick="addEditCatRow()">+ Add Category</button>
      </div>
    </div>
  `;
}

function addEditCatRow() {
  const row = document.createElement("div");
  row.className = "edit-cat-row";
  row.innerHTML = `
    <input class="edit-cat-name"   type="text"   placeholder="Category">
    <input class="edit-cat-budget" type="number" placeholder="Budget">
    <button class="icon-btn" onclick="this.closest('.edit-cat-row').remove()">×</button>
  `;
  document.getElementById("edit-cat-list").appendChild(row);
}

function enterEditMode() {
  state.editMode  = true;
  state.editDraft = JSON.parse(JSON.stringify(state.activePlan));
  render();
}

function cancelEdit() {
  state.editMode  = false;
  state.editDraft = null;
  render();
}

// ─── View: New Period ─────────────────────────────────────────────────────────

function renderNewPeriod() {
  const start    = nextPeriodStart(state.periods);
  const startStr = toInputDate(start);
  const endStr   = autoEndDate(startStr, "monthly");
  const label    = autoLabel(startStr, "monthly");

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="goPeriods()">← Back</button>
        <h1>New Period</h1><span></span>
      </header>
      <div class="form-card">
        <div class="np-meta-row">
          <div class="field"><label>Label</label><input id="per-label" type="text" value="${label}" placeholder="e.g. May 2026"></div>
          <div class="field">
            <label>Frequency</label>
            <select id="per-type" onchange="onTypeChange()">
              <option value="monthly" selected>Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>
        <div class="np-meta-row">
          <div class="field"><label>Start Date</label><input id="per-start" type="date" value="${startStr}" onchange="onStartChange()"></div>
          <div class="field"><label>End Date</label><input id="per-end" type="date" value="${endStr}"></div>
        </div>
      </div>
      <div class="action-row">
        <button class="secondary-btn" onclick="goPeriods()">Cancel</button>
        <button onclick="createPeriod()">Create Period</button>
      </div>
    </div>
  `;
}

function onTypeChange() {
  const type  = document.getElementById("per-type").value;
  const start = document.getElementById("per-start").value;
  if (type !== "custom" && start) {
    document.getElementById("per-end").value   = autoEndDate(start, type);
    document.getElementById("per-label").value = autoLabel(start, type);
  }
}

function onStartChange() {
  const type  = document.getElementById("per-type").value;
  const start = document.getElementById("per-start").value;
  if (type !== "custom") {
    document.getElementById("per-end").value   = autoEndDate(start, type);
    document.getElementById("per-label").value = autoLabel(start, type);
  }
}

// ─── View: Compare tab ────────────────────────────────────────────────────────

function renderCompareTab() {
  const plan       = state.activePlan;
  const prevPeriod = getPreviousPeriod();
  if (!prevPeriod) return `<div class="empty">No previous period to compare with</div>`;

  const byCat = {}, prevByCat = {};
  state.expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
  state.prevExpenses.forEach(e => { prevByCat[e.category] = (prevByCat[e.category] || 0) + e.amount; });

  const thisLabel = state.activePeriod.label || "This";
  const prevLabel = prevPeriod.label || "Previous";

  const rows = plan.categories.map(({ name, budget }) => {
    const t = byCat[name] || 0, v = prevByCat[name] || 0;
    const diff = t - v;
    const clr  = diff > 0 ? "var(--danger)" : diff < 0 ? "var(--success)" : "var(--muted)";
    const dStr = diff === 0 ? "—" : (diff > 0 ? "+" : "−") + fmt(Math.abs(diff));
    return `
      <div class="compare-row">
        <div class="compare-cat">${name}</div>
        <div class="compare-cell">${fmt(t)}<span class="compare-pct">${Math.round(t / budget * 100)}%</span></div>
        <div class="compare-cell">${fmt(v)}<span class="compare-pct">${Math.round(v / budget * 100)}%</span></div>
        <div class="compare-diff" style="color:${clr}">${dStr}</div>
      </div>
    `;
  }).join("");

  const tT = state.expenses.reduce((s, e) => s + e.amount, 0);
  const vT = state.prevExpenses.reduce((s, e) => s + e.amount, 0);
  const dT = tT - vT;

  return `
    <div class="compare-header">
      <div class="compare-cat"></div>
      <div class="compare-label">${thisLabel}</div>
      <div class="compare-label">${prevLabel}</div>
      <div class="compare-label">Change</div>
    </div>
    ${rows}
    <div class="compare-total">
      <div class="compare-cat">Total</div>
      <div class="compare-cell">${fmt(tT)}</div>
      <div class="compare-cell">${fmt(vT)}</div>
      <div class="compare-diff" style="color:${dT > 0 ? "var(--danger)" : dT < 0 ? "var(--success)" : "var(--muted)"}">
        ${dT === 0 ? "—" : (dT > 0 ? "+" : "−") + fmt(Math.abs(dT))}
      </div>
    </div>
  `;
}

// ─── View: Period ─────────────────────────────────────────────────────────────

function renderPeriod() {
  const plan   = state.activePlan;
  const period = state.activePeriod;
  const spent       = state.expenses.reduce((s, e) => s + e.amount, 0);
  const totalIncome = state.incomes.reduce((s, i) => s + i.amount, 0) || plan.salary;
  const savings     = totalIncome - spent;
  const dayInfo = dayOfPeriod(period);
  const today   = toInputDate(new Date());

  const catOptions = plan.categories.map(c => `<option>${c.name}</option>`).join("");

  // ── Recurring import banner
  const recurringFromPrev = state.prevExpenses.filter(e => e.recurring);
  const alreadyImported   = state.expenses.some(e => e.recurring);
  const importBanner = recurringFromPrev.length > 0 && !alreadyImported ? `
    <div class="import-banner">
      <span>${recurringFromPrev.length} recurring expense${recurringFromPrev.length > 1 ? "s" : ""} from ${getPreviousPeriod()?.label || "last period"}</span>
      <button onclick="importRecurring()">Import</button>
    </div>
  ` : "";

  // ── Transactions
  const transactionsHtml = state.expenses.length
    ? state.expenses.map(e => {
        if (e._id === state.editingExpenseId) {
          const catOpts = plan.categories
            .map(c => `<option ${c.name === e.category ? "selected" : ""}>${c.name}</option>`).join("");
          return `
            <div class="expense-edit-form">
              <div class="edit-expense-row">
                <select id="edit-cat-${e._id}">${catOpts}</select>
                <input type="number" id="edit-amt-${e._id}" value="${e.amount}" placeholder="Amount">
              </div>
              <div class="edit-expense-row">
                <input type="text" id="edit-note-${e._id}" value="${e.note || ""}" placeholder="Note">
                <input type="date" id="edit-date-${e._id}" value="${toInputDate(e.createdAt)}">
              </div>
              <div class="edit-expense-row">
                <label class="recurring-label">
                  <input type="checkbox" id="edit-rec-${e._id}" ${e.recurring ? "checked" : ""}> Recurring
                </label>
                <div style="display:flex;gap:8px">
                  <button onclick="saveExpenseEdit('${e._id}')">Save</button>
                  <button class="secondary-btn" onclick="cancelExpenseEdit()">Cancel</button>
                </div>
              </div>
            </div>
          `;
        }
        return `
          <div class="expense-item">
            <div class="expense-meta">
              <div class="cat">
                ${e.category}
                ${e.recurring ? `<span class="recurring-badge">recurring</span>` : ""}
              </div>
              ${e.note ? `<div class="note">${e.note}</div>` : ""}
              <div class="date">${fmtDateTime(e.createdAt)}</div>
            </div>
            <div class="expense-right">
              <span class="expense-amount">${fmt(e.amount)}</span>
              <button class="edit-expense-btn" onclick="state.editingExpenseId='${e._id}'; render()">Edit</button>
              <button class="del-btn" onclick="deleteExpense('${e._id}')">Delete</button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="empty">No transactions yet</div>`;

  // ── Budget
  const byCategory = {}, prevByCategory = {};
  state.expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; });
  state.prevExpenses.forEach(e => { prevByCategory[e.category] = (prevByCategory[e.category] || 0) + e.amount; });
  const prevPeriod = getPreviousPeriod();

  const budgetCategories = (period.categoryBudgets && period.categoryBudgets.length)
    ? period.categoryBudgets : plan.categories;

  let wishyTotal = 0;
  const budgetHtml = budgetCategories.map(({ name, budget }) => {
    let effective = budget;
    let carryNote = "";

    if (plan.carryForward && prevPeriod) {
      const prevCatBudget = ((prevPeriod.categoryBudgets?.length
        ? prevPeriod.categoryBudgets : plan.categories)
        .find(c => c.name === name)?.budget) || budget;
      const prevUnused = Math.max(0, prevCatBudget - (prevByCategory[name] || 0));
      if (prevUnused > 0) {
        effective = budget + prevUnused;
        carryNote = `<div class="carry-note">+${fmt(prevUnused)} carried from ${prevPeriod.label || "last period"} · budget boosted to ${fmt(effective)}</div>`;
      }
    }

    const sp   = byCategory[name] || 0;
    const pr   = effective - sp;
    const over = pr < 0;
    const pct  = effective > 0 ? Math.min((sp / effective) * 100, 100) : 100;
    const clr  = pct < 70 ? "var(--success)" : pct < 90 ? "var(--warning)" : "var(--danger)";

    const unused = Math.max(0, effective - sp);
    if (!plan.carryForward && unused > 0) wishyTotal += unused;

    return `
      <div class="budget-item">
        <div class="budget-header">
          <span class="budget-cat">${name}</span>
          <span>
            <span class="budget-remaining" style="color:${over ? "var(--danger)" : "var(--text)"}">
              ${over ? fmt(-pr) + " excess" : fmt(pr) + " left"}
            </span>
            <span class="budget-of"> / ${fmt(effective)}</span>
          </span>
        </div>
        ${carryNote}
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${clr}"></div></div>
        <div class="budget-footer">
          <span>${fmt(sp)} spent</span>
          <span>${Math.round(pct)}%</span>
        </div>
      </div>
    `;
  }).join("");

  const wishyBanner = (!plan.carryForward && wishyTotal > 0) ? `
    <div class="wishy-banner">
      <span class="wishy-banner-title">✦ Wishy Wish Savings</span>
      <span class="wishy-banner-amt">${fmt(wishyTotal)} unused this period</span>
    </div>
  ` : "";

  const tA = state.activeTab === "transactions" ? "active" : "";
  const bA = state.activeTab === "budget"       ? "active" : "";
  const cA = state.activeTab === "compare"      ? "active" : "";
  const iA = state.activeTab === "income"       ? "active" : "";

  const dayBadge = dayInfo
    ? `<span class="day-badge">Day ${dayInfo.day} of ${dayInfo.total}</span>`
    : "";

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="goPeriods()">← ${plan.name}</button>
        <div class="plan-header-center">
          <h1>${period.label || fmtDate(period.startDate)}</h1>
          <p>${fmtDate(period.startDate)} – ${fmtDate(period.endDate)} ${dayBadge}</p>
        </div>
        <button class="danger-btn-sm" onclick="deletePeriod('${period._id}')">Delete</button>
      </header>

      <div class="summary">
        <div class="summary-item"><div class="label">Income</div><div class="value">${fmt(totalIncome)}</div></div>
        <div class="summary-item"><div class="label">Spent</div><div class="value">${fmt(spent)}</div></div>
        <div class="summary-item"><div class="label">Savings</div>
          <div class="value" style="color:${savings < 0 ? "var(--danger)" : savings > 0 ? "var(--success)" : "inherit"}">${fmt(savings)}</div>
        </div>
      </div>

      <div class="form-card">
        <div class="form-row">
          <select id="cat-select">${catOptions}</select>
          <input type="number" id="amt-input" placeholder="Amount (₹)">
          <input type="text"   id="note-input" placeholder="Note" onkeydown="if(event.key==='Enter')addExpense()">
          <input type="date"   id="exp-date" value="${today}">
          <label class="recurring-label"><input type="checkbox" id="exp-recurring"> Recurring</label>
          <button onclick="addExpense()">Add</button>
        </div>
      </div>

      <div class="tabs-row">
        <div class="tabs">
          <button class="tab-btn ${tA}" id="tab-transactions" onclick="switchTab('transactions')">Transactions</button>
          <button class="tab-btn ${bA}" id="tab-budget"       onclick="switchTab('budget')">Budget</button>
          <button class="tab-btn ${cA}" id="tab-compare"      onclick="switchTab('compare')">Compare</button>
          <button class="tab-btn ${iA}" id="tab-income"       onclick="switchTab('income')">Income</button>
        </div>
        <button class="csv-btn" onclick="exportCSV()">Export CSV</button>
      </div>

      <div class="tab-content ${tA}" id="content-transactions">${importBanner}${transactionsHtml}</div>
      <div class="tab-content ${bA}" id="content-budget">${wishyBanner}${budgetHtml}</div>
      <div class="tab-content ${cA}" id="content-compare">${renderCompareTab()}</div>
      <div class="tab-content ${iA}" id="content-income">${renderIncomeTab()}</div>
    </div>
  `;
}

// ─── View: Income tab ─────────────────────────────────────────────────────────

function renderIncomeTab() {
  const today = toInputDate(new Date());
  const total = state.incomes.reduce((s, i) => s + i.amount, 0);

  const itemsHtml = state.incomes.length
    ? state.incomes.map(i => {
        if (i._id === state.editingIncomeId) {
          return `
            <div class="expense-edit-form">
              <div class="edit-expense-row">
                <input type="text"   id="edit-inc-source-${i._id}" value="${i.source}" placeholder="Source">
                <input type="number" id="edit-inc-amt-${i._id}"    value="${i.amount}" placeholder="Amount">
              </div>
              <div class="edit-expense-row">
                <input type="text" id="edit-inc-note-${i._id}" value="${i.note || ""}" placeholder="Note">
                <input type="date" id="edit-inc-date-${i._id}" value="${toInputDate(i.createdAt)}">
              </div>
              <div class="edit-expense-row">
                <label class="recurring-label">
                  <input type="checkbox" id="edit-inc-rec-${i._id}" ${i.recurring ? "checked" : ""}> Recurring
                </label>
                <div style="display:flex;gap:8px">
                  <button onclick="saveIncomeEdit('${i._id}')">Save</button>
                  <button class="secondary-btn" onclick="cancelIncomeEdit()">Cancel</button>
                </div>
              </div>
            </div>
          `;
        }
        return `
          <div class="expense-item">
            <div class="expense-meta">
              <div class="cat">
                ${i.source}
                ${i.recurring ? `<span class="recurring-badge">recurring</span>` : ""}
              </div>
              ${i.note ? `<div class="note">${i.note}</div>` : ""}
              <div class="date">${fmtDateTime(i.createdAt)}</div>
            </div>
            <div class="expense-right">
              <span class="expense-amount income-amount">${fmt(i.amount)}</span>
              <button class="edit-expense-btn" onclick="state.editingIncomeId='${i._id}'; render()">Edit</button>
              <button class="del-btn" onclick="deleteIncome('${i._id}')">Delete</button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="empty">No income entries yet</div>`;

  const totalRow = state.incomes.length ? `
    <div class="income-total">
      <span>Total Income</span>
      <span class="income-total-val">${fmt(total)}</span>
    </div>
  ` : "";

  return `
    <div class="form-card" style="margin-top:16px">
      <div class="form-row">
        <input type="text"   id="inc-source"    placeholder="Source (e.g. Salary)" onkeydown="if(event.key==='Enter')addIncome()">
        <input type="number" id="inc-amount"    placeholder="Amount (₹)">
        <input type="text"   id="inc-note"      placeholder="Note">
        <input type="date"   id="inc-date"      value="${today}">
        <label class="recurring-label"><input type="checkbox" id="inc-recurring"> Recurring</label>
        <button onclick="addIncome()">Add</button>
      </div>
    </div>
    ${itemsHtml}
    ${totalRow}
  `;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  if (state.token) {
    try {
      state.currentUser = await apiFetch(`${API}/auth/me`).then(r => r.json());
      await loadPlans();
    } catch {
      state.token = null;
      localStorage.removeItem("token");
    }
  }
  render();
})();
