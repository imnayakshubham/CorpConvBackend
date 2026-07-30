// The litmus tool catalogue. Spread order IS the catalogue order the model sees.
// No tool here has an `execute` — every mutation goes through the client Apply gate.

module.exports = {
  ...require('./questions'),     // 1–4
  ...require('./details'),       // 5
  ...require('./suggestions'),   // 6
};
