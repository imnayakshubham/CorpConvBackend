const guestKey = require("../constants/index.js");
const logger = require("../utils/logger.js");

// middleware/responseFormatter.js
function responseFormatter(req, res, next) {
    res.success = ({ status = 'Success', message = 'Success', result = null } = {}) => {
        return res.json({ status, message, result });
    };

    res.error = ({ status = 'Error', message = '', error = null, code = 400 } = {}) => {
        logger.error(`User: ${req?.user?._id ?? req?.cookie?.[guestKey] ?? "anonymous"} \n Code: ${code}\n Error occurred: ${message}`, { error });
        return res.status(code).json({ status, message, error });
    };

    next();
}

module.exports = { responseFormatter };
