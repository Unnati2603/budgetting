const mongoose = require("mongoose");

const planSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  salary:     { type: Number, required: true },
  categories: [{ name: String, budget: Number }],
  carryForward: { type: Boolean, default: false },
  // legacy fields kept for migration only — not used by new plans
  startDate:  Date,
  endDate:    Date,
  createdAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model("Plan", planSchema);
