/**
 * Escapes special regex characters from user input to prevent ReDoS attacks.
 * @param {string} str - The user-supplied string to escape.
 * @returns {string} The escaped string safe for use in RegExp.
 */
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

module.exports = escapeRegex;
