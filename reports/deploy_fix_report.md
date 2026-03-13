# Deploy Fix Report

Date: 2026-03-13

## Scope
- Repair Linux case-sensitive Admin imports/routes.
- Ensure Railway deploy config file exists for backend service.
- Rebuild frontend and verify backend health.
- Trigger Railway redeploy and validate deployment/runtime logs.

## Changes Applied
- Forced directory case rename to persist on case-sensitive filesystems:
  - `client/src/pages/admin` -> `client/src/pages/Admin_temp` -> `client/src/pages/Admin`
- Updated frontend imports/routes to canonical Admin casing:
  - `client/src/App.jsx`
- Added backend Railway config:
  - `server/railway.toml`

## Local Validation
- Frontend build:
  - Command: `cd client && npm run build`
  - Result: success (`vite build`, `2473 modules transformed`, build complete)
- Backend health:
  - Command: `curl http://localhost:3000/api/health`
  - Result: `200` with `{"ok":true,...}`

## Railway Redeploy Validation
- Triggered deploy:
  - Command: `railway up --service openrange --detach`
  - Deployment ID: `87526b5a-eed3-493c-af9e-e6bab1b33d97`
- Build log status:
  - Previous Linux path failure (`Could not resolve "./pages/Admin/LearningDashboard"`) no longer appears.
  - Vite build now reaches full transform/chunk output without that import error.
- Runtime/deploy log status:
  - `Starting Container`
  - `INFO  Accepting connections at http://localhost:8080`

## Warnings / Follow-up
- Railway build logs for `openrange` still show Nixpacks setup as `nodejs_18, npm-9_x` and `EBADENGINE` warnings for packages requiring Node >=20.
- This indicates runtime pinning to Node 20 is still not being honored for this service path despite the current configuration files.
- Recommended follow-up: explicitly set Node 20 for the `openrange` service build context in Railway service settings (or ensure service root uses the intended config file format/location), then redeploy and verify logs show `setup | nodejs_20`.

## Outcome
- Linux case-sensitivity import issue fixed.
- Admin routes compile and deploy successfully.
- Service redeployed and is accepting connections.
- Node version pinning remains a deploy-environment configuration follow-up.
