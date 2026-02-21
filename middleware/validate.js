/**
 * Validation middleware factory.
 * Validates req.body, req.query, and/or req.params against Zod schemas.
 *
 * @param {{ body?: ZodSchema, query?: ZodSchema, params?: ZodSchema }} schemas
 * @returns Express middleware
 */
const validate = (schemas) => {
  return (req, res, next) => {
    const errors = {};

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        errors.body = formatZodErrors(result.error);
      } else {
        req.body = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        errors.query = formatZodErrors(result.error);
      } else {
        req.query = result.data;
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        errors.params = formatZodErrors(result.error);
      } else {
        req.params = result.data;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        status: 'Failed',
        message: 'Validation failed',
        data: errors,
      });
    }

    next();
  };
};

/**
 * Formats Zod errors into field-level error messages.
 */
const formatZodErrors = (zodError) => {
  const formatted = {};
  for (const issue of zodError.issues) {
    const path = issue.path.join('.') || '_root';
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }
  return formatted;
};

module.exports = validate;
