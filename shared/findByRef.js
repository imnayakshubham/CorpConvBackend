// URLs use the slug; older links still use the id. Accept either.
//
// Returns a query builder so callers can chain .select() / .lean(). Works for any model
// with a `slug` and an `access` soft-delete flag.

const isMongoId = (ref) => /^[a-fA-F0-9]{24}$/.test(ref || '');

const findByRef = (Model, ref) => Model.findOne({
    $or: isMongoId(ref) ? [{ _id: ref }, { slug: ref }] : [{ slug: ref }],
    access: true,
});

module.exports = { findByRef, isMongoId };
