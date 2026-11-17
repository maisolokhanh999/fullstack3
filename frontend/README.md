# ERP Inventory Frontend

React + Vite interface for the inventory API.

## Run locally

Start the backend from `backend` with `npm run dev`. Start this app from `frontend` with `npm run dev`; open the Vite URL to use the ERP dashboard.

The frontend calls `http://localhost:5000` by default. Set `VITE_ERP_API_BASE_URL` in `frontend/.env.local` to the backend origin when it runs elsewhere. Do not include `/erp` in the URL.

The ERP API currently has no authentication. Run it only on a trusted network or behind a private firewall.

## Checks

Run `npm run lint`, `npm test`, and `npm run build` in this folder. Playwright starts Vite on `127.0.0.1:5178` and uses mocked ERP responses.
