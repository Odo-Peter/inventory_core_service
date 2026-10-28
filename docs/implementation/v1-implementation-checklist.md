# Inventory Web App — v1 Implementation Checklist

> **Purpose:** Step-by-step checklist for implementing the agreed v1/pilot scope.
>
> **Status:** Planning document. Check an item only after implementation and verification.
>
> **Architecture decisions:** See `docs/architecture/README.md` and ADRs 0001–0016.

## How to use this checklist

- [x] Complete phases in order unless a dependency is explicitly independent.
- [x] Add automated tests as each feature is implemented.
- [x] Keep frontend and backend API changes compatible because they deploy independently.
- [x] Enforce business rules in the backend and database, not just the UI.
- [ ] Do not invent values for unresolved tax, security, hosting, or operational decisions.
- [x] Record material architecture changes in a new ADR before implementing them.
- [x] Keep deferred features out of v1 unless scope is explicitly reconsidered.

---

## Phase 0 — Resolve prerequisites and prepare repositories

### Resolve outstanding decisions

- [ ] Choose the single launch language.
- [ ] Confirm the tax jurisdiction and applicable rules.
- [ ] Define tax-inclusive/exclusive calculation behavior, rounding, and receipt tax presentation.
- [ ] Select managed hosting providers and deployment region for the frontend, backend, and PostgreSQL.
- [ ] Define backup retention, Recovery Point Objective (RPO), and Recovery Time Objective (RTO).
- [ ] Set access-token and refresh-token lifetimes.
- [ ] Define idle and absolute session expiration.
- [ ] Configure PIN failure thresholds, temporary lockout duration, and rate limits.
- [ ] Define CSRF protections and cookie attributes for the chosen deployment topology.
- [ ] Define idempotency-key retention.
- [ ] Confirm legal/accounting record-retention and privacy obligations.
- [ ] Configure stock-count discrepancy thresholds by quantity and/or value.
- [ ] Define POS device registration and identity verification.
- [ ] Define safe handling of active sale finalization during shift closure.
- [ ] Define stock-count lock recovery and cancellation procedures.
- [ ] Define the audited process for resolving an open shift when staff leave or are deactivated.
- [ ] Define Admin workflows for POS terminal and bank-account display configuration.

### Repository preparation

- [x] Create the separate frontend and backend repositories.
- [x] Decide whether architecture documentation lives in a third repository or initially in the backend repository.
- [x] Place ADRs under `docs/architecture/`.
- [x] Create `docs/implementation/v1-implementation-checklist.md`.
- [x] Protect main branches and require pull-request review.
- [x] Add `.env.example` files containing placeholders only.
- [x] Agree on linting, formatting, TypeScript strictness, and pull-request checks.

**Exit criteria:** implementation-blocking decisions are resolved, and repository ownership and development conventions are documented.

---

## Phase 1 — Application foundations and CI

### Backend

- [x] Initialize NestJS with TypeScript.
- [x] Configure linting, formatting, strict type checking, and unit tests.
- [x] Validate environment configuration at application startup.
- [x] Configure structured backend logging.
- [x] Add request/correlation IDs.
- [x] Add application and database health checks.
- [x] Configure PostgreSQL connectivity and Prisma.
- [x] Establish a dedicated database migration workflow.

### Frontend

- [x] Initialize Vite, React, and TypeScript.
- [x] Configure Tailwind CSS and TanStack Query.
- [x] Configure linting, formatting, type checking, and frontend tests.
- [x] Implement reusable loading, empty, validation, network-error, and permission-denied states.

### API and CI/CD

- [x] Establish REST endpoints under `/api/v1`.
- [x] Generate OpenAPI documentation from NestJS.
- [x] Generate frontend API types/client from OpenAPI.
- [x] Ensure the frontend does not import backend source code.
- [x] Run linting, type checks, and unit tests in pull requests.
- [x] Configure integration tests against real PostgreSQL.
- [ ] Configure merge-to-staging deployment.
- [ ] Require explicit approval for production deployment.
- [ ] Document local setup and test commands in each repository.

**Exit criteria:** frontend and backend build independently, and API types can be regenerated from the OpenAPI contract.

---

## Phase 2 — Database foundations, store configuration, and audit

