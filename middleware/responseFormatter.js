const guestKey = require("../constants/index.js");
const logger = require("../utils/logger.js");

// middleware/responseFormatter.js
function responseFormatter(req, res, next) {
    // Success response helper - supports both 'result' and 'data' for backward compatibility
    res.success = ({
        status = 'Success',
        message = 'Success',
        result = null,
        data = null  // Accept both result and data
    } = {}) => {
        return res.json({
            success: true,           // Frontend expects this flag
            status,
            message,
            result: data || result     // Use data if provided, fallback to result
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
