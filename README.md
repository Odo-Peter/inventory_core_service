# Store Inventory & POS App

A web-based inventory management and point-of-sale (POS) application for small retail stores. The project begins with a single-store pilot, with a foundation designed to support additional stores in the future.

The application helps staff manage products and stock, process sales, record payments, print receipts, reconcile tills, and review day-to-day store activity.

> **Project status:** Architecture decisions and the v1 implementation plan are documented. Implementation status should be updated as features are built and verified.

## Project goals

- **Reliable checkout:** Record sales safely, prevent duplicate submissions, and provide clear feedback when the server is unavailable.
- **Accurate inventory:** Track every stock change through an auditable movement record.
- **Accountability:** Associate sales, shifts, adjustments, and administrative actions with the responsible staff member.
- **Operational visibility:** Provide sales reports, stock reports, shift reconciliation, and daily closing reviews.
- **Practical deployment:** Keep the application straightforward to develop, test, deploy, and operate.
- **Future growth:** Establish store-scoped data and authorization from the beginning without building a full multi-store management platform prematurely.

## Applications and architecture

The project uses a **modular monolith backend** with a separately developed frontend. The frontend and backend are maintained in separate repositories and communicate through a versioned REST API.

| Component | Technology / approach |
|---|---|
| Frontend | React, TypeScript, Vite |
| Styling | Tailwind CSS |
| Server-state management | TanStack Query |
| Backend | NestJS, TypeScript |
| Database | PostgreSQL |
| ORM and migrations | Prisma |
| API contract | REST, with OpenAPI-generated documentation and frontend client/types |
| Authentication | Staff code and PIN, short-lived access tokens, rotating refresh sessions |
| Testing | Unit, PostgreSQL integration, API end-to-end, frontend, and concurrency tests |
| Deployment | Independently deployable frontend and backend, with managed PostgreSQL |

The backend is organized into business-capability modules within one application. PostgreSQL is used in every environment, including development and tests; SQLite is not part of the project architecture.

See [`docs/architecture/README.md`](docs/architecture/README.md) for the architecture decisions and their rationale.

## V1 functionality

The initial release focuses on the daily operational needs of one store.

### Catalog and inventory
- Manage products, SKUs, optional barcodes, selling prices, and low-stock thresholds.
- Import and export catalog data using CSV.
- Record opening stock, received stock, stock adjustments, and stock counts.
- Track stock movements with reasons, timestamps, and responsible staff.
- Prevent sales from reducing inventory below zero.
- Preserve price history and historical sale details.

### Sales and receipts
- Build a cart and calculate totals using the store's configured tax rules.
- Record each sale using one configured payment method: cash, card, or bank transfer.
- Record card and transfer payments manually against configured POS terminals or bank accounts.
- Generate numbered receipts and support print-friendly receipt reprints.
- Protect checkout against duplicate submissions and concurrent stock conflicts.

### Staff, tills, and operations
- Authenticate staff using a staff code and PIN.
- Enforce Admin, Manager, and Cashier permissions on the backend.
- Manage tills and cashier shifts, including opening floats and closing cash counts.
- Record cash discrepancies and require explanations where applicable.
- Review daily sales, shift reconciliation, inventory activity, and item performance.
- Maintain an append-only audit trail for sensitive business operations.

### Store configuration
- Configure one currency and an IANA timezone per store.
- Configure tax treatment and rates, payment methods, tills, and receipt details.
- Use store-scoped records and server-enforced store isolation.

For the complete v1 scope, exclusions, and acceptance criteria, see the implementation checklist and the architecture decision records.

## Explicit v1 boundaries

The first release is intentionally constrained:

- **Online-only checkout:** sales cannot be finalized while the backend is unavailable. Offline sale queues are deferred.
- **One store experience:** the data model is store-aware, but cross-store administration and reporting are deferred.
- **One payment method per sale:** split payments are not supported.
- **Manual payment recording:** payment gateway integrations and automatic webhook confirmation are deferred.
- **No refunds or reversals:** completed sales are preserved; refund and reversal workflows are deferred.
- **No discounts or promotions:** checkout uses configured item prices and tax rules.
- **No purchase-cost accounting:** cost of goods sold and profit-margin reporting are deferred.
- **Light theme only:** the interface should remain accessible and localization-ready.
- **No customer accounts by default:** the initial release minimizes customer data collection.
- **Browser-based receipt printing:** direct printer-driver integration and automatic hardware printing are deferred.

