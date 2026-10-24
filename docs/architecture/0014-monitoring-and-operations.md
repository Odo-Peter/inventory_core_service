# ADR 0014: Monitoring and Operational Safety

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
The pilot needs enough operational visibility to detect service/database failure and investigate errors without exposing secrets.

## Decision
- Provide structured backend logs, error tracking, application/database health checks, and alerts for critical failures.
- Include request/correlation IDs to connect related logs.
- Never log staff PINs, tokens, payment secrets, or other secrets. Restrict access to logs and error-tracking systems.
- Show clear connectivity and request status in the UI.
- On backend outage, block sale finalization; never show success before confirmed backend result. Resolve uncertain outcomes through idempotent retries.
- Advanced distributed tracing and elaborate dashboards are deferred.

## Consequences
- Alert routing, access permissions, and service-level thresholds need operational configuration.
- Logs should aid diagnosis while minimizing personal and payment data.
