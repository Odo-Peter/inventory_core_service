# Sales API contract

Generated from the running NestJS app and the sales/catalog source on 2026-11-14.
Machine-readable schema: [`openapi.json`](./openapi.json) (the app's `GET /docs-json` response).

## Conventions

- Base path: `/api/v1`
- Auth: every route requires `Authorization: Bearer <jwt>`. Sales routes allow `cashier`, `manager`, and `admin`.
- Money: integer kobo on every money field (`current_price`, `subtotal`, `tax_total`, `total`, `unit_price`, `tax_amount`, `line_total`, `amount`, `expected_total`).
- Timestamps: ISO 8601 UTC strings.
- IDs: UUID strings.
- `payment_method`: `cash | card | bank_transfer`.

## POST /api/v1/sales

Record a completed sale and its payment. `201 Created`.

### Request body

| Field              | Type    | Required | Rules / notes                                                                 |
| ------------------ | ------- | -------- | ----------------------------------------------------------------------------- |
| `items`            | array   | yes      | 1–100 entries. Duplicate `item_id` values are merged before processing.       |
| `items[].item_id`  | string  | yes      | UUID of an item in the caller's store.                                        |
| `items[].quantity` | integer | yes      | 1–100000.                                                                     |
| `payment_method`   | enum    | yes      | `cash`, `card`, or `bank_transfer`.                                           |
| `pos_account_id`   | string  | no       | UUID. Required for `card`/`bank_transfer`; forbidden for `cash`.              |
| `expected_total`   | integer | yes      | Client-computed total in kobo. Must equal the server-computed total.          |
| `idempotency_key`  | string  | no       | 8–64 characters. Unique per store; repeating it returns the original sale.    |

The server locks the items, computes `line_total = current_price * quantity`, sets `tax_total = 0`, and `total = subtotal`. It then writes the sale, payment, stock movements, and audit record in one transaction. The response is the stored sale, not a draft.

### Request example

```json
{
  "items": [
    { "item_id": "00000000-0000-4000-8000-000000000005", "quantity": 2 },
    { "item_id": "00000000-0000-4000-8000-000000000006", "quantity": 1 }
  ],
  "payment_method": "cash",
  "expected_total": 2250,
  "idempotency_key": "sale-2026-11-08-0001"
}
```

### Response `201` — `SaleResponseDto`

| Field            | Type                       | Nullable | Notes                                                       |
| ---------------- | -------------------------- | -------- | ----------------------------------------------------------- |
| `id`             | string (UUID)              | no       | Sale ID.                                                    |
| `store_id`       | string (UUID)              | no       |                                                             |
| `receipt_number` | integer                    | no       | Store-wide counter; starts at 1.                            |
| `shift_id`       | string (UUID)              | no       | Shift that recorded the sale.                               |
| `staff_id`       | string (UUID)              | no       | Cashier who recorded the sale.                              |
| `staff_name`     | string                     | no       | `first_name last_name`.                                     |
| `subtotal`       | integer (kobo)             | no       | Sum of `line_total`.                                        |
| `tax_total`      | integer (kobo)             | no       | Currently always `0`.                                       |
| `total`          | integer (kobo)             | no       | `subtotal + tax_total`.                                     |
| `payment_method` | enum                       | yes      | `cash`, `card`, `bank_transfer`; null only for legacy rows. |
| `item_count`     | integer                    | no       | Number of sale lines after merging duplicate items.         |
| `created_at`     | string (date-time)         | no       |                                                             |
| `items`          | `SaleItemResponseDto[]`    | no       | Ordered by `item_id` ascending.                             |
| `payment`        | `SalePaymentResponseDto`   | yes      | Null only for legacy rows.                                  |

`SaleItemResponseDto`: `id` (UUID), `item_id` (UUID), `sku` (string), `name` (string), `unit` (string), `unit_price` (integer kobo), `quantity` (integer), `tax_amount` (integer kobo, currently `0`), `line_total` (integer kobo). All fields are non-null.

`SalePaymentResponseDto`: `id` (UUID), `method` (enum), `amount` (integer kobo), `pos_account_id` (UUID or null), `account_label` (string or null). `pos_account_id` and `account_label` are null for cash.

```json
{
  "id": "00000000-0000-4000-8000-000000000004",
  "store_id": "00000000-0000-4000-8000-000000000001",
  "receipt_number": 1,
  "shift_id": "00000000-0000-4000-8000-000000000003",
  "staff_id": "00000000-0000-4000-8000-000000000002",
  "staff_name": "Ada Okafor",
  "subtotal": 2250,
  "tax_total": 0,
  "total": 2250,
  "payment_method": "cash",
  "item_count": 2,
  "created_at": "2026-11-08T10:15:30.000Z",
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000008",
      "item_id": "00000000-0000-4000-8000-000000000005",
      "sku": "SKU-0001",
      "name": "Bottled water",
      "unit": "piece",
      "unit_price": 1000,
      "quantity": 2,
      "tax_amount": 0,
      "line_total": 2000
    },
    {
      "id": "00000000-0000-4000-8000-000000000009",
      "item_id": "00000000-0000-4000-8000-000000000006",
      "sku": "SKU-0002",
      "name": "Sachet water",
      "unit": "piece",
      "unit_price": 250,
      "quantity": 1,
      "tax_amount": 0,
      "line_total": 250
    }
  ],
  "payment": {
    "id": "00000000-0000-4000-8000-000000000007",
    "method": "cash",
    "amount": 2250,
    "pos_account_id": null,
    "account_label": null
  }
}
```

## GET /api/v1/sales/payment-options

List payment methods and the active accounts the UI may select. `200 OK`.

### Response — `PaymentOptionsResponseDto`

| Field           | Type                     | Nullable | Notes                                                           |
| --------------- | ------------------------ | -------- | --------------------------------------------------------------- |
| `cash`          | `PaymentMethodOptionDto` | no       | Always present. `accounts` is always `[]`.                      |
| `card`          | `PaymentMethodOptionDto` | yes      | Omitted entirely when the store has no active `pos_terminal`.   |
| `bank_transfer` | `PaymentMethodOptionDto` | yes      | Omitted entirely when the store has no active `bank_account`.   |

`PaymentMethodOptionDto`: `method` (enum), `accounts` (array of `{ id: UUID, label: string }`). Accounts are active, belong to the caller's store, and are sorted by `label`, then `id`.

### Example

```json
{
  "cash": { "method": "cash", "accounts": [] },
  "card": {
    "method": "card",
    "accounts": [
      { "id": "00000000-0000-4000-8000-00000000000a", "label": "Terminal 1" }
    ]
  },
  "bank_transfer": {
    "method": "bank_transfer",
    "accounts": [
      { "id": "00000000-0000-4000-8000-00000000000b", "label": "GTBank" }
    ]
  }
}
```

## GET /api/v1/sales/summary

Summarise sales matching the same filters as the list endpoint. `200 OK`.

### Query parameters

| Field            | Type    | Required | Notes                                                     |
| ---------------- | ------- | -------- | --------------------------------------------------------- |
| `from`           | string  | no       | Inclusive ISO 8601 lower bound for `created_at`.          |
| `to`             | string  | no       | Inclusive ISO 8601 upper bound for `created_at`.          |
| `staff_id`       | string  | no       | UUID. Ignored for cashiers, who are always scoped to self. |
| `shift_id`       | string  | no       | UUID.                                                     |
| `payment_method` | enum    | no       | `cash`, `card`, or `bank_transfer`.                       |
| `q`              | string  | no       | Exact receipt number, 1–9 digits.                         |
| `page`           | integer | no       | 1–10000, default `1`. Accepted but unused by summary.     |
| `page_size`      | integer | no       | 1–100, default `25`. Accepted but unused by summary.      |

### Response — `SalesSummaryResponseDto`

| Field               | Type                              | Nullable | Notes                                      |
| ------------------- | --------------------------------- | -------- | ------------------------------------------ |
| `sale_count`        | integer                           | no       | Number of matching sales.                  |
| `subtotal`          | integer (kobo)                    | no       | `0` when no sales match.                   |
| `tax_total`         | integer (kobo)                    | no       | `0` when no sales match.                   |
| `total`             | integer (kobo)                    | no       | `0` when no sales match.                   |
| `by_payment_method` | `SalesSummaryPaymentMethodDto[]`  | no       | Only payment methods present in the result; sorted by `method`. |

`SalesSummaryPaymentMethodDto`: `method` (enum), `count` (integer), `amount` (integer kobo). All non-null.

### Example

```json
{
  "sale_count": 2,
  "subtotal": 3250,
  "tax_total": 0,
  "total": 3250,
  "by_payment_method": [
    { "method": "card", "count": 1, "amount": 1000 },
    { "method": "cash", "count": 1, "amount": 2250 }
  ]
}
```

## GET /api/v1/sales/overview

Seven-day dashboard aggregate ending today. `200 OK`. No query parameters.

Day boundaries use the store's configured IANA timezone, read from `Store.timezone`. `daily` always has exactly seven entries, oldest first, ending with today in that timezone; days without sales are zero-filled. `today` repeats the last `daily` entry and adds `by_method`. Cashiers see only their own sales (`scope: own`); managers and admins see all sales in the store (`scope: store`).

### Response — `SalesOverviewResponseDto`

| Field      | Type                              | Nullable | Notes                                                          |
| ---------- | --------------------------------- | -------- | -------------------------------------------------------------- |
| `timezone` | string                            | no       | Store IANA timezone used for day boundaries, e.g. `Africa/Lagos`. |
| `scope`    | enum                              | no       | `own` for cashiers, `store` for managers and admins.           |
| `today`    | `SalesOverviewTodayDto`           | no       | Today in the store timezone.                                   |
| `daily`    | `SalesOverviewDayDto[]`           | no       | Exactly 7 entries, oldest first, ending today.                 |

`SalesOverviewDayDto`: `date` (`YYYY-MM-DD`), `total` (integer kobo), `count` (integer). All non-null.

`SalesOverviewTodayDto`: same fields as `SalesOverviewDayDto`, plus `by_method` (`SalesOverviewPaymentMethodDto[]`). `by_method` lists only payment methods present in today's sales, sorted by `method`; the entries sum to `today.total` and `today.count`.

`SalesOverviewPaymentMethodDto`: `method` (enum), `total` (integer kobo), `count` (integer). All non-null.

### Example (cashier scope; all values are integer kobo)

```json
{
  "timezone": "Africa/Lagos",
  "scope": "own",
  "today": {
    "date": "2026-11-14",
    "total": 3250,
    "count": 2,
    "by_method": [
      { "method": "card", "total": 1000, "count": 1 },
      { "method": "cash", "total": 2250, "count": 1 }
    ]
  },
  "daily": [
    { "date": "2026-11-08", "total": 0, "count": 0 },
    { "date": "2026-11-09", "total": 0, "count": 0 },
    { "date": "2026-11-10", "total": 0, "count": 0 },
    { "date": "2026-11-11", "total": 0, "count": 0 },
    { "date": "2026-11-12", "total": 0, "count": 0 },
    { "date": "2026-11-13", "total": 0, "count": 0 },
    { "date": "2026-11-14", "total": 3250, "count": 2 }
  ]
}
```

## GET /api/v1/sales

List completed sales. `200 OK`. Newest first (`created_at DESC`, then `id DESC`).

### Query parameters

Same as `GET /api/v1/sales/summary`, but `page` and `page_size` control the result. `from > to` returns `invalid_date_range`.

### Response — paginated `SaleListItemDto`

| Field            | Type               | Nullable | Notes                                                  |
| ---------------- | ------------------ | -------- | ------------------------------------------------------ |
| `data`           | `SaleListItemDto[]` | no      | List rows; no `items` or `payment` objects.            |
| `meta.page`      | integer            | no       | Current page.                                          |
| `meta.page_size` | integer            | no       | Rows per page.                                         |
| `meta.total`     | integer            | no       | Total matching sales.                                  |
| `meta.total_pages` | integer          | no       | `ceil(total / page_size)`.                             |

`SaleListItemDto`: `id` (UUID), `store_id` (UUID), `receipt_number` (integer), `shift_id` (UUID), `staff_id` (UUID), `staff_name` (string), `subtotal` (integer kobo), `tax_total` (integer kobo), `total` (integer kobo), `payment_method` (enum or null), `item_count` (integer), `created_at` (date-time). All except `payment_method` are non-null.

### Example

```json
{
  "data": [
    {
      "id": "00000000-0000-4000-8000-000000000004",
      "store_id": "00000000-0000-4000-8000-000000000001",
      "receipt_number": 1,
      "shift_id": "00000000-0000-4000-8000-000000000003",
      "staff_id": "00000000-0000-4000-8000-000000000002",
      "staff_name": "Ada Okafor",
      "subtotal": 2250,
      "tax_total": 0,
      "total": 2250,
      "payment_method": "cash",
      "item_count": 2,
      "created_at": "2026-11-08T10:15:30.000Z"
    }
  ],
  "meta": { "page": 1, "page_size": 25, "total": 1, "total_pages": 1 }
}
```

## GET /api/v1/sales/:id

Get one completed sale. `200 OK`.

### Path parameters

| Field | Type          | Required | Notes     |
| ----- | ------------- | -------- | --------- |
| `id`  | string (UUID) | yes      | Sale ID.  |

### Response — `SaleResponseDto`

Same fields, nullability, and JSON shape as the `POST /api/v1/sales` `201` example. `items` and `payment` are included.

```json
{
  "id": "00000000-0000-4000-8000-000000000004",
  "store_id": "00000000-0000-4000-8000-000000000001",
  "receipt_number": 1,
  "shift_id": "00000000-0000-4000-8000-000000000003",
  "staff_id": "00000000-0000-4000-8000-000000000002",
  "staff_name": "Ada Okafor",
  "subtotal": 2250,
  "tax_total": 0,
  "total": 2250,
  "payment_method": "cash",
  "item_count": 2,
  "created_at": "2026-11-08T10:15:30.000Z",
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000008",
      "item_id": "00000000-0000-4000-8000-000000000005",
      "sku": "SKU-0001",
      "name": "Bottled water",
      "unit": "piece",
      "unit_price": 1000,
      "quantity": 2,
      "tax_amount": 0,
      "line_total": 2000
    },
    {
      "id": "00000000-0000-4000-8000-000000000009",
      "item_id": "00000000-0000-4000-8000-000000000006",
      "sku": "SKU-0002",
      "name": "Sachet water",
      "unit": "piece",
      "unit_price": 250,
      "quantity": 1,
      "tax_amount": 0,
      "line_total": 250
    }
  ],
  "payment": {
    "id": "00000000-0000-4000-8000-000000000007",
    "method": "cash",
    "amount": 2250,
    "pos_account_id": null,
    "account_label": null
  }
}
```

## POST /api/v1/sales/:id/receipt-prints

Record a receipt print and return the data needed to render it. `200 OK`. No request body.

### Path parameters

| Field | Type          | Required | Notes     |
| ----- | ------------- | -------- | --------- |
| `id`  | string (UUID) | yes      | Sale ID.  |

### Response — `ReceiptResponseDto`

| Field          | Type                | Nullable | Notes                                                           |
| -------------- | ------------------- | -------- | --------------------------------------------------------------- |
| `id`           | string (UUID)       | no       | Receipt-print record ID, not the sale ID.                       |
| `print_number` | integer             | no       | 1-based print count for this sale.                              |
| `is_copy`      | boolean             | no       | `true` for every print after the first.                         |
| `printed_at`   | string (date-time)  | no       |                                                                 |
| `sale`         | `SaleResponseDto`   | no       | Same shape as `GET /api/v1/sales/:id`.                          |
| `store`        | `ReceiptStoreDto`   | no       | Store header/footer for the receipt.                            |

`ReceiptStoreDto`: `name` (string), `address` (string or null), `phone` (string or null), `currency` (string), `receipt_footer` (string or null).

### Example (first print; reprints set `is_copy` to `true` and increment `print_number`)

```json
{
  "id": "00000000-0000-4000-8000-00000000000c",
  "print_number": 1,
  "is_copy": false,
  "printed_at": "2026-11-08T10:16:02.000Z",
  "sale": {
    "id": "00000000-0000-4000-8000-000000000004",
    "store_id": "00000000-0000-4000-8000-000000000001",
    "receipt_number": 1,
    "shift_id": "00000000-0000-4000-8000-000000000003",
    "staff_id": "00000000-0000-4000-8000-000000000002",
    "staff_name": "Ada Okafor",
    "subtotal": 2250,
    "tax_total": 0,
    "total": 2250,
    "payment_method": "cash",
    "item_count": 2,
    "created_at": "2026-11-08T10:15:30.000Z",
    "items": [
      {
        "id": "00000000-0000-4000-8000-000000000008",
        "item_id": "00000000-0000-4000-8000-000000000005",
        "sku": "SKU-0001",
        "name": "Bottled water",
        "unit": "piece",
        "unit_price": 1000,
        "quantity": 2,
        "tax_amount": 0,
        "line_total": 2000
      },
      {
        "id": "00000000-0000-4000-8000-000000000009",
        "item_id": "00000000-0000-4000-8000-000000000006",
        "sku": "SKU-0002",
        "name": "Sachet water",
        "unit": "piece",
        "unit_price": 250,
        "quantity": 1,
        "tax_amount": 0,
        "line_total": 250
      }
    ],
    "payment": {
      "id": "00000000-0000-4000-8000-000000000007",
      "method": "cash",
      "amount": 2250,
      "pos_account_id": null,
      "account_label": null
    }
  },
  "store": {
    "name": "Test Store",
    "address": "1 Main Street",
    "phone": "+2348030000000",
    "currency": "NGN",
    "receipt_footer": "Thank you for your custom"
  }
}
```

## UI behaviour guarantees

- **Idempotent replay:** sending a previously used `idempotency_key` returns the original sale with `201` (same sale `id`, original totals/items), even if the new request body differs. The replay is resolved before shift and stock checks. A key owned by another staff member returns `409 idempotency_key_reused`.
- **Cashier history:** cashiers only see their own sales in `GET /sales`, `GET /sales/summary`, `GET /sales/overview`, `GET /sales/:id`, and `POST /sales/:id/receipt-prints`. A cashier requesting another cashier's sale gets `404 sale_not_found`; `staff_id` cannot widen a cashier's scope. Managers and admins see all sales in their store.
- **Overview days:** `GET /sales/overview` uses the store timezone for business-day boundaries, not UTC. `daily` always contains seven consecutive zero-filled days ending today, and `today` matches the final entry.
- **Reprints:** the first print returns `is_copy: false`; every later print returns `is_copy: true` with an incremented `print_number`. Only reprints are audit-logged.
- **Payment options:** `payment-options` omits `card` when there is no active POS terminal and omits `bank_transfer` when there is no active bank account. `cash` is always present with an empty `accounts` array. Inactive and other-store accounts never appear and cannot be used in a sale.

## Errors

Every error uses this envelope:

```json
{
  "statusCode": 409,
  "code": "no_open_shift",
  "message": "Clock in before recording a sale"
}
```

- `statusCode` (number): HTTP status.
- `code` (string): stable machine-readable code.
- `message` (string): human-readable message. Validation messages are joined with `, `.
- `retry_after_seconds` (number, optional): only present on throttled responses (auth), not on sales errors.

| HTTP | `code`                         | When it occurs                                                                                                 |
| ---- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 400  | `validation_failed`            | Body/query validation fails: missing field, wrong type, unknown field, invalid UUID/date/enum, quantity or key out of range. |
| 400  | `sale_total_too_large`         | A line total or the subtotal/total exceeds `2147483647` or is not a safe integer.                              |
| 400  | `payment_account_required`     | `card` or `bank_transfer` is used without `pos_account_id`.                                                     |
| 400  | `payment_account_not_allowed`  | `cash` is used with a `pos_account_id`.                                                                        |
| 400  | `invalid_payment_method`       | Service-level guard for an unsupported method. Normal HTTP requests with an invalid enum fail earlier as `validation_failed`. |
| 400  | `invalid_date_range`           | List/summary `from` is later than `to`.                                                                        |
| 401  | `unauthorized`                 | Missing, invalid, or expired bearer token.                                                                     |
| 403  | `forbidden`                    | Authenticated staff role is below the route's required role.                                                   |
| 404  | `item_not_found`               | A sale line references an item outside the caller's store. Also returned by barcode lookup.                    |
| 404  | `payment_account_not_found`    | Account is missing, in another store, wrong type for the method, or inactive.                                  |
| 404  | `sale_not_found`               | Sale is outside the caller's store, or the caller is a cashier who does not own it.                            |
| 404  | `store_not_found`              | Print receipt when the caller's store row is missing (defensive).                                              |
| 409  | `no_open_shift`                | Sale creation when the caller has no open shift in their store.                                                |
| 409  | `item_inactive`                | A sale line references an inactive item.                                                                       |
| 409  | `insufficient_stock`           | Merged quantity exceeds the item's `stock_quantity`; stock never goes below zero.                              |
| 409  | `total_mismatch`               | Server-computed `total` does not equal `expected_total` (stale price or cart).                                 |
| 409  | `idempotency_key_reused`       | The key already belongs to another staff member's sale.                                                        |
| 500  | `internal_error`               | Unexpected server failure.                                                                                     |

## Item grid and barcode lookup

The sales grid reads catalog items through these routes (both require at least `cashier`):

- `GET /api/v1/items` — paginated list. Query: `page`, `page_size`, `category_id`, `active`, `q`, `low_stock`. `low_stock=true` keeps items with `reorder_threshold > 0` and `stock_quantity <= reorder_threshold`.
- `GET /api/v1/items/barcode/:barcode` — exact barcode lookup. The path value is trimmed; the match is exact and store-scoped. Returns the same `ItemResponseDto` as list/get, or `404 item_not_found`.

`ItemResponseDto` fields used by the grid:

| Field               | Type            | Nullable | Notes                                                                 |
| ------------------- | --------------- | -------- | --------------------------------------------------------------------- |
| `id`                | string (UUID)   | no       |                                                                       |
| `sku`               | string          | no       |                                                                       |
| `barcode`           | string          | yes      |                                                                       |
| `image_key`         | string          | yes      | Storage key only, not a public URL.                                   |
| `name`              | string          | no       |                                                                       |
| `unit`              | string          | no       |                                                                       |
| `current_price`     | integer (kobo)  | no       | Price snapshotted into the sale.                                      |
| `stock_quantity`    | integer         | no       | Read-only cache; sales decrement it atomically.                       |
| `reorder_threshold` | integer         | no       | Used by `low_stock`; `0` means no low-stock warning.                  |
| `active`            | boolean         | no       | Inactive items are rejected by sales with `item_inactive`.            |
| `category_id`       | string (UUID)   | yes      |                                                                       |
| `cost_price`        | integer (kobo)  | yes      | Omitted entirely for cashiers; present for managers/admins.           |
| `store_id`          | string (UUID)   | no       |                                                                       |
| `created_at`        | string          | no       | ISO 8601 date-time.                                                   |
| `updated_at`        | string          | no       | ISO 8601 date-time.                                                   |

```json
{
  "id": "00000000-0000-4000-8000-000000000005",
  "store_id": "00000000-0000-4000-8000-000000000001",
  "sku": "SKU-0001",
  "barcode": "0123456789",
  "image_key": "stocktake/items/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/00000000-0000-4000-8000-00000000000d",
  "name": "Bottled water",
  "category_id": null,
  "unit": "piece",
  "current_price": 1000,
  "stock_quantity": 8,
  "reorder_threshold": 3,
  "active": true,
  "created_at": "2026-11-08T09:00:00.000Z",
  "updated_at": "2026-11-08T10:15:30.000Z"
}
```

**Image variant URLs:** item list/get return `image_key`, not `variants`. Variant URLs are returned only by the manager-only image routes:

- `PUT /api/v1/items/:id/image` — multipart body with `image`; returns `200`.
- `DELETE /api/v1/items/:id/image` — idempotent; returns `200`.

Both return:

```json
{
  "item_id": "00000000-0000-4000-8000-000000000005",
  "image_key": "stocktake/items/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/00000000-0000-4000-8000-00000000000d",
  "variants": {
    "thumb": "https://res.cloudinary.com/example/image/upload/c_fill,w_160,h_160,f_auto,q_auto/stocktake/items/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/00000000-0000-4000-8000-00000000000d",
    "full": "https://res.cloudinary.com/example/image/upload/c_limit,w_800,f_auto,q_auto/stocktake/items/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/00000000-0000-4000-8000-00000000000d"
  }
}
```

`variants` is `null` when the item has no image or image storage is disabled. `image_key` remains the stored key (or `null` after removal).