These boundaries keep the pilot focused and make the initial release easier to test and operate.

## Repository structure

The frontend and backend are separate repositories. Each repository should contain its own `README.md`, dependency manifest, environment-variable example, tests, and development instructions.

Shared project documentation can follow this structure:

```text
project-docs/
├── README.md
└── docs/
    ├── architecture/
    │   ├── README.md
    │   ├── 0001-modular-monolith.md
    │   ├── 0002-stack-and-repositories.md
    │   └── ... additional ADRs
    └── implementation/
        └── v1-implementation-checklist.md
```

The `project-docs/` name is illustrative: these documents can live in a dedicated documentation repository or in a designated project-level repository. The architecture and implementation documents should remain easy to find from both application repositories.

## Getting started

Implementation-specific setup instructions will be maintained in the individual frontend and backend repositories.

Before starting development:

1. Review the architecture decision records in `docs/architecture/`.
2. Review the v1 implementation checklist in `docs/implementation/v1-implementation-checklist.md`.
3. Confirm the launch language, tax jurisdiction and rounding rules, business retention requirements, and hosting provider.
4. Set up PostgreSQL and the required environment variables using the relevant repository instructions.
5. Follow the implementation checklist in order, delivering testable vertical slices.

Do not commit secrets, real staff PINs, production credentials, or customer data to source control.

## Engineering principles

### Data integrity
Critical business operations must use explicit database transactions. Sale finalization must consistently persist the sale, payment, stock movements, receipt, and relevant audit records. Stock checks and deductions must remain safe under concurrent requests.

### Security and access control
The backend is the authority for authentication, authorization, store scope, pricing, tax calculations, and stock availability. The frontend must not be trusted to enforce permissions or validate critical business rules.

### Auditability
Inventory changes and sensitive administrative actions must be traceable. Completed sales, receipts, stock movements, and shift reconciliations must not be silently edited or deleted.

### Testing
Use unit tests for business rules, integration tests against PostgreSQL, end-to-end tests for important workflows, and concurrency tests for duplicate submissions and stock contention. Test database transactions and migrations against the database engine used in production.

### Deployment and recovery
Keep development, staging, and production configuration separate. Run database migrations as a controlled deployment step, maintain automated backups, and test restoration before production release.

### Maintainability
Keep business logic within clear backend module boundaries, document significant architectural changes, generate frontend API types from the API contract, and prefer backward-compatible changes where independently deployed frontend and backend versions may overlap.

## Documentation

| Document | Purpose |
|---|---|
| [`docs/architecture/README.md`](docs/architecture/README.md) | Index of architecture decisions and how to change them |
| `docs/architecture/0001-modular-monolith.md` – `0016-device-model-and-access.md` | Focused Architecture Decision Records (ADRs) |
| [`docs/implementation/v1-implementation-checklist.md`](docs/implementation/v1-implementation-checklist.md) | Ordered implementation tasks and release criteria |
| Frontend repository `README.md` | Frontend setup, commands, environment variables, and tests |
| Backend repository `README.md` | Backend setup, database migrations, environment variables, and tests |

## Definition of v1 complete

V1 is ready for a pilot only when the agreed checklist is complete, critical workflows have been tested against PostgreSQL, permissions and store isolation are verified, stock and sale transactions withstand concurrency tests, backups and restoration have been tested, and the application has passed a full end-to-end smoke test in the intended store environment.

A feature should not be considered complete solely because its interface exists; its backend rules, persistence, authorization, failure handling, audit trail, and tests must also be in place.

## Current priorities

1. Resolve the remaining launch prerequisites.
2. Prepare the frontend and backend repositories and CI pipelines.
3. Implement the foundations and core workflows in checklist order.
4. Validate the full checkout and inventory lifecycle in staging.
5. Conduct a controlled pilot and use operational feedback to prioritize subsequent releases.

The guiding principle is simple: **protect the accuracy of sales and stock first, keep the first release focused, and expand only after the pilot demonstrates what the store needs.**
