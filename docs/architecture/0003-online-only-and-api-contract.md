# ADR 0003: Online-Only Operation and REST API Contract

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
The pilot prioritizes reliable transaction handling over offline operation.

## Decision
- v1 is online-only. A sale cannot be finalized without backend confirmation.
- The backend is the source of truth.
- Use REST endpoints under a versioned prefix such as `/api/v1`.
- Generate an OpenAPI specification from NestJS and generate frontend types/client from it.
- Preserve backward compatibility where practical.
- Provide clear connection and failure states. The cart may be retained locally where practical, but an unconfirmed sale must never be presented as completed.
- Use idempotent retries for uncertain requests.

## Alternatives considered
- Offline cash queue in v1: deferred until after pilot validation.
- Unversioned API with manually duplicated frontend types: rejected.

## Consequences
- Network outages block new sale finalization.
- Recovery UX must distinguish pending/unknown outcomes from confirmed success.
- The server must safely support request retries and return the original result for duplicate submissions.