- [x] Use UUID identifiers for business records.
- [x] Store monetary amounts as integer minor units.
- [x] Store timestamps in UTC.
- [x] Configure a store-specific IANA timezone.
- [x] Configure one currency per store.
- [x] Add store-level configuration for tax, tills, and payment methods.
- [x] Add `store_id` to applicable top-level business records.
- [x] Derive store scope from authenticated server context, never from a trusted client-supplied `store_id`.
- [x] Define database constraints, indexes, and foreign keys.
- [ ] Create core models for Store, Staff, Till, Shift, Category, Item, PriceHistory, StockMovement, POSAccount, Sale, SaleItem, Payment, Receipt, and AuditLog.
- [ ] Add supporting records for opening stock, receiving, stock counts, and device registration as needed.
- [x] Implement an append-only audit-writing service.
- [x] Restrict audit-log access to Admins and expose a read-only, page-paginated listing only; Managers and Cashiers cannot read audit entries.
- [x] Ensure audit records never contain PINs, tokens, or secrets.
- [x] Add PostgreSQL integration tests for constraints and persistence.
- [ ] Verify migrations against a fresh database.
- [x] Provide non-production development seed data.

**Exit criteria:** database migrations are reproducible, store isolation is enforced, and audit foundations are tested.

---

## Phase 3 — Staff authentication, roles, sessions, and devices

### Authentication and session management

- [x] Implement staff code/name and 4–6 digit PIN login.
- [x] Store only secure PIN hashes.
- [x] Implement short-lived access JWTs held in frontend memory.
- [ ] Implement rotating refresh tokens using `Secure`, `HttpOnly` cookies.
- [ ] Configure cookie attributes, CORS, and CSRF protection.
- [ ] Implement refresh-token rotation and reuse detection.
- [ ] Support server-side session revocation and logout.
- [x] Implement rate limiting and temporary lockout after repeated failed PIN attempts.
- [x] Audit failed-login, lockout, and unlock events without recording PIN values.
- [ ] Allow authorized Manager/Admin staff to unlock accounts after identity verification.
- [x] Implement Manager/Admin-controlled PIN reset.
- [x] Audit PIN resets and revoke the affected staff member's sessions.

### Roles and staff lifecycle

- [x] Implement Admin, Manager, and Cashier roles.
- [x] Enforce permissions on the backend.
- [x] Test both permitted and forbidden operations for each role.
- [x] Implement staff deactivation, immediate session revocation, and audit logging.
- [x] Preserve historical records when staff are deactivated.
- [x] Implement staff reactivation with audit logging.
- [x] Require fresh authentication after reactivation; keep old sessions revoked.
- [x] Define and implement audited resolution of a departing staff member's open shift.

### POS device access

- [ ] Implement POS device enrollment and backend identity verification.
- [ ] Restrict checkout to the designated POS device.
- [ ] Allow Admins to use a separate device for authorized management and reconciliation.
- [ ] Ensure Admin role alone does not grant checkout authority from another device.
- [ ] Implement controlled device replacement.
- [ ] Revoke the old device's authority immediately.
- [ ] Record old/new device identities, actor, reason, and timestamp.
- [ ] Require safe shift reconciliation before checkout resumes on the replacement.
- [ ] Resolve uncertain sales using their idempotency keys.
- [ ] Test staff switching, session revocation, and device replacement.

**Exit criteria:** authentication, role permissions, session lifecycle, and device authority are enforced server-side.

---

## Phase 4 — Catalog, pricing, and store configuration

- [ ] Implement categories and sellable items.
- [ ] Give each item its own SKU, name, selling price, stock tracking, and optional barcode.
- [ ] Model variants as separate items; do not build a parent/child variant system.
- [ ] Implement barcode scanning and manual item selection.
- [ ] Implement price-change history containing old price, new price, actor, and timestamp.
- [ ] Snapshot unit price and tax details on completed sale items.
- [ ] Implement per-store currency and timezone configuration with permission checks.
- [ ] Implement configurable tax-inclusive or tax-exclusive pricing after tax rules are finalized.
- [ ] Implement payment-method configuration: cash always available, with Admin-controlled card and bank transfer availability.
- [ ] Configure POS terminal and bank-account display details.
- [ ] Implement item deactivation and reactivation.
- [ ] Prevent inactive items from being sold.
- [ ] Prevent silent deletion of referenced catalog records.
- [ ] Implement per-item low-stock thresholds.
- [ ] Exclude items without a threshold from low-stock reporting.
- [ ] Test pricing, permissions, deactivation, and historical price preservation.

