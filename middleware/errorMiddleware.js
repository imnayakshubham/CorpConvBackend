const logger = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const notFound = (req, res, next) => {
  next(new AppError(`Not Found -- ${req.originalUrl}`, 404));
};

const errorHandler = (err, req, res, next) => {
  logger.error(err.message, { stack: err.stack });

  if (res.headersSent) {
    return next(err);
  }

  if (err.status === 429) {
    return res.error({
      status: 'Failed',
      message: 'Rate limit exceeded',
      error: 'Please try again later',
      code: 429,
    });
  }

  if (err.name === 'ValidationError') {
    return res.error({
      status: 'Failed',
      message: 'Validation failed',
      error: err.message,
      code: 400,
    });
  }

  const code = err.statusCode || res.statusCode === 200 ? 500 : res.statusCode;
  console.log(err.message, err)
  return res.status(code).error({
    status: 'Failed',
    message: err.message,
    error: process.env.NODE_ENV === 'production' ? null : err.stack,
    code,
  });
};

module.exports = { notFound, errorHandler, AppError };
