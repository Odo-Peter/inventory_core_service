# ADR 0006: Transaction Integrity and Idempotent Sale Finalization

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
Concurrent checkout, client retries, and partial failures must not create duplicate sales or inconsistent inventory/payment records.

## Decision
Use explicit Prisma/PostgreSQL transactions for critical workflows. Sale finalization is atomic and includes, as applicable:
1. Validate the active staff, shift, till, store configuration, item availability, prices, and tax inputs.
2. Apply concurrency-safe stock deductions; reject if any item would become negative.
3. Create corresponding stock movement records.
4. Create the sale and immutable sale-item snapshots.
5. Record the single payment method/payment record and mark the sale paid only after the recorded amount matches the total.
6. Allocate a unique per-store receipt number transactionally and create receipt data.
7. Write audit events for the operation.

Use a unique idempotency key per sale submission. Persist the key and result consistently with the sale transaction. A retry with the same key and same payload returns the original sale/receipt. Reuse of the key with a different payload is rejected. The same request must not create duplicate payments, stock deductions, sales, or receipts.

Use database constraints and guarded updates for invariants. Never keep a database transaction open while waiting on an external network or payment provider.

## Alternatives considered
- Best-effort sequence of separate writes: rejected because partial completion can corrupt business state.
- Client-only duplicate prevention: rejected because clients can retry, crash, or submit concurrently.

## Consequences
- Transaction boundaries and isolation/concurrency behavior require dedicated tests.
- Idempotency retention duration is a security/operations configuration prerequisite.
- Any future gateway integration needs a separate external-payment state machine; it must not hold a database transaction open over provider calls.
