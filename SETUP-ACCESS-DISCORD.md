# Access Suspensions + Discord Paid‑Community Gate — Setup

Two features, one license/user database.

1. **Access control** — suspend (timed) or ban (permanent) any user from the desktop app, keyed by
   HWID so it reaches *free* users too, not just license holders. The Access page warns you when the
   user you're about to suspend has a **paid license**.
2. **Discord gate** — only users whose Discord is linked to a valid RazorReaper license get a
   `Verified` role. Two verification paths: the bot's `/verify` command, and an OAuth web flow.

Everything runs on the existing D1 database (`rr_admin_panel`) shared by Pages and the backend
worker. New tables (`access_suspensions`, `discord_links`) self‑heal on first request — no manual
`wrangler d1 execute` needed.

---

## 1. Deploy

- **Admin panel (Pages):** merge `feature/user-suspension-discord` → `main`; Pages auto‑deploys.
- **Bot (Railway):** merge `feature/discord-verify-gate` → `main`; Railway redeploys.
- **Desktop app:** ships the access gate in the next release (polls every 60 s; nothing to configure —
  it already points at `https://rr-admin-panel.pages.dev`).

## 2. Cloudflare Access — add public bypass paths ⚠️ REQUIRED

The whole panel sits behind Cloudflare Access. These new endpoints must be reachable **without**
Access (same as `/api/license/*` and `/api/announcements/active`). In the Access application policy
that bypasses public API paths, add:

```
/api/access/status
/api/discord/verify
/api/discord/status
/api/discord/oauth-start
/api/discord/callback
```

`/api/admin/*` stays gated (those are the admin‑only suspend/lift/list endpoints). If you skip this
step, the desktop app's suspension check and the bot's verification calls will get bounced to the
Access login page instead of a JSON/redirect response.

## 3. Secrets

### Pages (Cloudflare dashboard → Settings → Environment variables, or `wrangler pages secret put`)

| Variable | Needed for | Notes |
|---|---|---|
| `VERIFY_SHARED_SECRET` | `/verify` + `/status` + OAuth state | any long random string; **must match** the bot's value |
| `DISCORD_CLIENT_ID` | OAuth web flow | Discord app → OAuth2 |
| `DISCORD_CLIENT_SECRET` | OAuth web flow | Discord app → OAuth2 |
| `DISCORD_BOT_TOKEN` | OAuth web flow (guilds.join) | same bot token as Railway `TOKEN` |
| `DISCORD_GUILD_ID` | OAuth web flow | your community server id |
| `DISCORD_VERIFIED_ROLE_ID` | OAuth web flow | the `Verified` role id |
| `DISCORD_REDIRECT_URI` | OAuth web flow | `https://rr-admin-panel.pages.dev/api/discord/callback` |

> The `/verify` slash‑command path only needs `VERIFY_SHARED_SECRET` on Pages — the bot grants the
> role itself. The `DISCORD_*` vars are only for the OAuth web flow (stage 2).

### Bot (Railway → Variables)

| Variable | Value |
|---|---|
| `VERIFY_API_BASE` | `https://rr-admin-panel.pages.dev` |
| `VERIFY_SHARED_SECRET` | same value as Pages |
| `VERIFIED_ROLE_ID` | the `Verified` role id |
| `VERIFY_GUILD_ID` | your community server id (optional; defaults to the bot's only guild) |
| `VERIFY_RECONCILE_MINUTES` | optional, default `30` |

If these aren't set, the bot runs exactly as before — the gate stays dormant.

## 4. Discord server + app

1. Create a **`Verified`** role. Move the **bot's** role **above** it (a bot can only assign roles
   below its own highest role).
2. Channel permissions: deny `@everyone` **View Channel** on the real channels; allow **View
   Channel** for `Verified`. Leave one public **`#verify`** channel visible to `@everyone` that
   explains: run `/verify key:XXXX-XXXX-XXXX-XXXX`. Result: an unverified joiner sees only `#verify`
   and can't read releases/updates.
3. Enable the **Server Members Intent** for the bot (Developer Portal → Bot → Privileged Gateway
   Intents) — needed for join detection + reconcile. (Already used by the bot today.)
4. For the OAuth web flow: Developer Portal → OAuth2 → add redirect `…/api/discord/callback`. Scopes
   used by the flow are `identify guilds.join`.

## 5. How it works

**Suspension:** Admin panel → **Access** → find the user → **Suspend** (a warning banner shows if
they have a paid license) → choose *Permanent ban* or *Timed suspend + date* + reason. The desktop
app polls `/api/access/status` by HWID every 60 s and hard‑blocks with a full‑screen notice within
one cycle. **Lift** restores access the same way. Free users are covered because the key is the HWID
(every machine has one), not the license.

**Discord:** Customer buys on SellHub → license created (existing flow). They run `/verify key:…`
(or open the OAuth link) → backend checks the license is active/not‑expired/not‑suspended, records
the `discord_id ↔ license` link, and grants `Verified`. If the license is later revoked/expired or
the user is suspended, the bot's reconcile sweep strips the role within `VERIFY_RECONCILE_MINUTES`.
The OAuth flow additionally *adds* the user straight into the guild via `guilds.join` — no shareable
invite to leak.
