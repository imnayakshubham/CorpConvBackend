// The survey tool catalogue. Spread order IS the catalogue order the model sees and the
// order JSON.stringify feeds into the token-floor estimate — keep these groups in sequence.

module.exports = {
  ...require('./fields'),        // 1–10
  ...require('./structure'),     // 11–16
  ...require('./generate'),      // 17
  ...require('./suggestions'),   // 18
  ...require('./webSearch'),     // 19  ← the only tool with `execute`
};
