# Backend middleware and routing refactor

## Structure

- `src/middleware/upload.middleware.js`: one upload implementation, four policies.
- `src/middleware/authenticate.js`: verifies HS256 session cookies and reloads active account roles.
- `src/middleware/authorize.js`: role checks, including the existing super-admin override.
- `src/middleware/course-body.js`: multipart array parsing and existing course validation behavior.
- `src/middleware/error-handler.js`: consistent JSON, upload and server errors.
- `src/routes/scoped-router.js`: selects a controller using authenticated roles; checks operation support before upload/validation.
- Resource routers: dashboard, courses, users, notifications, profile, reports, auth.
- `src/routes/index.js`: canonical routes and compatibility mounts for existing frontend URLs.

Controllers and database procedures retain their business rules. Routing by role does not replace SQL checks of user, department, sector, course or candidate ownership.

## API compatibility

New resource prefixes:
`/api/dashboard`, `/api/courses`, `/api/users`, `/api/notifications`, `/api/profile`, `/api/reports`.

Old URLs remain mounted without HTTP redirects. Existing frontend code can keep using them.
Canonical requests choose the highest supported account role in this order:
SUPER_ADMIN, COURSE_MANAGER, AGENT, DEPARTMENT_MANAGER, EMPLOYEE.
Unsupported operations return 403 rather than falling back to another role.
Legacy role-specific URLs retain their original role behavior, including super-admin access.
There is no new admin personal-profile or notifications implementation: these resources keep the roles supported previously.

## Upload contract

Root: `backend/public/uploads`. Database storage keys and form field names are unchanged.

| Purpose | Directory | Multipart field |
| --- | --- | --- |
| Course attachments/templates | courses | agenda, program, invitationTemplate, attachment, courseFormTemplates |
| Personal passport | profiles | passportFile |
| Filled forms | forms | formFile |
| Administration-issued documents | candidate-attachments | attachmentFile |

Every file is limited to 10 MB. Policies keep PDF/JPEG/PNG, Word for forms/courses, and Excel for courses.
Extensions must match the declared MIME type. This does not inspect file signatures or scan malware.
The three duplicate upload files and role-specific route definitions were removed; their responsibilities moved to these shared files. Git retains the previous versions.

## Verification

From `backend`:

- `npm test`: automated authentication, route/controller dispatch, forbidden-operation and multipart upload tests.
  Database/controller substitutes isolate routing tests; they do not certify stored-procedure write behavior.
- `npm run test:smoke`: read-only HTTP checks using local database accounts for all five roles.
  Requires the existing local environment/database, uses short-lived tokens in memory, and prints no personal data or tokens.
  It starts a temporary server and does not update database records.

From project root: `npm run build`.

## Follow-up scope

- Full controller/service and validator consolidation is a separate phase.
- Existing `/uploads` static serving remains publicly accessible; sensitive-document access needs a dedicated authorization design.
- Frontend production build still warns about the login non-module script; Vite currently lists only login/dashboard entries.
- A full browser journey and write transactions against a disposable database are still needed before claiming complete end-to-end coverage.
