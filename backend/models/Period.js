const mongoose = require("mongoose");

const periodSchema = new mongoose.Schema({
  planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
  label: String,
  type: { type: String, enum: ["monthly", "weekly", "yearly", "custom"], default: "monthly" },
  startDate: { type: Date, required: true },
  endDate:   { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Period", periodSchema);
