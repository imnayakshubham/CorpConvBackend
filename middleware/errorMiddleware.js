const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err, req, res, next) => {
  // Errors thrown by middleware (notably body-parser's 413 entity.too.large) carry their own
  // status. Honour it — defaulting these to 500 hides an actionable, client-recoverable error
  // behind a generic "Something went wrong".
  const thrownStatus = err.status || err.statusCode;
  const statusCode = res.statusCode !== 200 ? res.statusCode : (thrownStatus || 500);

  // Log full error to console for debugging
  console.error(err.stack || err.message);

  const isTooLarge = err.type === 'entity.too.large' || statusCode === 413;

  res.status(statusCode).json({
    status: 'Failed',
    // The client keys off this to distinguish "your payload is too big" (actionable) from
    // an opaque server fault. Safe to expose: it reveals nothing about internals.
    ...(isTooLarge ? { error: 'too_large' } : {}),
    message: isTooLarge
      ? 'Request payload too large.'
      : process.env.NODE_ENV === 'production'
        ? 'Something went wrong'
        : err.message,
    data: null,
  });
};

module.exports = { notFound, errorHandler };
