# Endpoint and role access map

Generated from `docs/api/openapi.json` (file modified 2026-11-14T15:26:33.699Z, newer than the latest controller change) and the global auth/roles guards; role map generated 2026-11-14T15:27:11.850Z.

**Endpoint count:** 60 operations in this map and 60 operations in `openapi.json`.

## 1. Role model

Roles: `cashier`, `manager`, `admin`.

**Hierarchy: inclusive.** `ROLE_RANK` assigns cashier=0, manager=1, admin=2 (`src/modules/auth/principal.ts:10-14`). `RolesGuard` resolves the required rank as the minimum rank among the `@Roles` values, then allows the request when the caller rank is greater than or equal to that minimum (`src/modules/auth/guards/roles.guard.ts:67-75`). Therefore `@Roles('cashier')` means cashier, manager, and admin; `@Roles('manager')` means manager and admin; `@Roles('admin')` means admin only. Method-level metadata overrides class-level metadata through `Reflector.getAllAndOverride` (`roles.guard.ts:33-36`).

**Routes without `@Roles`:** they are denied by default, not public and not merely authenticated. The global guards are registered in this order: `AuthGuard` then `RolesGuard` (`src/modules/auth/auth.module.ts:64-65`). `@Public()` sets `IS_PUBLIC_KEY` and both guards short-circuit to allow the request (`auth.guard.ts:27-32`, `roles.guard.ts:23-31`). For a non-public route with no role metadata, `RolesGuard` throws `403 insufficient_role` ("Route has no role requirement") even when the token is valid (`roles.guard.ts:38-44`). There are no registered non-public, authenticated-only routes: every mounted non-public route has `@Roles`.

**Deny override:** `@DenyRoles` is checked before rank comparison and denies the named role even when the hierarchy would allow it (`roles.guard.ts:53-65`). It is used only for admin on shift clock-in/clock-out.

**Effective access summary**

- **cashier:** read catalog, store, POS accounts, sales, shifts and receipts; run their own shift and sales; no management writes.
- **manager:** cashier access plus item/category/price, inventory, POS account, staff reset/unlock (cashiers only), shift list/force-close (cashier shifts only). No admin-only store, category create/update, staff create/update/deactivate, item deactivate, reconciliation or audit access.
- **admin:** every route except clock-in/clock-out (explicitly denied). Can create sales only if an open shift already exists for the admin, which the API does not provide.

## 2. Endpoints

### App — `AppController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1` | public | public | none |  | Root hello endpoint. |

### Health — `HealthController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/health/live` | public | public | none |  | Liveness probe; version-neutral. |
| GET | `/health/ready` | public | public | none |  | Readiness probe, including database ping; version-neutral. |
| GET | `/health` | public | public | none |  | Alias of the readiness probe; version-neutral. |

### auth — `AuthController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | public | public | none | Log in with a staff code and PIN | Throttled per IP and per staff_code. Returns access_token and staff. |
| POST | `/api/v1/auth/logout` | cashier | cashier, manager, admin | Bearer | Log out and revoke all tokens | Allowed while must_change_pin. Revokes all tokens (token_version++). |
| GET | `/api/v1/auth/me` | cashier | cashier, manager, admin | Bearer | Get the current staff member | Blocked while must_change_pin (403 pin_change_required). active_shift_id is always null for admins. |
| POST | `/api/v1/auth/change-pin` | cashier | cashier, manager, admin | Bearer | Change the current staff PIN | Allowed while must_change_pin. Returns LoginResponseDto with a new token and increments token_version. |

### audit — `AuditController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/audit-logs` | admin | admin | Bearer | List audit log entries for the current store | Store-scoped; no per-record role filtering. |
| GET | `/api/v1/audit-logs/actions` | admin | admin | Bearer | List the known audit actions | Static list of known audit actions. |

