import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import fs from 'fs/promises';
import { param, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { FileUpload } from '../models/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Rate limiting for file uploads
const uploadLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 uploads per windowMs
  message: { error: 'Too many file uploads, please try again later.' }
});

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = 'uploads';
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const extension = path.extname(file.originalname);
    const filename = `${uniqueId}${extension}`;
    cb(null, filename);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Maximum 5 files per request
  }
});

// POST /api/upload - Upload files
router.post('/', authenticateToken, uploadLimit, upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    const uploadedFiles = [];

    for (const file of req.files) {
      try {
        // Create file record in database
        const fileUpload = new FileUpload({
          originalName: file.originalname,
          fileName: file.filename,
          mimeType: file.mimetype,
          size: file.size,
          path: file.path,
          encoding: file.encoding,
          fieldName: file.fieldname,
          formId: req.body.formId || null,
          uploadedBy: req.user.user_id, // Associate file with authenticated user
          is_public: false
        });

        // Generate thumbnail for images
        if (file.mimetype.startsWith('image/')) {
          try {
            const thumbnailPath = `uploads/thumb_${file.filename}`;
            await sharp(file.path)
              .resize(200, 200, {
                fit: 'inside',
                withoutEnlargement: true
              })
              .jpeg({ quality: 80 })
              .toFile(thumbnailPath);

            fileUpload.thumbnailPath = thumbnailPath;
            fileUpload.isProcessed = true;
          } catch (thumbnailError) {
            console.error('Error generating thumbnail:', thumbnailError);
          }
        }

        await fileUpload.save();

        uploadedFiles.push({
          id: fileUpload._id,
          originalName: fileUpload.originalName,
          fileName: fileUpload.fileName,
          mimeType: fileUpload.mimeType,
          size: fileUpload.size,
          url: fileUpload.getUrl(),
          thumbnailUrl: fileUpload.thumbnailPath ? `/api/files/thumb/${file.filename}` : null
        });

      } catch (dbError) {
        console.error('Error saving file to database:', dbError);
        // Clean up the uploaded file if database save fails
        try {
          await fs.unlink(file.path);
        } catch (unlinkError) {
          console.error('Error cleaning up file:', unlinkError);
        }
      }
    }

    if (uploadedFiles.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to process uploaded files'
      });
    }

    res.status(201).json({
      success: true,
      data: {
        files: uploadedFiles,
        count: uploadedFiles.length
      },
      message: `${uploadedFiles.length} file(s) uploaded successfully`
    });

  } catch (error) {
    console.error('File upload error:', error);

    // Clean up any uploaded files on error
    if (req.files) {
      for (const file of req.files) {
        try {
          await fs.unlink(file.path);
        } catch (unlinkError) {
          console.error('Error cleaning up file:', unlinkError);
        }
      }
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File size exceeds the 10MB limit'
      });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files. Maximum 5 files allowed per request'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'File upload failed'
    });
  }
});

// GET /api/files/:filename - Serve uploaded files
router.get('/files/:filename', [
  param('filename').isString().withMessage('Invalid filename'),
  handleValidationErrors
], async (req, res) => {
  try {
    const file = await FileUpload.findOne({ fileName: req.params.filename });

    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Check if file exists on disk
    try {
      await fs.access(file.path);
    } catch (accessError) {
      return res.status(404).json({
        success: false,
        error: 'File not found on disk'
      });
    }

    // Increment download count
    file.incrementDownload();

    // Set appropriate headers
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);

    // Send file
    res.sendFile(path.resolve(file.path));

  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to serve file'
    });
  }
});

// GET /api/files/thumb/:filename - Serve thumbnail
router.get('/files/thumb/:filename', [
  param('filename').isString().withMessage('Invalid filename'),
  handleValidationErrors
], async (req, res) => {
  try {
    const file = await FileUpload.findOne({ fileName: req.params.filename });

    if (!file || !file.thumbnailPath) {
      return res.status(404).json({
        success: false,
        error: 'Thumbnail not found'
      });
    }

    // Check if thumbnail exists on disk
    try {
      await fs.access(file.thumbnailPath);
    } catch (accessError) {
      return res.status(404).json({
        success: false,
        error: 'Thumbnail not found on disk'
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

    // Send thumbnail
    res.sendFile(path.resolve(file.thumbnailPath));

  } catch (error) {
    console.error('Error serving thumbnail:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to serve thumbnail'
    });
  }
});

// DELETE /api/files/:id - Delete a file
router.delete('/files/:id', [
  authenticateToken,
  param('id').isMongoId().withMessage('Invalid file ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const file = await FileUpload.findById(req.params._id);

    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Check if user owns the file
    if (file.uploadedBy && file.uploadedBy.toString() !== req.user.user_id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only delete your own files.'
      });
    }

    // Delete file from disk
    try {
      await fs.unlink(file.path);
    } catch (unlinkError) {
      console.error('Error deleting file from disk:', unlinkError);
    }

    // Delete thumbnail if exists
    if (file.thumbnailPath) {
      try {
        await fs.unlink(file.thumbnailPath);
      } catch (unlinkError) {
        console.error('Error deleting thumbnail from disk:', unlinkError);
      }
    }

    // Delete from database
    await FileUpload.findByIdAndDelete(req.params._id);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete file'
    });
  }
});

// GET /api/files - List uploaded files (with pagination)
router.get('/files', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {
      uploadedBy: req.user.user_id // Only show files belonging to the authenticated user
    };
    if (req.query.formId) {
      filter.formId = req.query.formId;
    }
    if (req.query.mimeType) {
      filter.mimeType = new RegExp(req.query.mimeType, 'i');
    }

    const files = await FileUpload.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-path');

    const total = await FileUpload.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        files: files.map(file => ({
          ...file.toObject(),
          url: file.getUrl(),
          thumbnailUrl: file.thumbnailPath ? `/api/files/thumb/${file.fileName}` : null
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch files'
    });
  }
});

export default router;