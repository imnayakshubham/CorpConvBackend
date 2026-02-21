/**
 * Standardized API response helpers.
 */

const success = (res, statusCode, message, data = null) => {
  return res.status(statusCode).json({
    status: 'Success',
    message,
    data,
  });
};

const fail = (res, statusCode, message, data = null) => {
  return res.status(statusCode).json({
    status: 'Failed',
    message,
    data,
  });
};

module.exports = { success, fail };
