# ERP Inventory API

ERP is mounted in the main backend. Start it with `npm run dev` from the backend folder; the ERP endpoints use the same origin and port as the backend (default `http://localhost:5000`). ERP endpoints do not require a token. Inventory stock can only be changed through movement documents; product create/update requests cannot set stock directly.

## Products

- `GET /erp/products?keyword=&category=&isActive=` lists and searches active catalog records by product name or SKU.
- `POST /erp/products` creates a product with `sku`, `name`, and optional `category`, `unit`, `description`, `reorderLevel`.
- `GET /erp/products/:id` reads a product.
- `PUT /erp/products/:id` edits product metadata. Stock fields are rejected.
- `DELETE /erp/products/:id` soft-deletes a product only when its stock is zero.
- `GET /erp/products/:id/movements?year=&month=` reads the product ledger.
- Product records include `salePrice` (retail), `storePrice`, and optional `weightPerUnit`; invoices default to retail and can choose store pricing, while issue-slip weight defaults to quantity × product weight.

## Printable Documents

- `POST /erp/documents` creates a multi-line `salesInvoice` or `stockIssue`. The complete document and its issue movements are saved in one MongoDB transaction; if any product would go below zero, the entire operation rolls back.
- `GET /erp/documents?year=&month=&type=&keyword=` lists saved documents.
- `GET /erp/documents/:id` reads a saved document by Mongo ID or document number for reprinting.
- Document lines preserve product/SKU/unit snapshots, fractional quantities (up to three decimals), unit price, line amount, package note, and weight. Invoice headers also preserve customer, delivery, old debt, paid amount, and payment-in-words fields.
- Invoice documents support `priceType: "retail" | "store"`, `isDebt`, and `depositAmount`. Non-debt invoices are recorded as paid; debt invoices remain on the customer balance and their printed copy hides all price and amount fields. Deposits reduce the amount due.
- `GET /erp/debts` returns customers with outstanding invoices explicitly marked as debt. Debt balances aggregate by normalized customer name.
- `GET /erp/debts/:customerKey/payments` returns that customer's payment history.
- `POST /erp/payments` records a payment and allocates it oldest-debt-first. For `method: "bankTransfer"`, `proofImageUrl` is required.
- `POST /erp/uploads/payment-proof` accepts multipart field `image` and returns a Cloudinary URL. JPEG, PNG, WebP, and GIF up to 5 MB are accepted; configure the three Cloudinary environment variables on the backend.

## Stock Movements

- `POST /erp/movements` creates a `receipt`, `issue`, or `stocktake` document. Supply `productId`, `type`, integer `quantity`, and `movementDate`. For an `issue`, also supply `customerName` and `imageUrl`. A stocktake quantity is the physical count found.
- `GET /erp/movements?year=&month=&productName=&type=` lists ledger entries.
- `GET /erp/exports?year=&month=&productName=` queries shipped products only (`type=issue`).
- `PUT /erp/movements/:id` corrects a movement. Accepted fields include `productId`, `type`, `quantity`, `customerName`, `imageUrl`, `reference`, `note`, and `movementDate`. The ledger is replayed chronologically in a transaction; a correction that creates negative stock is rejected.
- `GET /erp/export.xlsx?year=2026&month=3` downloads the selected month's Excel workbook, including quantities, stock before/after, customer, and shipment image URL.

Dates are filtered by the `Asia/Ho_Chi_Minh` calendar month. Monthly queries require both `year` and `month`.

**Security:** all ERP endpoints are publicly accessible to clients that can reach the backend. Anyone who can access the API can read/export data and create or edit products and stock movements. Use it only on a trusted local network, or place the backend behind a firewall/private network before deployment. CORS is not an access-control mechanism.