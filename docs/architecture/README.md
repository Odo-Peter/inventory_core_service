# Inventory Web App — Architecture Decision Records

This directory contains the agreed architecture decisions for the Inventory Web App. Decisions are split by concern so they can be reviewed and revised independently.

## Status convention
- **Accepted** — selected for the v1/pilot unless an explicit prerequisite below remains unresolved.
- **Proposed / prerequisite** — direction is agreed, but implementation must wait for a named product, legal, operational, or security detail.

## ADR index

| ADR | Topic | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Backend architecture | Accepted |
| [0002](0002-stack-and-repositories.md) | Technology stack and repository boundaries | Accepted |
| [0003](0003-online-only-and-api-contract.md) | Connectivity and API contract | Accepted |
| [0004](0004-authentication-and-authorization.md) | Authentication, sessions, and roles | Accepted; security values TBD |
| [0005](0005-data-model-and-store-scope.md) | Data conventions and store isolation | Accepted |
| [0006](0006-transaction-integrity-and-idempotency.md) | Transaction integrity and retry safety | Accepted |
| [0007](0007-inventory-and-stock-controls.md) | Inventory movements, counts, and stock enforcement | Accepted |
| [0008](0008-sales-pricing-and-tax.md) | Sales, pricing, tax, and currency | Accepted; tax rules TBD |
| [0009](0009-payments-and-receipts.md) | Payment recording and receipts | Accepted |
| [0010](0010-shifts-tills-and-daily-close.md) | Tills, shifts, and daily close | Accepted |
| [0011](0011-audit-and-record-retention.md) | Auditability and retention | Accepted; compliance retention TBD |
| [0012](0012-testing-and-quality.md) | Testing strategy | Accepted |
| [0013](0013-deployment-ci-cd-and-recovery.md) | Deployment, migrations, backups, and recovery | Accepted; provider/RPO/RTO TBD |
| [0014](0014-monitoring-and-operations.md) | Monitoring and operational safety | Accepted |
| [0015](0015-v1-scope-boundaries.md) | Explicit v1 scope boundaries | Accepted |
| [0016](0016-device-model-and-access.md) | POS device and remote admin access | Accepted; registration mechanics need design |

## Implementation prerequisites / unresolved decisions

Do not silently invent values for these items. Resolve them before the affected feature is implemented or before production launch, as appropriate.

1. **Launch language** — choose the single v1 language.
2. **Tax rules** — confirm jurisdiction, applicable tax rules, tax-inclusive/exclusive calculation details, rounding method, and receipt presentation.
3. **Hosting** — choose frontend, backend, and managed PostgreSQL providers and deployment region.
4. **Recovery objectives** — define backup retention, Recovery Point Objective (RPO), and Recovery Time Objective (RTO) after provider comparison.
5. **Security configuration** — set access-token and refresh-token lifetimes, idle/absolute session expiry, PIN failure threshold and lockout duration, rate limits, CSRF strategy, cookie settings, and idempotency-key retention.
6. **Compliance retention** — confirm statutory/accounting retention and privacy obligations for sales, receipts, stock movements, shifts, and audit events.
7. **Stock-count thresholds** — configure quantity/value thresholds that require Manager/Admin review.
8. **Operational workflows** — specify safe resolution of an active sale during shift closure, stock-count lock recovery, and manager/admin resolution of an open shift for a deactivated/leaving staff member.
9. **Device registration** — define how the dedicated POS device is registered and how its identity/authority is verified. The agreed outcome is controlled replacement and immediate revocation of the old device; the exact enrollment mechanism was not explicitly selected.
10. **POS/payment configuration** — define the store-admin workflow and validation for POS terminal and bank-account display details.

## How to change a decision

Create a follow-up ADR with a new number, link the superseded ADR, state the new context and consequences, and update this index. Do not rewrite history without recording why a decision changed.
