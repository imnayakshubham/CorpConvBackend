import express from 'express';
import { query, body, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

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

// Demo options endpoint - provides sample data for form field options
router.get('/demo-options', [
  query('format').optional().isIn(['array', 'object-array', 'object']).withMessage('Invalid format'),
  handleValidationErrors
], (req, res) => {
  const format = req.query.format || 'array';

  if (format === 'array') {
    return res.json(['Apple', 'Banana', 'Cherry']);
  }

  if (format === 'object-array') {
    return res.json([
      { value: 'apple', label: 'Apple' },
      { value: 'banana', label: 'Banana' },
      { value: 'cherry', label: 'Cherry' },
    ]);
  }

  if (format === 'object') {
    return res.json({
      options: [
        { value: 'apple', label: 'Apple' },
        { value: 'banana', label: 'Banana' },
        { value: 'cherry', label: 'Cherry' },
      ],
    });
  }

  return res.json(['Apple', 'Banana', 'Cherry']);
});

// Google Fonts endpoint - provides Google Fonts list
router.get('/google-fonts', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_FONTS_API_KEY;

    if (!apiKey) {
      // Return curated list of popular fonts when API key is not available
      return res.json({
        kind: 'webfonts#webfontList',
        items: [
          {
            family: 'Inter',
            category: 'sans-serif',
            variants: ['400', '500', '600', '700'],
            subsets: ['latin'],
            version: 'v12',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Roboto',
            category: 'sans-serif',
            variants: ['300', '400', '500', '700'],
            subsets: ['latin'],
            version: 'v30',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Open Sans',
            category: 'sans-serif',
            variants: ['400', '600', '700'],
            subsets: ['latin'],
            version: 'v34',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Lato',
            category: 'sans-serif',
            variants: ['400', '700'],
            subsets: ['latin'],
            version: 'v23',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Montserrat',
            category: 'sans-serif',
            variants: ['400', '500', '600', '700'],
            subsets: ['latin'],
            version: 'v25',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Poppins',
            category: 'sans-serif',
            variants: ['400', '500', '600', '700'],
            subsets: ['latin'],
            version: 'v20',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Source Sans Pro',
            category: 'sans-serif',
            variants: ['400', '600', '700'],
            subsets: ['latin'],
            version: 'v21',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Oswald',
            category: 'sans-serif',
            variants: ['400', '500', '600'],
            subsets: ['latin'],
            version: 'v49',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Raleway',
            category: 'sans-serif',
            variants: ['400', '500', '600', '700'],
            subsets: ['latin'],
            version: 'v28',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'PT Sans',
            category: 'sans-serif',
            variants: ['400', '700'],
            subsets: ['latin'],
            version: 'v17',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Nunito',
            category: 'sans-serif',
            variants: ['400', '600', '700'],
            subsets: ['latin'],
            version: 'v25',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Ubuntu',
            category: 'sans-serif',
            variants: ['300', '400', '500', '700'],
            subsets: ['latin'],
            version: 'v15',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Work Sans',
            category: 'sans-serif',
            variants: ['400', '500', '600'],
            subsets: ['latin'],
            version: 'v18',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          // Serif fonts
          {
            family: 'Playfair Display',
            category: 'serif',
            variants: ['400', '500', '600', '700'],
            subsets: ['latin'],
            version: 'v30',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Merriweather',
            category: 'serif',
            variants: ['400', '700'],
            subsets: ['latin'],
            version: 'v30',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'Lora',
            category: 'serif',
            variants: ['400', '500', '600', '700'],
            subsets: ['latin'],
            version: 'v32',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          // Monospace fonts
          {
            family: 'Fira Code',
            category: 'monospace',
            variants: ['400', '500', '700'],
            subsets: ['latin'],
            version: 'v14',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          {
            family: 'JetBrains Mono',
            category: 'monospace',
            variants: ['400', '500', '700'],
            subsets: ['latin'],
            version: 'v13',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
          // Display fonts
          {
            family: 'Bebas Neue',
            category: 'display',
            variants: ['400'],
            subsets: ['latin'],
            version: 'v9',
            lastModified: '2022-09-22',
            files: {},
            kind: 'webfonts#webfont',
            menu: '',
          },
        ],
      });
    }

    // If API key is available, fetch from Google Fonts API
    const url = `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&sort=popularity`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Google Fonts API error: ${response.status}`);
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error('Error fetching Google Fonts:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch fonts'
    });
  }
});

// File refresh URLs endpoint - refresh signed URLs for uploaded files
router.post('/files/refresh-urls', [
  authenticateToken,
  body('filePaths').isArray().withMessage('filePaths must be an array'),
  body('expiresIn').optional().isInt({ min: 1 }).withMessage('expiresIn must be a positive integer'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { filePaths, expiresIn = 86400 } = req.body; // 24 hours default

    if (!filePaths || !Array.isArray(filePaths)) {
      return res.status(400).json({
        success: false,
        error: 'filePaths array is required'
      });
    }

    // TODO: Implement actual signed URL refresh logic
    // This would typically involve:
    // 1. Validating that the user has access to these files
    // 2. Generating new signed URLs from cloud storage (AWS S3, Google Cloud, etc.)
    // 3. Returning the refreshed URLs

    // For now, return mock signed URLs
    const signedUrls = {};
    filePaths.forEach(filePath => {
      // Generate a mock signed URL (in production, this would be from your storage provider)
      signedUrls[filePath] = `https://storage.example.com/${filePath}?expires=${Date.now() + (expiresIn * 1000)}&signature=mock-signature`;
    });

    return res.json({
      success: true,
      signedUrls,
      expiresIn,
      message: 'URLs refreshed successfully'
    });

  } catch (error) {
    console.error('Refresh URLs error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh URLs'
    });
  }
});

// Health check endpoint for utilities
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'utilities',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      demoOptions: '/demo-options',
      googleFonts: '/google-fonts',
      fileRefreshUrls: '/files/refresh-urls'
    }
  });
});

export default router;