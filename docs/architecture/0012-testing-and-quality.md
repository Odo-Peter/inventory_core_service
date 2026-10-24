# ADR 0012: Testing Strategy

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
The most important failures involve financial correctness, stock concurrency, authorization, and partial failures.

## Decision
Use a test pyramid:
- Unit tests for business rules and calculations.
- Integration tests against real PostgreSQL for persistence, constraints, transactions, and migrations. Do not use SQLite as a substitute.
- API end-to-end tests for login, stock receiving, opening stock, stock counts, cash sales, single-payment sales, receipts, shifts, role enforcement, and audit records.
- Frontend tests for critical interactions and clear handling of pending/failure states.
- Concurrency tests for simultaneous sales against limited stock, duplicate submissions, idempotent retries, stock-count locks, and shift-close conflicts.
- Use an isolated test database or disposable PostgreSQL container; never run tests against production data.

## Consequences
- Tests must verify persisted outcomes, not only HTTP status codes.
- CI needs access to PostgreSQL for integration suites.
- Tax tests cannot be finalized until jurisdiction and rounding rules are decided.
