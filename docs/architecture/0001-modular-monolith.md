# ADR 0001: Modular Monolith Backend

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
The application needs clear business boundaries without the operational overhead of distributed services during the pilot.

## Decision
Use one NestJS backend application structured into modules aligned to business capabilities, backed by one PostgreSQL database. Maintain explicit module boundaries and avoid unnecessary cross-module coupling.

## Alternatives considered
- Microservices: rejected for v1 because deployment, observability, and distributed transaction complexity are not justified.
- Unstructured single application: rejected because it weakens ownership and makes future change harder.

## Consequences
- One backend deployment and one primary database simplify operations.
- Critical workflows can use local database transactions.
- Module boundaries must be enforced through code organization and review; a modular monolith is not permission to create a tangled codebase.
- Future service extraction remains possible if supported by demonstrated need, not assumed in advance.
