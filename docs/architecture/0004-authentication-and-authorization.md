# ADR 0004: Staff Authentication and Authorization

- **Status:** Accepted (interim token-storage design; see "Future improvements")
- **Date:** 2026-10-25
- **Supersedes:** the 2026-10-24 version (rotating refresh-token cookie, session families, reuse detection)

## Context

The app is used in a shared-store environment with PIN login, multiple roles, and separate POS/admin devices. The pilot has one store and a small number of staff. The previous revision of this ADR required rotating refresh tokens, reuse detection and a persisted session model. That is the right long-term design but is more machinery than the pilot needs, and it depended on cookie and domain decisions that are not settled. For the pilot, the owner chose a simpler model: the backend issues a JWT on successful login and the client keeps it in `localStorage`.

`localStorage` is readable by any script running on the page, so an XSS flaw would expose the token. This ADR accepts that risk for the pilot and limits it with a short list of mandatory mitigations (below), plus server-side checks that make revocation immediate despite stateless tokens.

## Decision

### 1. Login and token issuance

- Staff authenticate with `staff_code` + a 4–6 digit PIN via `POST /api/v1/auth/login`. Name-based selection is a UI convenience only; the API never exposes an unauthenticated list of staff. If a name picker is wanted, decide it together with ADR 0016 (device model).
- Login flow order: resolve store, find staff by `store_id` + `staff_code` (if missing do timing-equalized dummy verification and record `loginFailed` with reason `unknown_staff_code` then throw generic `invalid_credentials`), check lockout (`423 account_locked`), **verify PIN before revealing deactivation**. If PIN is wrong record failure via `PinAttemptService` and throw generic `invalid_credentials` (same as today). If PIN is correct and `staff.active === false`, do **not** issue a token and do **not** reset `failed_pin_attempts` or `locked_until`; record an `auth.login_failed` audit with `details: { staff_code, reason: 'account_deactivated' }` and throw `AppException(403, 'account_deactivated', 'Your account has been deactivated. Contact an administrator.')`. Unknown/wrong-PIN behavior remains indistinguishable for probing safety.
- On success the response body contains:
  ```json
  {
    "access_token": "<jwt>",
    "token_type": "Bearer",
    "expires_in": 28800,
    "staff": {
      "id": "...",
      "name": "...",
      "role": "cashier",
      "store_id": "...",
      "must_change_pin": false
    }
  }
  ```
- No refresh token and no cookies are used. When the token expires the user logs in again with their PIN. There is no silent refresh.
- The client sends the token as `Authorization: Bearer <jwt>`.

### 2. JWT format

- Signed with HS256. The verifier pins the algorithm; `alg: none` and algorithm switching are rejected.
- The signing secret is at least 256 bits of random data from the secret store or environment (`JWT_SECRET`). It is never committed, and the app fails to start without it.
- Claims: `sub` (staff id), `store_id`, `tv` (token version, see §4), `iat`, `exp`, `iss`, `aud`, `jti`. **No role claim and no PIN-related data.**
- Lifetime (`JWT_ACCESS_TTL`) is configurable. Starting value: **8 hours**, roughly one shift. Because there is no refresh, a longer lifetime means a longer exposure if the token is stolen; shorten it if shifts allow.

### 3. Per-request verification (stateless token, stateful check)

A global `AuthGuard` runs on every route (deny by default). Routes opt out only with `@Public()` (login, health). For each request it:

1. Verifies signature, `exp`, `iss`, `aud`.
2. Loads the `Staff` row by primary key **and** `store_id` from the token (one indexed lookup).
3. Rejects with `401` if the staff member is missing, `staff.store_id !== claims.store_id`, `staff.token_version !== tv`, or `staff.active === false`. When `staff.active` is false the guard throws `AppException(401, 'account_deactivated', 'Your account has been deactivated. Contact an administrator.')`; for missing staff or token version mismatch the existing `unauthorized` / `Invalid or revoked token` response is used.
4. Builds the request principal `{ staff_id, store_id, role }` with the **role read from the database**, so role changes and deactivation take effect immediately. The guard selects `id, store_id, role, active, token_version, must_change_pin` in one query (no extra round trip). Public routes use `@Public()` as before. No `@AllowInactive()` bypass exists. Enforcement is at the auth boundary (not via Prisma middleware/extensions) so admin/audit/history can still read inactive records.

