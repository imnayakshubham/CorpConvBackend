# Security Reference — Hushwork Backend

## Security Controls in Place

| Control | File | Notes |
|---|---|---|
| HTTP security headers | `index.js` | Helmet with explicit HSTS, no CSP (API-only) |
| Rate limiting (7 limiters) | `middleware/rateLimiter.js` | Global + per-feature + per-user write + admin |
| Input validation | `middleware/validate.js` | Zod schemas, strips unknown keys |
| Prototype pollution guard | `middleware/validate.js` | `sanitizeBody()` strips `__proto__/constructor/prototype` |
| HTML sanitization | `utils/sanitize.js` | `stripAllHtml`, `sanitizeRichText` |
| Regex injection guard | `utils/sanitize.js` | `escapeRegex` for MongoDB search |
| CORS whitelist | `index.js` | `ALLOW_ORIGIN` env var, blocks unlisted origins |
| httpOnly + Secure cookies | Better Auth config | Session cookies not accessible from JS |
| Auth middleware | `middleware/authMiddleware.js` | JWT verification on protected routes |
| Admin guard | `middleware/superAdminMiddleware.js` | Restricts admin routes to super-admin role |
| Secrets in env only | `.env` / `.gitignore` | No hardcoded credentials |

---

## OWASP API Security Top 10 Coverage

| # | Category | Status | Controls |
|---|---|---|---|
| API1 | Broken Object Level Authorization | Partial | Auth middleware; controller-level ownership checks vary |
| API2 | Broken Authentication | Covered | Better Auth + JWT + httpOnly cookies |
| API3 | Broken Object Property Level Authorization | Covered | Zod `.strict()` schemas + `sanitizeBody()` + `.strip()` on queries |
| API4 | Unrestricted Resource Consumption | Covered | 7 rate limiters with env-configurable limits |
| API5 | Broken Function Level Authorization | Covered | `protect` + `superAdmin` on all privileged routes |
| API6 | Unrestricted Access to Sensitive Business Flows | Partial | `submissionLimiter` on surveys; no bot detection |
| API7 | Server Side Request Forgery | N/A | No outbound requests triggered by user input |
| API8 | Security Misconfiguration | Covered | Explicit Helmet config, no sensitive logs, secrets in env |
| API9 | Improper Inventory Management | N/A | Single-version API |
| API10 | Unsafe Consumption of APIs | Partial | No validation on third-party webhook payloads |

---

## Rate Limit Environment Variables

All limits apply per window (see `middleware/rateLimiter.js` for window sizes).

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_GLOBAL_MAX` | `100` | Max requests per IP per minute (all routes) |
| `RATE_LIMIT_AUTH_MAX` | `10` | Max auth attempts per IP per minute |
| `RATE_LIMIT_UPLOAD_MAX` | `20` | Max uploads per IP per 15 minutes |
| `RATE_LIMIT_SUBMISSION_MAX` | `5` | Max survey submissions per IP per minute |
| `RATE_LIMIT_TRACKING_MAX` | `60` | Max tracking pings per IP per minute |
| `RATE_LIMIT_WRITE_MAX` | `30` | Max write ops per **user** per minute |
| `RATE_LIMIT_ADMIN_MAX` | `20` | Max admin requests per IP per minute |

---

## Secret Rotation Checklist

When rotating secrets, update both the environment and any active sessions/connections:

- [ ] `JWT_SECRET_KEY` — rotate in `.env`; all existing JWT tokens are immediately invalidated
- [ ] `BETTER_AUTH_SECRET` — rotate in `.env`; invalidates all Better Auth sessions
- [ ] `MONGODB_URI` — update connection string; restart server
- [ ] `REDIS_URL` / Upstash credentials — update in `.env`; restart server
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — update in Google Cloud Console + `.env`
- [ ] `CLOUDINARY_*` — update in `.env`; old signed URLs remain valid until expiry

---

## Known Limitations (Out of Scope)

| Limitation | Reason | Mitigation |
|---|---|---|
| Socket.IO events lack per-event auth | Requires client-side changes; socket events are display-only (creation goes through HTTP) | Socket joins require `userData._id`; no data-modifying events are unauthenticated in production flows |
| No CSRF tokens | Would require frontend changes | Mitigated by `SameSite=None; Secure` cookies + CORS whitelist |
| No MFA | Product feature, not a security fix | — |
| In-memory rate store | `rate-limit-redis` not installed | Functional for single-instance; upgrade path documented in `rateLimiter.js` |
| No virus scanning on uploads | External dependency (ClamAV) | File type validation at upload time |
| No validation on `/analytics` query | Controller shape unknown without reading it | TODO: add analytics query schema after auditing controller |