### staff — `UsersController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/staff` | manager | manager, admin | Bearer | List staff in the current store | Lists staff in the caller store. |
| POST | `/api/v1/staff` | admin | admin | Bearer | Create a staff member with a temporary PIN | Creates a staff member with a temporary PIN; must_change_pin is true. |
| GET | `/api/v1/staff/{id}` | manager | manager, admin | Bearer | Get a staff member | Store-scoped; no per-record role filtering. |
| PATCH | `/api/v1/staff/{id}` | admin | admin | Bearer | Update a staff profile or role | Cannot change own role; role change needs no open shift; promotion from cashier sets must_change_pin; last active admin is protected. |
| POST | `/api/v1/staff/{id}/deactivate` | admin | admin | Bearer | Deactivate a staff member | Cannot deactivate self or the last active admin; revokes target tokens (token_version++). |
| POST | `/api/v1/staff/{id}/reactivate` | admin | admin | Bearer | Reactivate a staff member | Reactivates a deactivated staff member. |
| POST | `/api/v1/staff/{id}/reset-pin` | manager | manager, admin | Bearer | Reset a staff PIN with the caller PIN | Manager may target cashiers only; admin may target any other staff; self is blocked. Sets must_change_pin and revokes target tokens. |
| POST | `/api/v1/staff/{id}/unlock` | manager | manager, admin | Bearer | Unlock a staff account | Manager may target cashiers only; admin may target any other staff; self is blocked. Revokes target tokens. |

### stores — `StoresController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/stores/current` | cashier | cashier, manager, admin | Bearer | Get the current store |  |
| PATCH | `/api/v1/stores/current` | admin | admin | Bearer | Update editable store details |  |

### shifts — `ShiftsController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/shifts/clock-in` | cashier | cashier, manager | Bearer | Open a shift | Admin is denied by @DenyRoles (403 forbidden). Opens the caller own shift. |
| POST | `/api/v1/shifts/clock-out` | cashier | cashier, manager | Bearer | Close your open shift | Admin is denied by @DenyRoles (403 forbidden). Closes the caller own shift only. |
| GET | `/api/v1/shifts/current` | cashier | cashier, manager, admin | Bearer | Get your open shift | Returns ShiftResponseDto or null. |
| GET | `/api/v1/shifts` | manager | manager, admin | Bearer | List shifts | Lists shifts in the caller store. |
| POST | `/api/v1/shifts/{id}/force-close` | manager | manager, admin | Bearer | Force-close an open shift | Manager may force-close cashier shifts only; admin may force-close any open store shift. |

### Catalog — categories (`CategoriesController`)

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/categories` | cashier | cashier, manager, admin | Bearer | List categories |  |
| POST | `/api/v1/categories` | admin | admin | Bearer | Create a category |  |
| GET | `/api/v1/categories/{id}` | cashier | cashier, manager, admin | Bearer | Get a category |  |
| PATCH | `/api/v1/categories/{id}` | admin | admin | Bearer | Update a category |  |

### Catalog — items (`ItemsController`)

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/items` | cashier | cashier, manager, admin | Bearer | List catalog items | cashier responses omit cost_price; manager/admin responses include it. |
| POST | `/api/v1/items` | manager | manager, admin | Bearer | Create a catalog item with zero stock and an optional image (SKU is generated) | Creates an item with zero stock; optional multipart image. |
| GET | `/api/v1/items/units` | cashier | cashier, manager, admin | Bearer | List item units dropdowns |  |
| GET | `/api/v1/items/barcode/{barcode}` | cashier | cashier, manager, admin | Bearer | Look up an item by exact barcode | Store-scoped exact barcode lookup. cashier responses omit cost_price. |
| GET | `/api/v1/items/{id}` | cashier | cashier, manager, admin | Bearer | Get a catalog item | cashier responses omit cost_price; manager/admin responses include it. |
| PATCH | `/api/v1/items/{id}` | manager | manager, admin | Bearer | Update catalog item details (not price or stock) | Changing active requires admin even though manager can call the route (403 forbidden). |
| GET | `/api/v1/items/{id}/price-history` | cashier | cashier, manager, admin | Bearer | List price history for an item |  |
| POST | `/api/v1/items/{id}/price` | manager | manager, admin | Bearer | Change an item price |  |
| POST | `/api/v1/items/{id}/deactivate` | admin | admin | Bearer | Deactivate a catalog item | Admin-only shortcut; active changes via PATCH also require admin. |

