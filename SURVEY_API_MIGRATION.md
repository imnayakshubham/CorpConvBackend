# Survey API Consolidation - Migration Guide

## Overview
All form and survey API functionality has been consolidated into the survey routes and controller. This document outlines the changes and confirms all features are functional.

## Changes Made

### ✅ New Files Created
1. **`/middleware/auth.js`**
   - Purpose: Auth middleware wrapper for compatibility
   - Functions: `authenticateToken`, `optionalAuth`, `admin`, `protect`
   - Maps to existing `authMiddleware.js` functions

### ✅ Enhanced Files
2. **`/controllers/surveyController.js`**
   - Added 5 new controller functions:
     - `duplicateSurvey` - Clone existing surveys
     - `togglePublishStatus` - Publish/unpublish surveys
     - `getSurveyAnalytics` - Get survey analytics data
     - `createFormLimit` - Rate limiting for survey creation (50/day)
     - `submitFormLimit` - Rate limiting for submissions (1/hour)
   - Enhanced `getSurveySubmission` with pagination

3. **`/routes/surveyRoutes.js`**
   - Expanded from 28 to 685 lines
   - Consolidated all features from forms.js
   - Added validation middleware
   - Maintained backward compatibility

### ✅ Archived Files
4. **`/models/Form.js`** → `Form.js.backup`
   - Duplicate model (ES6 format)
   - All functionality in surveyModel.js

5. **`/routes/forms.js`** → `forms.js.backup`
   - All functionality moved to surveyRoutes.js

### ✅ Dependencies Installed
- `express-validator@7.2.1` - For request validation

---

## API Endpoints Reference

### Legacy Endpoints (Backward Compatible)
All existing endpoints continue to work without changes:

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/survey/create-survey` | Required | Create survey (legacy) |
| GET | `/api/survey/survey-list` | Required | List surveys (legacy) |
| PUT | `/api/survey/edit/:id` | Required | Edit survey (legacy) |
| POST | `/api/survey/submission/:id` | Required | Submit survey (legacy) |
| GET | `/api/survey/submissions/:id` | Required | Get submissions (legacy) |

### Standard REST Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/survey/` | Required | List all surveys |
| POST | `/api/survey/` | Required | Create new survey |
| GET | `/api/survey/:id` | Optional | Get survey by ID |
| PUT | `/api/survey/:id` | Required | Update survey |
| DELETE | `/api/survey/:id` | Required | Archive survey |
| POST | `/api/survey/:id/submit` | Optional | Submit response |
| GET | `/api/survey/:id/submissions` | Required | Get submissions |

### Original Routes (from forms.js)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/survey/create` | Required | Create survey |
| GET | `/api/survey/list` | Required | List surveys (with filters) |
| GET | `/api/survey/get/:id` | Required | Get survey by ID |
| PUT | `/api/survey/edit/:id` | Required | Edit survey |
| DELETE | `/api/survey/archive/:id` | Required | Archive survey |
| POST | `/api/survey/submit/:id` | Required | Submit response |
| GET | `/api/survey/submissions/:id` | Required | Get submissions |

### 🆕 New Enhanced Features
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/survey/slug/:slug` | Optional | Get survey by slug (public) |
| POST | `/api/survey/:id/duplicate` | Required | Duplicate a survey |
| PUT | `/api/survey/:id/publish` | Required | Toggle publish status |
| GET | `/api/survey/:id/analytics` | Required | Get survey analytics |
| GET | `/api/survey/:id/verify-ownership` | Required | Verify ownership |

### 🆕 Bulk Operations
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/survey/bulk/delete` | Required | Bulk archive surveys |
| POST | `/api/survey/bulk/update-status` | Required | Bulk update status |

### 🆕 Export/Import
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/survey/:id/export` | Required | Export survey (JSON/CSV) |
| POST | `/api/survey/import` | Required | Import survey |

### 🆕 Templates
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/survey/templates/list` | None | Get survey templates |
| POST | `/api/survey/from-template` | Required | Create from template |

---

## Request/Response Formats

### Create Survey
**Request Body (supports both formats):**
```json
{
  "survey_title": "Customer Feedback",  // or "title"
  "survey_description": "Help us improve",  // or "description"
  "survey_form": [],  // or "fields"
  "status": "draft"  // draft, published, archived
}
```

### Duplicate Survey
**Request:**
```http
POST /api/survey/:id/duplicate
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Survey duplicated successfully",
  "data": { /* survey object */ }
}
```

### Toggle Publish Status
**Request:**
```json
{
  "isPublished": true
}
```

### Get Analytics
**Response:**
```json
{
  "success": true,
  "data": {
    "survey": {
      "id": "...",
      "title": "...",
      "status": "published"
    },
    "analytics": {
      "total_views": 150,
      "total_submissions": 45,
      "conversion_rate": "30.00",
      "submissionsByDay": {
        "2025-01-13": 10,
        "2025-01-14": 15
      },
      "recentSubmissions": []
    }
  }
}
```

### Bulk Delete
**Request:**
```json
{
  "surveyIds": ["id1", "id2", "id3"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "3 surveys archived successfully",
  "data": {
    "modified": 3,
    "requested": 3
  }
}
```

### Bulk Update Status
**Request:**
```json
{
  "surveyIds": ["id1", "id2"],
  "status": "published"
}
```

### Export Survey
**Request:**
```http
GET /api/survey/:id/export?format=json
GET /api/survey/:id/export?format=csv
```

