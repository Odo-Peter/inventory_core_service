# ADR 0017: Page-Based Pagination for List APIs

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The admin UI needs numbered navigation, "page X of Y", a total row count, and the ability to jump directly to a page. Cursor/keyset pagination cannot provide those features without additional queries or client-side bookkeeping. The audit log read API previously used keyset pagination; this decision replaces that mechanism for every paginated backend list endpoint.

## Decision

- Paginated list endpoints use `page` and `page_size` query parameters.
- `page` defaults to `1`, has a minimum of `1`, and has a maximum of `10,000`. The upper bound keeps `skip` well inside a 32-bit integer and prevents absurdly deep scans.
- `page_size` defaults to `25`, has a minimum of `1`, and has a maximum of `100`.
- Validation uses the existing `class-validator` pipeline. Non-integers, zero, negatives, values above the limits, and unknown query parameters return `400`.
- Responses use:
  ```json
  {
    "data": [],
    "meta": {
      "page": 1,
      "page_size": 25,
      "total": 0,
      "total_pages": 0
    }
  }
  ```
- `total` counts the rows matching the same filters and store scope as `data`, ignoring pagination. `total_pages` is `ceil(total / page_size)` and is `0` when `total` is `0`.
- A page beyond the last page returns `200` with `data: []` and the correct `total` and `total_pages`.
- Offset pagination requires deterministic ordering. Every converted query orders by its business sort fields followed by `id` as the final tiebreaker; audit logs use `created_at DESC, id DESC`.
- Each request runs exactly one data query and one count query in a single `prisma.$transaction([findMany, count])`, with the identical `where` and store scoping. `skip = (page - 1) * page_size` and `take = page_size`.
- Cursor parameters, cursor codecs, and keyset `where` builders are not part of the list API.

## Alternatives considered

- **Keyset/cursor pagination:** rejected for the admin UI because it lacks random page access and totals. It remains the documented fallback if audit volume ever makes deep offset pages too slow.
- **Offset pagination without a count:** rejected because the UI requires "page X of Y" and a total row count.
- **Dual cursor and page parameters:** rejected to keep one contract and avoid ambiguous pagination requests.

## Consequences

- Every page request costs an additional `count` query.
- Deep pages scan and discard more rows than shallow pages; the `page` cap and `page_size` maximum bound the worst case.
- Pages can shift when new rows arrive between requests. Deterministic ordering prevents duplicates or gaps caused solely by non-unique sort values, but immediately inserted rows can still move the boundaries.
- Store-scoped indexed filters keep the data and count queries bounded for normal list workloads.
- Keyset pagination can be reintroduced for a specific endpoint through a follow-up ADR if measured volume makes deep pages unacceptably slow.
