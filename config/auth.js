// auth.js (CommonJS style)
const { betterAuth } = require("better-auth");
const {
  admin,
  anonymous,
  passkey,
  magicLink
} = require("better-auth/plugins");

const auth = betterAuth({
  // your config here
  plugins: [
    anonymous(),
    admin(),
    anonymous(),
    passkey,
    magicLink(),
  ],
  // other options...
});

// Export in CJS style
module.exports = { auth };