**Exit criteria:** catalog changes are authorized and audited, and historical sales remain unchanged after later price changes.

---

## Phase 5 — CSV catalog import/export

- [ ] Provide a downloadable CSV template.
- [ ] Support item name, SKU, optional barcode, price, tax settings, and low-stock threshold.
- [ ] Validate file structure and required fields.
- [ ] Validate numeric values and duplicate SKUs/barcodes.
- [ ] Show a preview of valid rows and row-level errors.
- [ ] Require explicit Admin confirmation before applying an import.
- [ ] Ensure imports never silently create or change stock quantities.
- [ ] Provide catalog CSV export.
- [ ] Audit relevant import/export actions.
- [ ] Test malformed files, duplicates, validation failures, and cancellation.

**Exit criteria:** CSV imports are preview-first, explicitly confirmed, and separate from stock operations.

---

## Phase 6 — Opening stock, receiving, adjustments, and stock counts

### Opening stock

- [ ] Implement a dedicated opening-stock session.
- [ ] Record creator, status, and confirmation timestamp.
- [ ] Allow counted quantities to be entered and reviewed before confirmation.
- [ ] Apply confirmed opening balances and create stock movements atomically.
- [ ] Prevent silent edits after confirmation.
- [ ] Route corrections through normal audited stock adjustments.

### Stock receiving and manual adjustments

- [ ] Implement basic receiving without supplier management or purchase orders.
- [ ] Record received items and quantities.
- [ ] Support optional supplier name, delivery reference, and reason.
- [ ] Implement manual increases, decreases, and corrections.
- [ ] Require a reason category for every manual adjustment; allow optional notes.
- [ ] Record actor, timestamp, quantity, reason, and workflow reference.
- [ ] Update stock and create the corresponding movement atomically.
- [ ] Enforce role permissions and audit sensitive operations.

### Stock counts

- [ ] Implement partial and full stock-count sessions.
- [ ] Record scope explicitly so uncounted items are not treated as zero.
- [ ] Implement states: in progress, ready for review, confirmed, and cancelled.
- [ ] Record physical counts and compare them with expected system quantities.
- [ ] Enforce one active stock-count lock per store.
- [ ] While a count is active, block all stock-changing activity across devices, including sale finalization, receiving, manual adjustments, opening-stock changes, and other count confirmations.
- [ ] Clearly explain the stock-count lock in the UI.
- [ ] Implement threshold-based discrepancy review.
- [ ] Require Manager/Admin review for discrepancies above configured thresholds.
- [ ] Apply no adjustments until required reviews are complete.
- [ ] Revalidate the count before confirmation.
- [ ] Apply approved corrections and movements atomically.
- [ ] Release the lock only after successful confirmation or authorized cancellation.
- [ ] Preserve cancelled sessions and partial counts, with actor and timestamp.
- [ ] Ensure cancelled counts apply no stock changes and cannot be resumed or confirmed.
- [ ] Implement safe recovery for abandoned or failed sessions.
- [ ] Test count locking and concurrent activity across devices.

**Exit criteria:** every stock change is traceable, and count sessions enforce the store-wide freeze and review rules.

---

## Phase 7 — Tills, shifts, and daily closing

- [ ] Implement configurable tills per store.
- [ ] Enforce at most one active shift per till.
- [ ] Allow different tills to operate concurrently.
- [ ] Implement shift opening with an opening cash float.
- [ ] Link sales and relevant actions to staff, shift, till, and store.
- [ ] Calculate expected cash from opening float and cash transactions.
- [ ] Exclude card and bank-transfer payments from physical cash totals.
- [ ] Implement shift closure with counted cash.
- [ ] Calculate and record the cash discrepancy.
- [ ] Require an explanation for discrepancies.
- [ ] Allow closure despite discrepancies and flag them for Manager review.
- [ ] Prevent shift closure while sale finalization is in progress.
- [ ] Test the backend concurrency strategy for sale finalization versus shift closure.
- [ ] Implement cashier handover: outgoing shift closes with a cash count before incoming shift opens.
- [ ] Implement audited Manager/Admin resolution of open shifts for departing staff.
- [ ] Implement daily close review by the store-local business day.
- [ ] Include sales totals by method, cashier, and till.
- [ ] Include shift closures, discrepancies, and inventory exceptions.
- [ ] Record daily-close reviewer and signoff timestamp.
- [ ] Implement controlled reopening by Admin/Manager with a mandatory reason.
- [ ] Preserve original signoff and reopening events.
- [ ] Require a new signoff after reopening and audit any corrections.
- [ ] Test timezone boundaries, discrepancies, concurrent actions, and reopening.

