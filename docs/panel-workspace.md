# Panel workspace

## Navigation and appearance

Customers owns the directory, full Customer 360 workspace, licenses/orders and app suspensions. Monitoring owns live sessions, history and analytics. Support owns feedback and errors. Communication owns announcements. Administration owns panel members and personal settings.

The dark and light themes use neutral surfaces with colored accents. Settings offers a plain background, animated RGB fade, a custom JPG/PNG/WebP image, or an animated network inspired by RazorReaper. Network speed, density, connection distance, intensity and offsets are adjustable. Background motion respects the operating system's reduced-motion preference and pauses in hidden tabs. Images are resized/compressed before browser storage; neither images nor appearance preferences are uploaded to the backend or shared with other members/devices.

## Panel access

The owner manages access from Administration → Panel access. Administrators have all business permissions, Support has customer/support reads and feedback editing, and Read only grants business reads. Only the owner can manage panel members. Individual Allow/Deny overrides can have an expiry; after expiry the underlying role applies again. Denying a section's read permission also denies its write permission. An account expiry or disabled access blocks login and existing sessions.

The server checks current permissions and revocation on every protected request. A same-origin event stream refreshes open panels within approximately two seconds while connected. Ending one session preserves others; ending all sessions invalidates even older tokens which have not yet appeared in the session list. A kick requires a fresh login, while disabling the member also prevents new logins. Changes are audited without passwords or authentication tokens. Owner access cannot be disabled or edited through this screen.

For in-app authentication, the first existing admin by database ID becomes owner. For Cloudflare Access, the first `ACCESS_ADMIN_EMAIL` becomes owner; a single `ACCESS_ALLOWED_EMAIL` works as the existing fallback. Configure an explicit admin email if several Access identities are allowed. The first owner visit to Panel access imports existing accounts, preserving passwords and existing viewer restrictions. It does not modify customer accounts, licenses or RazorReaper app access.

In-app members get a password set by the owner. Cloudflare Access members still need admission through the upstream Access application policy; adding them in the panel does not change that policy. After ending an Access session, use the sign-in link to obtain a fresh Access token.

## Deployment

Ship the frontend and matching Functions/NAS API together. `panel_members`, `panel_sessions` and `panel_audit` are additive tables created automatically on first use, with equivalent definitions in `schema.sql`. Back up the production database before the normal deployment process. No customer data migration is required. Mutable access management requires the configured D1/SQLite database; static Access deployments without a database retain legacy allowlist authentication.

Validation: `npm run check` in the repository, and `npm run build` in `deploy/nas/rr-api`. Permission integration tests use isolated in-memory SQLite and cover live changes, expiry, escalation prevention, session revocation and Access identities.