`store_id` for every query comes from this principal, never from request input (ADR 0005). A second guard enforces `@Roles(...)` (see §6).

### 4. Revocation

- `Staff.token_version` (integer) is embedded in each token as `tv`. Incrementing it invalidates every outstanding token for that staff member at the next request.
- It is incremented on: logout, PIN reset or change, deactivation, forced unlock/lock actions by an admin, and any security-motivated revocation.
- Consequence: revocation is per staff member, not per device. Logging out on one device logs that staff member out everywhere. This is acceptable in v1 because a staff member has at most one open shift (Phase 1 constraint).
- `POST /api/v1/auth/logout` increments `token_version`. The client also clears its stored token.

### 5. PIN handling, lockout and rate limiting

- Store only an **argon2id** hash of the PIN, combined with a server-side pepper (`PIN_PEPPER`, kept outside the database). PINs are never retrievable or displayed.
- Reject weak PINs (all-same digits, simple ascending/descending runs). Changing a PIN requires the current PIN.
- PIN length: 4–6 digits for Cashier; **6 digits for Manager and Admin**.
- Failed attempts: the counter is incremented atomically (single `UPDATE ... RETURNING`), so parallel guesses cannot exceed the threshold. Successful login resets it.
- Lockout is configurable. Starting values, to be confirmed by the owner:

  | Setting              | Starting value                                                          |
  | -------------------- | ----------------------------------------------------------------------- |
  | Failures before lock | 5                                                                       |
  | Lock duration        | 5 min, then 15 min, then 60 min on repeated lockouts                    |
  | Login throttle       | 10 requests/min per IP and 5/min per `staff_code` (`@nestjs/throttler`) |

- Unknown `staff_code` and wrong PIN return the same `401 invalid_credentials` and take the same time (verify against a dummy hash when the code is unknown). A locked account returns `423 account_locked` with a retry-after value.
- Manager/Admin can unlock a staff member after **re-entering their own PIN** as identity verification. A Manager may unlock or reset only Cashiers.
- PIN reset by Manager/Admin issues a temporary PIN shown once to the resetter, sets `must_change_pin = true`, resets the failed-attempt counter, increments `token_version`, and is audited. While `must_change_pin` is true, the only permitted calls are change-PIN and logout.

### 6. Roles and authorization

- Roles: **Admin**, **Manager**, **Cashier** (enum values `admin`, `manager`, `cashier`; the previous `staff` value is renamed to `cashier`).
- Permissions are fixed per role, with no per-user overrides. Higher roles include the permissions of lower ones unless stated otherwise.
- Authorization is enforced in the backend with `@Roles('manager')` meaning "manager or above". Every route carries an explicit decorator or `@Public()`; a route with neither is rejected at startup or in tests.

| Capability                                                 | Cashier | Manager | Admin |
| ---------------------------------------------------------- | :-----: | :-----: | :---: |
| Create sales, record payments, view own sales and receipts |    ✔    |    ✔    |   ✔   |
| Start or normally close own shift                          |    ✔    |    ✔    |       |
| Force-close a cashier shift                                |         |    ✔    |   ✔   |
| Force-close a manager shift                                |         |         |   ✔   |
| Force-close a legacy admin shift                           |         |         |   ✔   |
| View all sales, shifts and shift summaries                 |         |    ✔    |   ✔   |
| Stock receiving and adjustments                            |         |    ✔    |   ✔   |
| Approve discounts and refunds †                            |         |    ✔    |   ✔   |
| Reset PIN / unlock Cashiers                                |         |    ✔    |   ✔   |
| Reset PIN / unlock Managers                                |         |         |   ✔   |
| Catalog management (items, categories)                     |         |         |   ✔   |
| Price changes ‡                                            |         |         |   ✔   |
| POS terminal and bank account setup †                      |         |    ✔    |   ✔   |
| Staff management, roles, permissions                       |         |         |   ✔   |
| Store settings, reports, audit log                         |         |         |   ✔   |

† Taken from the build plan; not stated in the previous ADR. ‡ **Conflict:** this ADR (previous revision) gives pricing to Admin, while the build plan says managers can edit prices. The table follows the ADR; confirm before implementing Phase 2.

Additional rules:

