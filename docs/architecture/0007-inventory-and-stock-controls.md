# ADR 0007: Inventory Movements, Stock Receiving, and Stock Counts

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
Inventory values must be explainable, and all stock-changing operations must remain consistent under concurrent use.

## Decision
- Strict stock enforcement: no sale may reduce stock below zero; there is no override.
- Every stock change is recorded as an audited stock movement. Stock updates and movement records are atomic.
- Manual increases/decreases/corrections require a reason category; notes are optional. Record actor, time, quantity, reason, and related workflow.
- Receiving is basic v1 functionality without supplier management or purchase orders. Record received items/quantities and optional supplier name, delivery reference, and reason.
- Existing merchandise is entered through a dedicated opening-stock session. Review and confirmation create audited stock movements atomically. Confirmed opening balances cannot be silently edited.
- Provide both partial and full stock-count sessions. Record scope explicitly so uncounted items are never treated as zero.
- Stock-count states: in progress, ready for review, confirmed, cancelled.
- During a stock count, freeze all inventory activity across devices, including stock-affecting sale finalization, receiving, adjustments, opening-stock changes, and other count confirmations. Enforce one active count lock per store in the backend.
- Count confirmation revalidates state and applies all approved corrections atomically. The lock remains through required review and is released only after successful confirmation or authorized cancellation.
- Cancelled counts preserve partial counts and cancellation actor/time, apply no stock changes, and cannot be resumed or confirmed.
- Use threshold-based discrepancy review. Differences above configurable quantity/value thresholds require Manager/Admin review; no adjustments apply before required reviews complete.
- Admin can perform inventory management remotely. The same store-wide count lock applies across devices.

## Consequences
- The stock-count lock can temporarily prevent checkout finalization; the UI must explain why.
- Safe lock recovery and cancellation must be specified.
- Quantity/value review thresholds must be configured before stock-count implementation.
- Stock movement history is the canonical explanation for inventory changes; direct untracked stock edits are prohibited.