**Exit criteria:** shift cash accountability and daily closing are reproducible from persisted records.

---

## Phase 8 — Sale finalization and manual payments

- [ ] Implement cart and checkout UI with item, quantity, price, and tax breakdown.
- [ ] Validate item status, pricing, tax configuration, stock, staff, shift, till, and store scope on the backend.
- [ ] Reject sales that would reduce stock below zero.
- [ ] Use concurrency-safe stock deductions to prevent overselling.
- [ ] Support exactly one payment method per sale: cash, enabled card, or enabled bank transfer.
- [ ] Validate that the recorded payment matches the entire sale total before marking the sale paid.
- [ ] Exclude split payments, discounts, refunds, voids, and gateway integration from v1.
- [ ] Generate a unique idempotency key for each sale submission.
- [ ] Persist the idempotency key and result consistently with the sale transaction.
- [ ] Return the original sale/receipt for retries with the same key and same payload.
- [ ] Reject reuse of a key with a different payload.
- [ ] Ensure retries cannot duplicate sales, payments, stock deductions, or receipts.
- [ ] Make sale creation, sale-item snapshots, stock updates/movements, payment, paid status, receipt allocation/creation, and relevant audit events atomic.
- [ ] Allocate unique receipt numbers per store transactionally.
- [ ] Never hold a database transaction open while waiting on an external network or payment provider.
- [ ] Show pending/uncertain state after network failures.
- [ ] Never show success before backend confirmation.
- [ ] Support safe retry for uncertain outcomes.
- [ ] Preserve the cart locally where practical without treating an unconfirmed sale as completed.
- [ ] Test duplicate submissions and idempotent retries.
- [ ] Test concurrent sales against limited stock.
- [ ] Test transaction rollback and failures at critical steps.

**Exit criteria:** sale finalization is atomic, retry-safe, and cannot oversell or mark an invalid payment as paid.

---

## Phase 9 — Receipts and operational reports

### Receipts

- [ ] Generate receipt data from server-confirmed sale snapshots.
- [ ] Render print-friendly receipts with the required store, sale, item, price, tax, payment, and receipt information.
- [ ] Align tax presentation with the confirmed jurisdiction rules.
- [ ] Use the browser print dialog.
- [ ] Do not implement direct printer hardware, driver, or automatic printing integration.
- [ ] Allow authorized staff to retrieve and reprint completed receipts.
- [ ] Clearly mark reprints as copies.
- [ ] Preserve original receipt and sale details.
- [ ] Test receipt formatting, permissions, and historical stability.

### Reports

- [ ] Sales totals by date range, payment method, cashier, and till.
- [ ] Shift reconciliation: opening cash, cash sales, expected/counted cash, discrepancy, and review status.
- [ ] Current stock and low-stock items.
- [ ] Stock movement, receiving, adjustment, opening-stock, and count history.
- [ ] Item performance: quantities sold and sales totals by item.
- [ ] Date filters using the store timezone.
- [ ] CSV export where appropriate.
- [ ] Role-based report access and store isolation.
- [ ] Test report totals against known transaction fixtures.

**Exit criteria:** reports reconcile to persisted records, and reprints preserve original sale details.

---

## Phase 10 — Frontend hardening and accessibility