- Shift start and normal close are limited to Cashier and Manager for their own shift; Admins cannot start or normally close a shift. The force-close tiers are defined in ADR 0010.
- Audit log browsing is Admin-only. `GET /api/v1/audit-logs` and `GET /api/v1/audit-logs/actions` are read-only, store-scoped, and return no write operations.
- A staff member's role cannot change while they have an open shift (`409 staff_has_open_shift`); close the shift first. This prevents an open shift from becoming unclosable by normal means.
- Nobody changes their own role or deactivates themselves.
- The last active Admin cannot be deactivated or demoted.
- Approvals (discounts, refunds, unlocks) record both the requesting and approving staff ids in the audit log.

### 7. Account lifecycle

- **Deactivation is soft delete (deactivated = deleted from the user's point of view).** `UsersService.deactivate` sets `active = false` and increments `token_version` (and records `staff.deactivated`). No hard deletes of staff rows; shifts, audit logs, and sales remain linked. An admin can restore via `reactivate`.
- **Reactivation** sets `active = true`, clears `failed_pin_attempts` and `locked_until` (does not change `must_change_pin`), and records `staff.reactivated`. It does not revive old tokens (the version was already incremented); the person must log in again.
- **Staff leaving with an open shift:** deactivation returns `409` until a Manager or Admin force-closes the shift through an audited workflow (records who closed it, why, and the counted cash if available). The shift is never silently discarded.
- **Auth enforcement:** all protected endpoints are covered at the auth boundary (guard/strategy) rejecting missing/invalid `store_id`, stale `token_version`, or `active === false`. `GET /api/v1/auth/me` is defensively protected as well. `AuthService.login` enforces deactivation only after successful PIN verification (to avoid account enumeration). 
- **Restricted operations on inactive staff:** `resetPin`, `update`, and `unlock` on an inactive staff member throw `AppException(409, 'staff_inactive', 'Reactivate this staff member first')`. Staff code generation counts inactive staff (codes are never reused). The staff list continues to return inactive staff. No Prisma middleware/extension hides inactive staff (admin/audit/shift history need them).
- **Error codes:** guard/inactive auth rejection → `401` `account_deactivated`; login with correct PIN on deactivated account → `403` `account_deactivated`; management actions on inactive target → `409` `staff_inactive`. Token version mismatch/missing/invalid → existing `401` `unauthorized` behavior retained.
- Shared tills: switching staff is a logout followed by a fresh PIN login. The client auto-locks after an idle period (configurable, starting at 10 minutes) by clearing the stored token and showing the PIN screen. The cart stays local per ADR 0003.

### 8. Client rules for the stored token

All token access goes through a single `tokenStore` module (`get`, `set`, `clear`), so the storage mechanism can change in one place.

- Key: `pos.access_token`. Never put the token in URLs, query strings, logs, error reports or analytics.
- Clear the token on logout, on any `401`, and on idle lock.
- Mandatory XSS mitigations, treated as release blockers:
  - A strict Content Security Policy: no inline scripts, `script-src 'self'`, no third-party script hosts, `frame-ancestors 'none'`. Start in report-only mode in staging, then enforce.
  - No `dangerouslySetInnerHTML` (or equivalent) with unsanitised content.
  - No third-party scripts or tag managers on the app origin.
  - Locked dependencies, `npm audit` in CI, and review of any new frontend dependency.
- The frontend decodes nothing security-relevant from the token. It learns role and identity from the login response and `GET /api/v1/auth/me`.
- If a token expires during an uncertain payment (ADR 0003), the user logs in again and the app resumes with the **same** `Idempotency-Key` and checks the sale by `client_ref`.

### 9. Transport and browser security

- HTTPS only, HSTS enabled, Helmet enabled on the API.
- CORS uses an explicit origin allowlist per environment, no wildcard. Cookies are not used, so `credentials` stays disabled.
- Because authentication is by `Authorization` header rather than cookies, classic CSRF does not apply. If cookies are introduced later, CSRF protection becomes mandatory (see below).

### 10. Auditing

Every action below writes an `AuditLog` row (never containing PINs, hashes, tokens or the pepper):

`auth.login_succeeded`, `auth.login_failed`, `auth.account_locked`, `auth.unlocked`, `auth.logout`, `auth.pin_changed`, `auth.pin_reset`, `auth.tokens_revoked`, `staff.created`, `staff.updated`, `staff.role_changed`, `staff.deactivated`, `staff.reactivated`, `shift.force_closed`.

## Required data-model changes (update the Phase 1 doc)

| Change                                                                                        | Reason                    |
| --------------------------------------------------------------------------------------------- | ------------------------- |
| `StaffRole` value `staff` → `cashier`                                                         | Match this ADR            |
| `Staff.token_version Int @default(0)`                                                         | Revocation (§4)           |
| `Staff.must_change_pin Boolean @default(false)`                                               | Temporary PIN flow (§5)   |
| `Shift.closed_by_staff_id String?` and `Shift.close_reason` (e.g. normal / forced / handover) | Audited forced close (§7) |

No session table is introduced in this revision.

## Alternatives considered

- **Short-lived access token in memory + rotating refresh token in an HttpOnly cookie** (previous revision): stronger against XSS, but needs a session table, reuse detection, CSRF protection and a settled cookie/domain layout. Deferred; see below.
- **Opaque server-side sessions:** simplest revocation and per-device control, at the cost of a database lookup per request and a session table. A candidate for the future design.
- **`sessionStorage` instead of `localStorage`:** the token disappears when the tab closes. Equally exposed to XSS. Not chosen by the owner for v1, but it is a one-line change inside `tokenStore`.
- **Role claim inside the JWT:** rejected, because role changes and deactivation would not apply until expiry.

## Consequences

- An XSS vulnerability could expose a valid token for up to its lifetime (revocable earlier through `token_version`). The CSP and dependency rules in §8 are therefore part of the definition of done for the frontend.
- Every authenticated request costs one primary-key lookup on `Staff`. That is acceptable at pilot scale and is what makes deactivation immediate.
- Users re-enter their PIN when the token expires or the till auto-locks.
- Revocation is per staff member, not per device or per token.
- Configuration values (`JWT_SECRET`, `JWT_ACCESS_TTL`, `PIN_PEPPER`, lockout and throttle settings, idle timeout) must be set before launch and documented in the deployment ADR (0013).

## Future improvements

Revisit this ADR when any trigger below occurs: before Phase 10 (multi-store), before any third-party script is added to the app, after a security review, or if the pilot shop uses shared or unattended devices more heavily than expected.

1. **Move tokens out of `localStorage`.** Keep a short-lived access token in memory and add a rotating refresh token in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie scoped to the auth path. This removes token theft by XSS from the persistent store. Because `tokenStore` is the only place that touches storage, the frontend change is contained.
2. **Add a `Session` table** (hashed refresh token, previous-token hash, absolute and idle expiry, revoked reason, IP/user agent). This gives per-device logout, reuse detection with session-family revocation, and a "where am I logged in" view. A short grace window on rotation is needed so lost-response retries (ADR 0003) are not flagged as theft.
3. **Shorten the access token** to about 10–15 minutes once refresh exists, with a session absolute lifetime near one shift and an idle timeout.
4. **Fix the cookie domain layout.** Prefer sibling subdomains (`app.` and `api.` on one registrable domain) so `SameSite=Strict` works; cross-site Vercel-to-VPS cookies are fragile. Add an `Origin` check and a required custom header on refresh and logout as CSRF defence.
5. **Step-up PIN for sensitive actions.** Discount and refund approvals and unlocks should require the approver to enter their own PIN with the action instead of relying on an existing session.
6. **Asymmetric signing with key IDs** (`kid`, EdDSA or RS256) and a rotation procedure, so key changes do not log everyone out and secrets do not need sharing between services.
7. **Device binding and registration** (ADR 0016): restrict POS and admin functions to known devices and add a device claim.
8. **Harden the browser:** Trusted Types, Subresource Integrity for any external asset, CSP reporting to monitoring (ADR 0014).
9. **Security signals:** login history, alerts on repeated lockouts or unusual-hours logins, per-staff session view.
10. **Owner accounts (Phase 10):** email login with MFA or SSO, separate from counter PIN login.
11. **Per-token revocation list** (a `jti` denylist) as a lighter alternative to sessions if only single-token revocation is needed.

## Migration path

The API contract stays additive under `/api/v1` (ADR 0003): refresh and session endpoints can be added without breaking the Bearer-token contract the pilot uses. The login response keeps `access_token`; moving to cookies changes only how the refresh token travels and where the client keeps the access token.
