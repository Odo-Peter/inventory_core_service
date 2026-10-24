# ADR 0013: Deployment, CI/CD, Database Migrations, and Recovery

- **Status:** Accepted; provider and recovery objectives TBD
- **Date:** 2026-10-24

## Context
Frontend and backend deploy independently, while database changes must remain safe across versions.

## Decision
- Use managed hosting for frontend, backend, and PostgreSQL. Providers and region remain undecided until cost, region, operational fit, and recovery features are compared.
- Maintain separate development, staging, and production configuration. Keep secrets out of source control.
- Pull requests run linting, type checks, unit tests, and relevant integration tests against PostgreSQL.
- Merges to main deploy to staging. Production deployment requires explicit approval.
- Run Prisma migrations as a dedicated deployment step, not independently on every backend instance.
- Prefer backward-compatible, expand-and-contract schema changes where practical so independently deployed frontend/backend versions can coexist.
- Configure automated daily backups, encrypted backup storage, point-in-time recovery where supported, and documented recovery procedures.
- Perform periodic restoration tests. A restoration test is required before production launch.
- Define backup retention, Recovery Point Objective (RPO), and Recovery Time Objective (RTO) after selecting providers.

## Consequences
- Hosting provider selection affects deployment, observability, database recovery, and cost.
- Production release readiness depends on verified restore procedures, not merely successful backup jobs.
- Migration ownership must be clear and deployments must fail safely if migrations fail.
