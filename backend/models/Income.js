const mongoose = require("mongoose");

const incomeSchema = new mongoose.Schema({
  periodId:  { type: mongoose.Schema.Types.ObjectId, ref: "Period", required: true },
  source:    { type: String, required: true },
  amount:    { type: Number, required: true },
  note:      String,
  recurring: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Income", incomeSchema);
