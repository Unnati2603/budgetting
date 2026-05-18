const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema({
  periodId: { type: mongoose.Schema.Types.ObjectId, ref: "Period" },
  planId:   { type: mongoose.Schema.Types.ObjectId, ref: "Plan" }, // legacy, used for migration
  category: String,
  amount:   Number,
  note:     String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Expense", expenseSchema);
