const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
    upload,
    uploadSingleFile,
    uploadMultipleFiles,
    deleteFile,
    handleMulterError
} = require("../controllers/uploadController");

const router = express.Router();

// Upload single file for survey field
router.post(
    "/survey-file",
    protect,
    upload.single('file'),
    handleMulterError,
    uploadSingleFile
);

// Upload multiple files for survey field
router.post(
    "/survey-files",
    protect,
    upload.array('files', 5),
    handleMulterError,
    uploadMultipleFiles
);

// Delete uploaded file
router.delete(
    "/survey-file/:filename",
    protect,
    deleteFile
);

module.exports = router;
