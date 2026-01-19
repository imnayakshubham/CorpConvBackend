const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads', 'survey-files');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename: timestamp-random-originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext)
            .replace(/[^a-zA-Z0-9]/g, '_') // Sanitize filename
            .substring(0, 50); // Limit length
        cb(null, `${uniqueSuffix}-${baseName}${ext}`);
    }
});

// File filter for allowed types
const fileFilter = (req, file, cb) => {
    // Allowed file types (can be customized per survey field)
    const allowedMimeTypes = [
        // Images
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        // Documents
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        // Text
        'text/plain',
        'text/csv',
        // Archives
        'application/zip',
        'application/x-rar-compressed',
        // Audio
        'audio/mpeg',
        'audio/wav',
        'audio/ogg',
        // Video
        'video/mp4',
        'video/webm',
        'video/quicktime'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${file.mimetype} is not allowed`), false);
    }
};

// Create multer upload instance
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB default limit
        files: 5 // Max 5 files per request
    }
});

// Upload single file
const uploadSingleFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                status: 'Failed',
                message: 'No file uploaded',
                data: null
            });
        }

        const fileData = {
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            path: `/uploads/survey-files/${req.file.filename}`,
            url: `${process.env.BASE_URL || ''}/uploads/survey-files/${req.file.filename}`
        };

        return res.status(200).json({
            status: 'Success',
            message: 'File uploaded successfully',
            data: fileData
        });
    } catch (error) {
        console.error('Upload error:', error);
        return res.status(500).json({
            status: 'Failed',
            message: error.message || 'Failed to upload file',
            data: null
        });
    }
};

// Upload multiple files
const uploadMultipleFiles = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                status: 'Failed',
                message: 'No files uploaded',
                data: null
            });
        }

        const filesData = req.files.map(file => ({
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            path: `/uploads/survey-files/${file.filename}`,
            url: `${process.env.BASE_URL || ''}/uploads/survey-files/${file.filename}`
        }));

        return res.status(200).json({
            status: 'Success',
            message: 'Files uploaded successfully',
            data: filesData
        });
    } catch (error) {
        console.error('Upload error:', error);
        return res.status(500).json({
            status: 'Failed',
            message: error.message || 'Failed to upload files',
            data: null
        });
    }
};

// Delete file
const deleteFile = async (req, res) => {
    try {
        const { filename } = req.params;

        if (!filename) {
            return res.status(400).json({
                status: 'Failed',
                message: 'Filename is required',
                data: null
            });
        }

        // Sanitize filename to prevent directory traversal
        const sanitizedFilename = path.basename(filename);
        const filePath = path.join(uploadsDir, sanitizedFilename);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                status: 'Failed',
                message: 'File not found',
                data: null
            });
        }

        // Delete the file
        fs.unlinkSync(filePath);

        return res.status(200).json({
            status: 'Success',
            message: 'File deleted successfully',
            data: null
        });
    } catch (error) {
        console.error('Delete error:', error);
        return res.status(500).json({
            status: 'Failed',
            message: error.message || 'Failed to delete file',
            data: null
        });
    }
};

// Middleware to handle multer errors
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                status: 'Failed',
                message: 'File size exceeds the limit (10MB)',
                data: null
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                status: 'Failed',
                message: 'Too many files. Maximum is 5 files per request',
                data: null
            });
        }
        return res.status(400).json({
            status: 'Failed',
            message: err.message,
            data: null
        });
    }
    if (err) {
        return res.status(400).json({
            status: 'Failed',
            message: err.message,
            data: null
        });
    }
    next();
};

module.exports = {
    upload,
    uploadSingleFile,
    uploadMultipleFiles,
    deleteFile,
    handleMulterError
};
