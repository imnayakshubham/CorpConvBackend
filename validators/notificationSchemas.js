const { z } = require("zod");

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID format");

const notificationIdParam = z.object({
  id: mongoId,
});

const paginationQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .passthrough();

module.exports = { notificationIdParam, paginationQuery };