### Catalog — item images (`ItemImagesController`)

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| PUT | `/api/v1/items/{id}/image` | manager | manager, admin | Bearer | Upload or replace an item image | Multipart image upload or replacement; returns image_key and thumb/full variants. |
| DELETE | `/api/v1/items/{id}/image` | manager | manager, admin | Bearer | Remove an item image (idempotent) | Idempotent removal; variants is null when no image remains. |

### Inventory — `InventoryController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/inventory/items/{id}/initial` | manager | manager, admin | Bearer | Record opening stock once for an item | Opening stock can be recorded once per item. |
| POST | `/api/v1/inventory/items/{id}/receive` | manager | manager, admin | Bearer | Receive stock for an item |  |
| POST | `/api/v1/inventory/items/{id}/adjust` | manager | manager, admin | Bearer | Adjust stock by a signed quantity |  |
| POST | `/api/v1/inventory/items/{id}/damage` | manager | manager, admin | Bearer | Record damaged stock |  |
| GET | `/api/v1/inventory/items/{id}/movements` | manager | manager, admin | Bearer | List stock movements for an item |  |
| GET | `/api/v1/inventory/items/{id}/stock-status` | manager | manager, admin | Bearer | Whether opening stock is still allowed for an item (read-only) | Read-only; reports whether opening stock is still allowed. |
| GET | `/api/v1/inventory/reconciliation` | admin | admin | Bearer | Detect stock cache drift (read-only) | Method-level admin overrides the class-level manager requirement. |
| GET | `/api/v1/inventory/movements` | manager | manager, admin | Bearer | List stock movements across the store | Store-wide movement list. |

### POS Accounts — `PosAccountsController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/pos-accounts` | cashier | cashier, manager, admin | Bearer | List POS accounts |  |
| POST | `/api/v1/pos-accounts` | manager | manager, admin | Bearer | Create a POS account |  |
| GET | `/api/v1/pos-accounts/{id}` | cashier | cashier, manager, admin | Bearer | Get a POS account |  |
| PATCH | `/api/v1/pos-accounts/{id}` | manager | manager, admin | Bearer | Update a POS account |  |
| POST | `/api/v1/pos-accounts/{id}/deactivate` | manager | manager, admin | Bearer | Deactivate a POS account |  |

### Sales — `SalesController`

