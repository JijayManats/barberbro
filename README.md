# BarberBro

BarberBro is a full-stack barbershop membership system with:

- Admin dashboard for managing customers, visits, and rewards
- Customer portal for loyalty tracking and account access
- PostgreSQL-backed data layer
- JWT authentication and protected admin routes

## Prerequisites

- Node.js 18+
- PostgreSQL database
- npm

## Environment setup

1. Copy `.env.example` to `.env` in the project root.
2. Fill in your real PostgreSQL connection string and secure secrets.
3. Use the same values in your deployment environment.

Example:

```bash
cp .env.example .env
```

## Install dependencies

```bash
npm install
cd admin-web && npm install && cd ..
cd customer-app && npm install && cd ..
```

## Initialize the database

```bash
npm run setup-db
```

This creates the required tables, including customer authentication and activation-code support.

## Run locally

Backend:

```bash
npm run dev
```

Admin portal:

```bash
cd admin-web
npm run dev
```

Customer portal:

```bash
cd customer-app
npm run dev
```

## Production build

```bash
npm run build:all
```

The backend includes static-serving support for the built frontend apps, so a single deployment can host both portals.

## Deployment notes

- Use a managed PostgreSQL service such as Neon, Supabase, Render, Railway, or Heroku Postgres.
- Set environment variables in your deployment platform from `.env.example`.
- For Render/Railway/Heroku, set `PORT` automatically from the host, and make sure `DATABASE_URL` is reachable.
- The backend listens on `0.0.0.0` and serves the built frontends if they are present in `admin-web/dist` and `customer-app/dist`.

## Render deployment

This project is already structured as a single Node.js web service that serves both the admin app and customer app from the same backend.

Create a new Render Web Service from this repository and use these settings:

- Build command: `npm install && npm run build:all`
- Start command: `node server.js`
- Health check path: `/api/health`
- Node version: 20+

Required backend environment variables:

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`

Email delivery requires either the Resend settings or the SMTP settings below.

Render will provide the `PORT` automatically; do not hardcode it unless you are explicitly using a custom setup.

The repository also includes a `render.yaml` file that can be used with Render Blueprint deployments.

### Fixing activation-code email delivery on Render

The customer activation code is sent by the backend. An SMTP connection timeout means the backend could not reach the SMTP server; it is not evidence that the activation code itself is invalid. Resend is also supported on Render because it sends over HTTPS.

1. Create a Resend account and verify a sending domain.
2. Create a Resend API key.
3. In Render, open the BarberBro web service, then **Environment**.
4. Add `RESEND_API_KEY` with the key value and `EMAIL_FROM` with a sender on the verified domain, such as `BarberBro <noreply@your-verified-domain.com>`.
5. Save the changes and wait for Render to redeploy. Do not share the API key in chat or commit it to the repository.
6. Retry the activation email in the admin portal, or generate a code for a customer who has not yet been sent one. Check Render logs for a Resend accepted/rejected result.

When `RESEND_API_KEY` is present, the backend uses Resend for activation-code email. If you prefer SMTP, configure `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, and `EMAIL_FROM` in Render. For Gmail, use `smtp.gmail.com`, port `587`, your Gmail address, and a Google App Password (not your normal account password); first enable 2-Step Verification and create the App Password in your Google Account. `EMAIL_FROM` should be an allowed sender for that SMTP account. A timeout can also indicate the SMTP host or port is unreachable from the hosting service, so use Resend if the SMTP connection continues to time out.

The admin portal reports whether the mail provider accepted the recipient; acceptance does not guarantee inbox placement, so check spam/quarantine if accepted mail is missing.

The admin portal refreshes shared records every 10 seconds while open. The customer app refreshes membership and visit history every 10 seconds and the active barber list every 30 seconds; both refresh sooner when brought back to the foreground.

The admin visit scanner uses the browser's native `BarcodeDetector` when available, with ZXing and jsQR as decoder fallbacks. Image scanning tries upscaled, cropped, and light/dark padded versions of an uploaded image to recover older QR tickets without a quiet zone. New customer visit QR codes are generated as conventional black-on-white PNG canvas codes with a four-module quiet zone and medium error correction. The admin scanner defaults to the rear camera on mobile and can switch between front and rear cameras. The deployed admin page must use HTTPS for camera access.

## Admin credentials

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` in your environment. The password hash should be a bcrypt hash generated from the desired admin password.

## Customer activation flow

1. Add a customer in the admin dashboard.
2. Generate an activation code for that customer.
3. Share the member code, activation code, and email with the customer.
4. The customer uses the activation screen in the customer app to create a password.
5. After activation, the customer can sign in normally.

## Customer reward redemption

Admins configure active reward names and stamp requirements in the admin portal. Signed-in customers can redeem any eligible reward from **My Rewards** in the customer app. Redemption is recorded against the authenticated customer's account, deducts that reward's stamp requirement, and carries any extra stamps forward. Reward redemption is not available from the admin portal.
