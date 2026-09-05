# Customer accounts

RazorReaper customers create or sign in to an account with Discord from **My account** in the Windows app. The same verified Discord ID selects the same account on every installation. Display names and cropped profile pictures are stored in the NAS SQLite database and shown in Customer Directory, Session History, Live Sessions and Customer 360. Existing license and suspension checks remain independent and continue to apply.

## Sign-in boundary

- Every app request requires the existing per-install P-256 signature, including signup, polling, profile reads, edits and sign-out. A hardware ID or shared telemetry key cannot access an account.
- A ten-minute login request opens a browser page with a code that must match the app. Browser consent is protected with an HttpOnly, Secure, SameSite cookie and an origin check. A random OAuth state is stored hashed and consumed once.
- Discord provides identity through authorization-code OAuth with the `identify` scope. The existing Discord client and registered callback are reused. Provider access tokens are not persisted or returned to the app.
- The app displays the verified profile and requires **Continue as …** before associating the installation. Only the signed requesting installation can claim that request, once.
- Account sessions last 90 days. Sign-out expires only that installation's session; its historical profile association remains visible to support. Revoking the install key denies further account operations. Logging in with another Discord account replaces this installation's association.

## Profile images and panel access

The Windows app decodes PNG/JPEG/WebP files up to 8 MB and 4096 × 4096 pixels, crops the center to 256 × 256, and re-encodes WebP without original metadata. The API accepts bounded raster data URLs only; arbitrary URLs, SVG and identity edits are rejected. Panel image reads require customer or monitoring permission. There is no public customer directory or public avatar endpoint.

## Deployment

Deploy the NAS API and panel together before releasing the Windows app. New tables are created idempotently alongside the existing schema. No existing tables or licenses are rewritten. Include the live SQLite database in the deployment backup; the new tables and uploaded pictures are covered by the regular NAS database backup.

App endpoints live below `/api/discord/account/`, using the existing public Discord route family. The registered callback remains `/api/discord/callback`. `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_REDIRECT_URI` must be present in the API environment. See the [Discord OAuth documentation](https://docs.discord.com/developers/topics/oauth2).

Tests exercise signatures, browser binding, one-time claims, expiration, revocation, cross-device profile sharing, image validation and sign-out. The Windows tests cover link validation, confirmation, failure handling and raster conversion. A real Discord consent remains interactive in the customer's browser.
