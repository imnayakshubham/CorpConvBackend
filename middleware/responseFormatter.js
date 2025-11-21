const guestKey = require("../constants/index.js");
const logger = require("../utils/logger.js");

// middleware/responseFormatter.js
function responseFormatter(req, res, next) {
    // Success response helper - preserves all properties (data, pagination, etc.)
    res.success = ({
        status = 'Success',
        message = 'Success',
        ...rest  // Capture all other properties (data, pagination, result, etc.)
    } = {}) => {
        return res.json({
            success: true,           // Frontend expects this flag
            status,
            message,
            ...rest                   // Spread all properties to preserve them
        });
    };

    // Error response helper
    res.error = ({
        status = 'Error',
        message = '',
        error = null,
        code = 400
    } = {}) => {
        logger.error(`User: ${req?.user?._id ?? req?.cookie?.[guestKey] ?? "anonymous"} \n Code: ${code}\n Error occurred: ${message}`, { error });
        return res.status(code).json({
            success: false,          // Frontend expects this flag
            status,
            message,
            error,
            result: null               // Consistent with frontend expectations
        });
    };

    next();
}

module.exports = { responseFormatter };
