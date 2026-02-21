const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  // Log full error to console for debugging
  console.error(err.stack || err.message);

  res.status(statusCode).json({
    status: 'Failed',
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong'
      : err.message,
    data: null,
  });
};

module.exports = { notFound, errorHandler };
