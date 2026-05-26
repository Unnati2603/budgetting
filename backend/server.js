const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

dotenv.config();

const Plan    = require("./models/Plan");
const Period  = require("./models/Period");
const Expense = require("./models/Expense");
const Income  = require("./models/Income");
const User    = require("./models/User");
const authMiddleware = require("./middleware/auth");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "90d" });
}

const app = express();
app.use(cors());
app.use(express.json());

// Strip /api prefix added by Vercel routing
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/")) req.url = req.url.slice(4);
  next();
});

// ─── Migration ──────────────────────────────────────────────────────────────
// Converts old plan-scoped expenses into the new plan → period → expense hierarchy.

async function migrate() {
  const plansWithDates = await Plan.find({ startDate: { $exists: true, $ne: null } });

  for (const plan of plansWithDates) {
    // Find or create the period — idempotent
    let period = await Period.findOne({ planId: plan._id });
    if (!period) {
      const label = new Date(plan.endDate).toLocaleDateString("en-IN", {
        month: "long", year: "numeric"
      });
      period = await Period.create({
        planId: plan._id,
        label,
        type: "monthly",
        startDate: plan.startDate,
        endDate: plan.endDate,
      });
    }

    // Always sweep for expenses that still lack periodId (handles partial-migration crashes)
    const { modifiedCount } = await Expense.updateMany(
      { planId: plan._id, periodId: { $exists: false } },
      { periodId: period._id }
    );
    if (modifiedCount) {
      console.log(`Migrated ${modifiedCount} expense(s) → period "${label}"`);
    }
  }
}

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB Connected");
    await migrate();
  })
  .catch(err => console.log(err));

app.get("/", (req, res) => res.send("Budget Tracker API"));

// ─── Auth ─────────────────────────────────────────────────────────────────────

app.get("/auth/config", (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || "" });
});