- [ ] Add loading, empty, validation, success, and failure states to critical workflows.
- [ ] Display connectivity status clearly.
- [ ] Explain why sale finalization is blocked when disconnected.
- [ ] Prevent duplicate-clicks where practical; rely on backend idempotency for correctness.
- [ ] Handle authorization errors without exposing protected information.
- [ ] Provide accessible labels, keyboard navigation, visible focus, and sufficient contrast.
- [ ] Ensure status is not communicated by color alone.
- [ ] Verify usability on the designated POS device and separate Admin device.
- [ ] Verify currency, date, and number formatting.
- [ ] Centralize text for the selected launch language.
- [ ] Keep light mode only; dark mode is deferred.
- [ ] Test checkout, receiving, opening stock, counts, shifts, reports, and error states.

**Exit criteria:** critical workflows remain understandable and safe under slow networks, failures, and unauthorized requests.

---

## Phase 11 — Security, integration, and release verification

- [ ] Run all unit, PostgreSQL integration, API end-to-end, and frontend tests.
- [ ] Verify role enforcement and store isolation on the backend.
- [ ] Verify PIN hashing, rate limiting, lockout, reset, and session revocation.
- [ ] Verify refresh-token rotation and reuse detection.
- [ ] Verify secrets and sensitive values are absent from logs and source control.
- [ ] Verify every stock-changing path creates corresponding movement and audit records.
- [ ] Verify sale, payment, receipt, and stock changes are atomic.
- [ ] Verify duplicate requests cannot create duplicate business records.
- [ ] Verify stock-count locking across devices and during concurrent checkout.
- [ ] Verify shift closure cannot race with sale finalization.
- [ ] Verify deactivated staff/items cannot perform new actions.
- [ ] Verify historical records remain accessible to authorized users.
- [ ] Verify CSV imports cannot change stock and require confirmation.
- [ ] Verify daily-close reopening preserves the original signoff and audit history.
- [ ] Run dependency/security checks and resolve launch-blocking findings.
- [ ] Document retention and privacy policies.
- [ ] Configure monitoring, alerting, and operational ownership.
- [ ] Verify automated backups are running.
- [ ] Perform and document a successful restoration test.
- [ ] Verify staging deployment and migrations from a clean baseline.
- [ ] Document rollback and incident-response procedures.
- [ ] Conduct pilot acceptance testing with representative staff and workflows.
- [ ] Obtain explicit production release approval.

**Exit criteria:** release-blocking tests pass, prerequisites are resolved, recovery is demonstrated, and the pilot is approved.

---

## Phase 12 — Pilot monitoring and review

- [ ] Monitor application/database health, error rates, and failed checkout attempts.
- [ ] Review stock-count discrepancies and shift cash discrepancies.
- [ ] Review relevant audit events.
- [ ] Confirm staff understand online-only behavior and uncertain-sale retries.
- [ ] Evaluate operational support and recovery procedures.
- [ ] Collect feedback on checkout, receiving, opening stock, stock counts, shifts, and reports.
- [ ] Prioritize defects without silently expanding scope.
- [ ] Reassess offline cash queue only after pilot validation.
- [ ] Create new ADRs before implementing material architecture changes.

---

## Deferred scope — not part of v1

- [ ] Offline cash queue.
- [ ] Payment gateway integration and webhooks.
- [ ] Split payments.
- [ ] Refunds, voids, and reversals.
- [ ] Discounts and scheduled/promotional pricing.
- [ ] Purchase costs, profit margin, and COGS.
- [ ] Supplier management and purchase orders.
- [ ] Customer accounts/profiles and default collection of customer contact details.
- [ ] Full multi-store switching, administration, and cross-store reporting.
- [ ] Dark mode and additional translated UI.
- [ ] Direct printer hardware/driver integration.
- [ ] Custom permission editor.
- [ ] Automatic purchasing based on low-stock alerts.
- [ ] Advanced tracing and dashboards.

---

## Definition of v1 complete

- [ ] All agreed in-scope workflows are implemented and reviewed.
- [ ] Business rules are enforced in the backend and supported by database constraints where appropriate.
- [ ] PostgreSQL integration and concurrency tests pass.
- [ ] Sales and inventory changes are atomic, auditable, and retry-safe.
- [ ] Role permissions and store isolation are tested.
- [ ] Operational reports reconcile to persisted transactions.
- [ ] Print-friendly receipts and reprints preserve completed sale details.
- [ ] Monitoring, backups, restoration, and rollback procedures are verified.
- [ ] Tax, security, retention, launch language, hosting, and recovery decisions are resolved.
- [ ] Pilot acceptance is recorded.