### Import Survey
**Request:**
```json
{
  "surveyData": {
    "survey_title": "Imported Survey",
    "survey_form": [],
    ...
  }
}
```

---

## Validation Rules

### Survey Creation/Update
- `survey_title` or `title`: Required, 3-100 characters
- `survey_description` or `description`: Optional, max 1000 characters
- `survey_form` or `fields`: Optional array
- `status`: Optional, must be 'draft', 'published', or 'archived'

### Survey Submission
- `submissions` or `data`: Required
- `sessionId`: Optional string

### Query Parameters
- `page`: Optional integer, min 1
- `limit`: Optional integer, 1-100
- `status`: Optional, 'draft', 'published', or 'archived'
- `showAll`: Optional boolean
- `search`: Optional string
- `sortBy`: Optional, 'title', 'views', 'submissions', 'created', 'updated'
- `sortOrder`: Optional, 'asc' or 'desc'

---

## Rate Limiting

### Survey Creation
- **Limit:** 50 surveys per 24 hours per user
- **Error Code:** 429
- **Error Message:** "Rate limit exceeded. Maximum 50 surveys per day."

### Survey Submission
- **Limit:** 1 submission per hour per survey per user
- **Error Code:** 429
- **Error Message:** "You have already submitted this survey recently. Please try again later."

### Configuration
Set in environment variables:
```env
MAX_SURVEYS_PER_DAY=50  # Default: 50
```

---

## Authentication

### Required Authentication
- All create, update, delete operations
- Listing surveys
- Getting submissions
- Analytics endpoints
- Bulk operations
- Export/Import

### Optional Authentication (Public Access)
- Getting survey by ID or slug
- Submitting survey responses (if survey is public)

### Middleware Usage
```javascript
// Required auth
authenticateToken  // or protect

// Optional auth (for public forms)
optionalAuth
```

---

## Error Handling

### Standard Error Response Format
```json
{
  "success": false,
  "error": "Error message",
  "details": []  // validation errors if applicable
}
```

### Common Error Codes
- `400` - Validation error
- `401` - Unauthorized (no token or invalid token)
- `403` - Forbidden (not owner)
- `404` - Survey not found
- `429` - Rate limit exceeded
- `500` - Server error

---

## Testing Checklist

### ✅ Legacy Endpoints
- [x] POST `/create-survey` works
- [x] GET `/survey-list` works
- [x] PUT `/edit/:id` works
- [x] POST `/submission/:id` works
- [x] GET `/submissions/:id` works

### ✅ RESTful Endpoints
- [x] GET `/` (list) works
- [x] POST `/` (create) works
- [x] GET `/:id` works
- [x] PUT `/:id` works
- [x] DELETE `/:id` works
- [x] POST `/:id/submit` works
- [x] GET `/:id/submissions` works

### ✅ New Features
- [x] Duplicate survey
- [x] Toggle publish status
- [x] Get analytics
- [x] Verify ownership
- [x] Bulk delete
- [x] Bulk update status
- [x] Export (JSON/CSV)
- [x] Import
- [x] Get templates
- [x] Create from template

### ✅ Validation
- [x] Title length validation
- [x] Description length validation
- [x] Status enum validation
- [x] MongoDB ID validation
- [x] Query parameter validation

### ✅ Rate Limiting
- [x] Survey creation limit (50/day)
- [x] Submission limit (1/hour per survey)

### ✅ Authentication
- [x] Protected endpoints require token
- [x] Public endpoints work without token
- [x] Ownership verification works
- [x] Optional auth works

---

## Migration Steps (No Breaking Changes)

### For Existing Frontend Code
**No changes required!** All existing API calls continue to work.

### To Use New Features
Update frontend to call new endpoints:

```javascript
// Duplicate survey
POST /api/survey/:id/duplicate

// Toggle publish
PUT /api/survey/:id/publish
body: { isPublished: true }

// Get analytics
GET /api/survey/:id/analytics

// Bulk operations
POST /api/survey/bulk/delete
body: { surveyIds: [...] }

// Export
GET /api/survey/:id/export?format=json

// Import
POST /api/survey/import
body: { surveyData: {...} }
```

---

## Rollback Procedure (If Needed)

If issues arise, restore from backups:

```bash
# Restore forms.js routes
mv routes/forms.js.backup routes/forms.js

# Restore Form.js model (if needed)
mv models/Form.js.backup models/Form.js

# Remove new files
rm middleware/auth.js

# Restore original surveyController.js (from git history)
git checkout HEAD~1 -- controllers/surveyController.js

# Restore original surveyRoutes.js (from git history)
git checkout HEAD~1 -- routes/surveyRoutes.js

# Register forms.js in index.js
# Add: app.use('/api/forms', require('./routes/forms'));

# Restart server
npm run dev
```

---

## Support

### File Locations
- Routes: `/backend/routes/surveyRoutes.js`
- Controller: `/backend/controllers/surveyController.js`
- Model: `/backend/models/surveyModel.js`
- Auth Middleware: `/backend/middleware/auth.js`
- Main Middleware: `/backend/middleware/authMiddleware.js`

### Backup Files
- `/backend/routes/forms.js.backup`
- `/backend/models/Form.js.backup`

### Dependencies
- express-validator@7.2.1

---

## Summary

✅ **All functionality preserved**
✅ **No breaking changes**
✅ **15+ new endpoints added**
✅ **Code consolidated and organized**
✅ **Backward compatible**
✅ **Production ready**

The survey/form API is now fully consolidated, with all features in one place while maintaining complete backward compatibility.
