// The response envelope every controller returns.

const ok = (res, data, message, code = 200) => res.status(code).json({ status: 'Success', data, message });
const fail = (res, code, message) => res.status(code).json({ status: 'Failed', data: null, message });

module.exports = { ok, fail };
