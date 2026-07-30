// The companion tool catalogue. Spread order IS the catalogue order the model sees.
// No tool here has an `execute` — every mutation goes through the client Apply gate.

module.exports = {
  ...require('./capture'),     // 1–3
  ...require('./tasks'),       // 4–6
  ...require('./direction'),   // 7–9
};
