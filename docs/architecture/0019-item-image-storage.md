# ADR 0019: Item Image Storage

- **Status:** Accepted
- **Date:** 2026-10-29
- **Extends:** ADR 0005 (store scope), ADR 0011 (audit), ADR 0018 (catalog boundaries)
- **Supersedes:** nothing

## Context

Phase 2 needs one optional product image per item. Storing provider URLs, transformations, or credentials on `Item` would make the catalog table depend on a hosting vendor and would leak operational detail into every item response. The pilot also needs to run locally and in tests without a Cloudinary account.

## Decision

### The database stores a key, not a URL

- `Item.image_key String?` holds an opaque application-generated key. It never holds a URL, provider public ID format, or transformation settings.
- Keys are generated as `items/{store_id}/{item_id}/{uuid}`. The store and item segments make accidental cross-store use visible; the random suffix prevents guessing and cache collisions. The item id is generated up front (UUID) so the key can be formed before the database write.
- Responses may expose `image_key` and derived variant URLs, but the derived URLs are not persisted.
- A missing image is `image_key = NULL`. There is no placeholder row and no image table in Phase 2.

### Storage is behind an interface

- `IMAGE_STORAGE` is a Nest provider token for the `ImageStorage` interface: `upload`/`put`, `remove`, `url`, and an `enabled` flag.
- `CloudinaryImageStorage` is the production adapter. It uploads the processed bytes with `overwrite` and `invalidate`, deletes by key, and derives delivery URLs.
- `DisabledImageStorage` is the default when no provider is configured. It rejects uploads/removals with `503 image_storage_not_configured` so a missing account is explicit rather than silently discarding images.
- Tests use a test-only `MemoryImageStorage` under `test/helpers/`; no test can reach Cloudinary.
- `IMAGE_STORAGE_DRIVER` selects `disabled` (default) or `cloudinary`. Cloudinary mode requires `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Empty values are not accepted.

### Unified image routes and field

- Dedicated image endpoints:
  - `PUT /api/v1/items/:id/image` — multipart, field name `image` (maximum 2 MB). Upload or replace.
  - `DELETE /api/v1/items/:id/image` — remove image (idempotent).
- Item create (`POST /api/v1/items`) uses the same multipart field name `image` when an image is supplied.
- Code, Swagger, docs, and tests must all use this contract. No alias routes (`POST` or field `file`) are kept unless a consumer in the repository still needs them (in which case the consumer is updated instead).

### Create with optional image — order of operations (all-or-nothing)

From the caller’s point of view the create is all-or-nothing:

1. Validate the DTO and the image (if present); normalize the image with `sharp` (`failOn: "error"`, pixel limit, EXIF rotation, strip metadata, re-encode to WebP quality 82). Only JPEG, PNG, and WebP inputs are accepted; the declared MIME type is not trusted. SVG, animated formats, and malformed files are rejected. Any failure here is a 4xx with **no side effects** (no storage call, no database write).
2. Generate the item’s id up front (UUID) so the storage key can use it: `items/{store_id}/{item_id}/{random uuid}`.
3. If an image was supplied, `storage.put` the normalized bytes under that key.
4. One database transaction: create the item (stock 0, `image_key` set when an image was uploaded) and write the single audit entry.
5. If step 4 fails (for example a SKU or barcode conflict returning 409), best-effort delete the uploaded object, then rethrow. A failed compensating delete is logged and **never masks** the original error.
6. If step 3 fails, no item is created. Storage failures return `503 image_storage_unavailable` (or `503 image_storage_not_configured` when using `DisabledImageStorage`). A request that includes an image while storage is disabled therefore creates nothing; a request without an image never touches storage and still succeeds.

### Dedicated upload / replace / delete pipeline

1. Manager+ `PUT /api/v1/items/:id/image` accepts the multipart field `image`.
2. The service verifies the item exists in the authenticated store, then validates and normalizes the bytes exactly as in the create path.
3. The processed bytes are uploaded under a new key. Only after the upload succeeds does the database transaction conditionally replace `image_key` and write `item.image_updated`. If the transaction fails, the new object is deleted best-effort.
4. After a successful commit, the previous key is deleted best-effort. A failed cleanup never fails the request and never restores the old key; the database remains authoritative.
5. `DELETE /api/v1/items/:id/image` is idempotent: it sets `image_key` to null in a transaction with `item.image_removed`, then deletes the object best-effort.

Conditional updates require the observed `image_key` to still be current, so two concurrent uploads cannot silently overwrite each other; the loser gets `409 image_changed`.

### Variants

- Two delivery variants exist and are derived at response time:
  - `thumb`: `c_fill,w_160,h_160,f_auto,q_auto`
  - `full`: `c_limit,w_800,f_auto,q_auto`
- Variants are constants in code, not database columns. The source object is the processed WebP; Cloudinary performs delivery-time resizing/format negotiation.
- If storage is disabled, an existing key still returns `image_key` but `variants` is null.

### Permissions and audit

- Reads of `image_key` follow normal item reads (all authenticated roles).
- Upload, replace, and remove are Manager or Admin (Manager+).
- Item creation (including optional image) is Manager+.
- Creation writes a **single** audit entry `item.created` whose details include `has_image: true|false`. There is **no** separate `item.image_updated` / `item.image_changed` for the creation-time image. Anyone filtering the audit log solely for image-change actions will therefore not see creation-time images; this is intentional and recorded here so the behaviour is discoverable.
- Every successful post-create upload/replacement writes `item.image_updated`; every actual removal writes `item.image_removed`. Audit details contain keys, never bytes, credentials, or URLs with signatures.

### PATCH remains JSON-only

- `PATCH /api/v1/items/:id` accepts JSON only and never accepts an image. Changing both details and the photo requires two calls (`PATCH` + `PUT .../image`). Both operations are idempotent, so this is acceptable for Phase 2. The PATCH body continues to reject `stock_quantity` and `current_price`.

## Consequences

- Switching providers means implementing one adapter and changing configuration, not migrating item rows.
- Orphaned provider objects are possible if a process dies between upload and commit, or if best-effort cleanup fails. They are harmless to correctness; a future maintenance job can list and remove unreferenced keys if needed.
- The local/test default is safe and requires no credentials. A create request that includes an image while storage is disabled fails the whole request with `503 image_storage_not_configured`; a create without an image succeeds.
- Because only the key is stored, clients that need images must receive derived URLs from the API (as the create/upload response and future read endpoints do) or use the same key-derivation rules.
- Docs, Swagger, code, and tests must all agree on `PUT` (and create) with the multipart field name `image`.