app.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    let user = await User.findOne({ googleId: payload.sub });
    if (!user) {
      user = await User.findOne({ email: payload.email });
      if (user) {
        user.googleId = payload.sub;
        if (!user.name) user.name = payload.name;
        await user.save();
      } else {
        user = await User.create({ email: payload.email, googleId: payload.sub, name: payload.name });
      }
    }
    // Migrate plans that have no owner to this user
    await Plan.updateMany({ userId: { $exists: false } }, { userId: user._id });
    res.json({ token: signToken(user._id), user: { name: user.name, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(400).json({ error: "Email already registered" });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email: email.toLowerCase(), passwordHash, name: name || email });
    await Plan.updateMany({ userId: { $exists: false } }, { userId: user._id });
    res.status(201).json({ token: signToken(user._id), user: { name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user || !user.passwordHash) return res.status(401).json({ error: "Invalid credentials" });
    if (!await bcrypt.compare(password, user.passwordHash))
      return res.status(401).json({ error: "Invalid credentials" });
    res.json({ token: signToken(user._id), user: { name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-passwordHash");
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json({ name: user.name, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All routes below require a valid JWT
app.use(authMiddleware);

// ─── Plans ───────────────────────────────────────────────────────────────────

app.get("/plans", async (req, res) => {
  try {
    const plans = await Plan.find({ userId: req.userId }).sort({ createdAt: -1 });
    const result = await Promise.all(plans.map(async p => {
      const periodCount = await Period.countDocuments({ planId: p._id });
      return { ...p.toObject(), periodCount };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/plans", async (req, res) => {
  try {
    const plan = await Plan.create({ ...req.body, userId: req.userId });
    res.status(201).json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/plans/:id", async (req, res) => {
  try {
    const { name, salary, categories, carryForward } = req.body;
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      { name, salary, categories, carryForward },
      { new: true, runValidators: true }
    );
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/plans/:id", async (req, res) => {
  try {
    const periods = await Period.find({ planId: req.params.id });
    const periodIds = periods.map(p => p._id);
    await Promise.all([
      Expense.deleteMany({ periodId: { $in: periodIds } }),
      Income.deleteMany({ periodId: { $in: periodIds } }),
    ]);
    await Period.deleteMany({ planId: req.params.id });
    await Plan.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Periods ─────────────────────────────────────────────────────────────────

app.get("/plans/:planId/periods", async (req, res) => {
  try {
    const periods = await Period.find({ planId: req.params.planId }).sort({ startDate: -1 });
    const result = await Promise.all(periods.map(async p => {
      const expenses = await Expense.find({ periodId: p._id });
      const spent = expenses.reduce((s, e) => s + e.amount, 0);
      return { ...p.toObject(), spent };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/plans/:planId/periods", async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.planId);
    const categoryBudgets = plan.categories.map(c => ({ name: c.name, budget: c.budget }));
    const period = await Period.create({ ...req.body, planId: req.params.planId, categoryBudgets });

    // Auto-propagate recurring transactions from the previous period
    const prevPeriod = await Period.findOne({ planId: req.params.planId, _id: { $ne: period._id } })
      .sort({ endDate: -1 });

    if (prevPeriod) {
      const [recExpenses, recIncomes] = await Promise.all([
        Expense.find({ periodId: prevPeriod._id, recurring: true }),
        Income.find({ periodId: prevPeriod._id, recurring: true }),
      ]);
      const ts = new Date(period.startDate).toISOString();
      if (recExpenses.length) {
        await Expense.insertMany(recExpenses.map(e => ({
          periodId: period._id, category: e.category, amount: e.amount,
          note: e.note, recurring: true, createdAt: ts,
        })));
      }
      if (recIncomes.length) {
        await Income.insertMany(recIncomes.map(i => ({
          periodId: period._id, source: i.source, amount: i.amount,
          note: i.note, recurring: true, createdAt: ts,
        })));
      }
    }

    res.status(201).json(period);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/periods/:id", async (req, res) => {
  try {
    await Promise.all([
      Expense.deleteMany({ periodId: req.params.id }),
      Income.deleteMany({ periodId: req.params.id }),
    ]);
    await Period.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Expenses ─────────────────────────────────────────────────────────────────

app.get("/periods/:periodId/expenses", async (req, res) => {
  try {
    const expenses = await Expense.find({ periodId: req.params.periodId }).sort({ createdAt: -1 });
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/periods/:periodId/expenses", async (req, res) => {
  try {
    const expense = await Expense.create({ ...req.body, periodId: req.params.periodId });
    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/expenses/:id", async (req, res) => {
  try {
    const { category, amount, note, createdAt, recurring } = req.body;
    const expense = await Expense.findByIdAndUpdate(
      req.params.id,
      { category, amount, note, createdAt, recurring },
      { new: true }
    );
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/expenses/:id", async (req, res) => {
  try {
    await Expense.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Incomes ──────────────────────────────────────────────────────────────────

app.get("/periods/:periodId/incomes", async (req, res) => {
  try {
    const incomes = await Income.find({ periodId: req.params.periodId }).sort({ createdAt: -1 });
    res.json(incomes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/periods/:periodId/incomes", async (req, res) => {
  try {
    const income = await Income.create({ ...req.body, periodId: req.params.periodId });
    res.status(201).json(income);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/incomes/:id", async (req, res) => {
  try {
    const { source, amount, note, recurring, createdAt } = req.body;
    const income = await Income.findByIdAndUpdate(
      req.params.id,
      { source, amount, note, recurring, createdAt },
      { new: true }
    );
    res.json(income);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/incomes/:id", async (req, res) => {
  try {
    await Income.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Analytics ────────────────────────────────────────────────────────────────

app.get("/plans/:planId/analytics", async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.planId);
    const periods = await Period.find({ planId: req.params.planId }).sort({ startDate: 1 });
    const now = new Date();
    const wishyMap = {};
    const perPeriod = [];
    let totalSpent = 0;

    for (const period of periods) {
      const [expenses, incomes] = await Promise.all([
        Expense.find({ periodId: period._id }),
        Income.find({ periodId: period._id }),
      ]);
      const spent  = expenses.reduce((s, e) => s + e.amount, 0);
      const income = incomes.reduce((s, i) => s + i.amount, 0) || plan.salary;
      perPeriod.push({
        _id: period._id, label: period.label,
        startDate: period.startDate, endDate: period.endDate,
        spent, income, savings: income - spent,
      });
      totalSpent += spent;

      if (!plan.carryForward && new Date(period.endDate) < now) {
        const cats = period.categoryBudgets?.length ? period.categoryBudgets : plan.categories;
        const byCat = {};
        expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
        for (const { name: catName, budget } of cats) {
          const unused = Math.max(0, budget - (byCat[catName] || 0));
          if (unused > 0) wishyMap[catName] = (wishyMap[catName] || 0) + unused;
        }
      }
    }

    const wishySavings = Object.entries(wishyMap)
      .map(([name, accumulated]) => ({ name, accumulated }))
      .sort((a, b) => b.accumulated - a.accumulated);
    const totalWishySaved = wishySavings.reduce((s, w) => s + w.accumulated, 0);

    res.json({
      wishySavings,
      summary: { totalSpent, totalWishySaved, periodCount: periods.length },
      perPeriod,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