| Method | Path | Min role | Effective roles | Auth | Summary | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/sales` | cashier | cashier, manager, admin | Bearer | Record a completed sale and its payment | Requires the caller own open shift; admins are allowed by the decorator but cannot clock in. Server computes totals and deducts stock. |
| GET | `/api/v1/sales` | cashier | cashier, manager, admin | Bearer | List completed sales | cashier sees own sales only; manager/admin see the whole store and may filter staff_id. |
| GET | `/api/v1/sales/payment-options` | cashier | cashier, manager, admin | Bearer | List enabled payment methods and accounts | card and bank_transfer are omitted when no active account exists. |
| GET | `/api/v1/sales/summary` | cashier | cashier, manager, admin | Bearer | Summarise sales in a date range or shift | cashier summary is scoped to own sales only. |
| GET | `/api/v1/sales/overview` | cashier | cashier, manager, admin | Bearer | Get the dashboard sales overview | cashier sees own sales only; manager/admin see the whole store. Local days use the store timezone. |
| GET | `/api/v1/sales/{id}` | cashier | cashier, manager, admin | Bearer | Get a completed sale | cashier gets 404 sale_not_found for another cashier sale. |
| POST | `/api/v1/sales/{id}/receipt-prints` | cashier | cashier, manager, admin | Bearer | Record a receipt print or reprint | cashier can print own sales only; first print is_copy=false, later prints is_copy=true. |

## 3. Role-dependent behavior inside allowed endpoints

| Endpoint | Role | Behavior | Source |
| --- | --- | --- | --- |
| `GET /items` | cashier | cost_price is omitted from item responses; manager and admin responses include it. | `src/modules/catalog/item.mapper.ts:41-43` |
| `GET /items/{id}` | cashier | cost_price is omitted from the item response; manager and admin responses include it. | `src/modules/catalog/item.mapper.ts:41-43` |
| `GET /items/barcode/{barcode}` | cashier | cost_price is omitted from the item response; manager and admin responses include it. | `src/modules/catalog/item.mapper.ts:41-43` |
| `PATCH /items/{id}` | manager | Changing active is rejected with 403 forbidden; admins may change active. Different active value triggers the check. | `src/modules/catalog/items.service.ts:264-270` |
| `GET /sales` | cashier | List is forced to the caller staff_id. Managers/admins see all store sales and may filter by staff_id. | `src/modules/sales/sales.service.ts:533-537` |
| `GET /sales/summary` | cashier | Summary aggregates only the caller own sales. Managers/admins aggregate the whole store. | `src/modules/sales/sales.service.ts:533-537` |
| `GET /sales/overview` | cashier | Overview aggregates only the caller own sales. Managers/admins aggregate the whole store. Local days use the store timezone. | `src/modules/sales/sales.service.ts:381-466` |
| `GET /sales/{id}` | cashier | A sale owned by another cashier is returned as 404 sale_not_found. Managers/admins can read any store sale. | `src/modules/sales/sales.service.ts:479-481` |
| `POST /sales/{id}/receipt-prints` | cashier | Printing another cashier sale is returned as 404 sale_not_found. Managers/admins can print any store sale. | `src/modules/sales/sales.service.ts:479-481` |
| `POST /shifts/clock-in` | admin | Denied with 403 forbidden by @DenyRoles and the service guard; cashier and manager may clock in. | `src/modules/shifts/shifts.controller.ts:41-44; src/modules/shifts/shifts.service.ts:356-362` |
| `POST /shifts/clock-out` | admin | Denied with 403 forbidden by @DenyRoles and the service guard; cashier and manager may clock out. | `src/modules/shifts/shifts.controller.ts:55-58; src/modules/shifts/shifts.service.ts:356-362` |
| `POST /shifts/{id}/force-close` | manager | Managers may force-close only shifts whose staff member is a cashier. Admins may force-close any open shift in the store. | `src/modules/shifts/shifts.service.ts:263-295` |
| `PATCH /staff/{id}` | admin | An admin cannot change their own role (403 forbidden). Promotion from cashier to manager/admin sets must_change_pin; last active admin is protected. | `src/modules/users/users.service.ts:132-142, 526-549` |
| `POST /staff/{id}/deactivate` | admin | An admin cannot deactivate themself (403 forbidden) or the last active admin (409 last_admin). | `src/modules/users/users.service.ts:249-257, 526-549` |
| `POST /staff/{id}/reset-pin` | manager | Managers may target cashiers only; admins may target any other staff member; self is blocked with 403 forbidden. | `src/modules/users/users.service.ts:457-481` |
| `POST /staff/{id}/unlock` | manager | Managers may target cashiers only; admins may target any other staff member; self is blocked with 403 forbidden. | `src/modules/users/users.service.ts:457-481` |
| `GET /auth/me` | admin | active_shift_id is always null for admins; cashier/manager receive their open shift id or null. | `src/modules/auth/auth.service.ts:196-210` |

Confirmed examples:

- `cost_price` is hidden for cashiers and included for managers/admins in every item response (`src/modules/catalog/item.mapper.ts:41-43`).
- `PATCH /items/:id` changing `active` requires admin even though the route's minimum role is manager (`src/modules/catalog/items.service.ts:264-270`).
- Sales history, summaries, overview, detail and receipt printing are scoped to the cashier's own sales; managers/admins see the store (`src/modules/sales/sales.service.ts:479-481, 533-537`).
- Staff: managers may reset PIN or unlock cashiers only; admins may act on other staff; self-service is blocked for these actions. Deactivation protects the last active admin.
- Shifts: managers may force-close cashier shifts only; admins may force-close any open shift but cannot clock in/out.
- Audit: route-level admin only; no per-record role filtering.
- POS accounts: route-level only. Reads are cashier+, writes are manager+; there is no service-level per-record role check.

## 4. `/auth/me` and session behavior

### Response shape — `MeResponseDto`

| Field | Type | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | string | no | Staff ID. |
| `name` | string | no | Computed from first and last name. |
| `first_name` | string | no | |
| `last_name` | string | no | |
| `role` | `cashier\|manager\|admin` | no | Current database role. |
| `store_id` | string | no | Current store. |
| `must_change_pin` | boolean | no | Forces the PIN-change flow. |
| `active_shift_id` | string (UUID) | yes | Caller open shift; always null for admins. |

The DTO/OpenAPI do not expose `staff_code`, although the service currently returns it at runtime. See Open questions.

### Invalid or expired token

- Missing bearer token: `401 unauthorized` ("Missing bearer token").
- Malformed, invalid, expired, wrong issuer/audience or incomplete claims: `401 unauthorized` ("Invalid or expired token") from `TokenService.verify` (`src/modules/auth/token.service.ts:60-81`).
- Staff missing, store mismatch, or token_version mismatch: `401 unauthorized`.
- Deactivated account when the token_version still matches: `401 account_deactivated`; login for a deactivated account returns `403 account_deactivated`.

### When `must_change_pin` is true

`AuthGuard` rejects every non-public request that is not annotated with `@AllowPinChange` using `403 pin_change_required` (`src/modules/auth/guards/auth.guard.ts:73-80`). The routes that still work are:

- Public routes: `POST /api/v1/auth/login`, `GET /api/v1`, and the three health routes.
- `POST /api/v1/auth/logout` (annotated `@AllowPinChange`).
- `POST /api/v1/auth/change-pin` (annotated `@AllowPinChange`).

`GET /api/v1/auth/me` is **not** allowed until the PIN is changed.

### Role change, deactivation and token invalidation

- **Logout:** increments `token_version`; the old token gets `401 unauthorized` (`src/modules/auth/auth.service.ts:157-162`).
- **Change PIN:** increments `token_version` and returns a new token; old tokens get `401 unauthorized` (`src/modules/auth/auth.service.ts:236-261`).
- **Deactivate:** sets `active=false` and increments `token_version`. The next request with an old token gets `401 unauthorized` because the version check runs before the active check (`src/modules/auth/guards/auth.guard.ts:61-71`; `src/modules/users/users.service.ts:282-288`).
- **Reset PIN / unlock:** increments the target's `token_version`; old target tokens get `401 unauthorized` (`src/modules/users/users.service.ts:365-374, 414-421`).
- **Role change:** does **not** increment `token_version`. `AuthGuard` reloads the role from the database on every request, so the new role takes effect immediately, but the old token remains valid. Promotion from cashier to manager/admin also sets `must_change_pin=true` (`src/modules/users/users.service.ts:164-171`). Demotion does not revoke the token.

## 5. Open questions

- DevicesController exists but DevicesModule is not imported, so /api/v1/devices is absent from OpenAPI. It also has no @Public/@Roles; if mounted, RolesGuard would deny every authenticated call with 403 insufficient_role.
- POST /sales is available to admin via the inclusive hierarchy, but admins cannot clock in (@DenyRoles on shift clock-in). The required own open shift is therefore not obtainable through the API for an admin.
- AuthService.toAuthStaff returns staff_code from GET /auth/me, but MeResponseDto and OpenAPI omit it. Confirm the intended response contract.
- PATCH /staff/{id} role changes do not increment token_version. Authorization uses the freshly loaded database role, so the new role takes effect immediately, but the old token remains valid. Confirm whether role changes should revoke tokens.
- OpenAPI renders MeResponseDto.active_shift_id as a nullable object rather than string|null; the DTO declares string|null.
