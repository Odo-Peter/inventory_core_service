# ADR 0002: Technology Stack and Repository Boundaries

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
Frontend and backend should be independently deployable and versioned while sharing a stable API contract.

## Decision
- Frontend: Vite, React, TypeScript, Tailwind CSS, and TanStack Query.
- Backend: NestJS and TypeScript.
- Persistence: PostgreSQL in development, test, staging, and production; Prisma ORM and migrations.
- Maintain separate frontend and backend repositories.
- Deploy frontend and backend independently.
- The frontend must not import backend source code. Shared API types/client are generated from the OpenAPI contract rather than duplicated manually.

## Alternatives considered
- Monorepo: not selected.
- SQLite for local/test environments: explicitly rejected; PostgreSQL is used in every environment.

## Consequences
- Independent release cadence and deployment pipelines are possible.
- API compatibility must be managed intentionally.
- CI must validate both repositories and the API contract.
- Some cross-repository coordination is required when changing API behavior.
