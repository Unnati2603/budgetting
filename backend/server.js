const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const Plan    = require("./models/Plan");
const Period  = require("./models/Period");
const Expense = require("./models/Expense");

const app = express();
app.use(cors());
app.use(express.json());

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

// ─── Plans ───────────────────────────────────────────────────────────────────

app.get("/plans", async (req, res) => {
  try {
    const plans = await Plan.find().sort({ createdAt: -1 });
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
    const plan = await Plan.create(req.body);
    res.status(201).json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/plans/:id", async (req, res) => {
  try {
    const { name, salary, categories } = req.body;
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      { name, salary, categories },
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
    await Expense.deleteMany({ periodId: { $in: periodIds } });
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
    const period = await Period.create({ ...req.body, planId: req.params.planId });
    res.status(201).json(period);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/periods/:id", async (req, res) => {
  try {
    await Expense.deleteMany({ periodId: req.params.id });
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
