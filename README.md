# BarberBro

BarberBro is a full-stack barbershop membership system with:

- Admin dashboard for managing customers, visits, and rewards
- Admin-managed hairstyle catalog with reference image uploads for customer visit tickets
- Barber performance statistics for haircut counts, gross visit sales, popular styles, and repeat customers
- Customer portal for loyalty tracking and account access
- Authenticated live updates across the admin portal and customer app
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
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`

Activation emails use the Gmail API over HTTPS and do not require a custom domain or a Resend account.

Render will provide the `PORT` automatically; do not hardcode it unless you are explicitly using a custom setup.

The repository also includes a `render.yaml` file that can be used with Render Blueprint deployments.

The admin **Barbers** page summarizes recorded visits and gross visit amounts for today, the current week, month, and year using Asia/Manila time. It also shows all tied top haircut styles and repeat customers across all recorded visits; style and customer insights only appear after at least two matching visits.

While signed in, both frontends receive authenticated server-sent update events after successful API changes and refresh their data automatically. They reconnect when the connection drops and retain periodic refreshes as a fallback.

### Fixing activation-code email delivery on Render

The activation email contains only the member ID and activation code, with no QR code. It is sent through Gmail's HTTPS API, so Render Free's SMTP restrictions do not apply. No custom domain, Gmail App Password, or Resend account is needed.

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project and enable the Gmail API.
2. Set up Google Auth Platform's consent screen. For an external app in **Testing** status, add the Gmail sender account as a test user.
3. Create an OAuth client ID of type **Web application** and add `https://developers.google.com/oauthplayground` as an authorized redirect URI.
4. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground). In its settings, enable **Use your own OAuth credentials**, enter that client ID and secret, and use offline access with the consent prompt.
5. In Step 1, enter `https://www.googleapis.com/auth/gmail.send`, authorize with the sender Gmail account, then exchange the authorization code in Step 2. Copy the refresh token. Keep the token and client secret private.
6. In Render, set `EMAIL_USER` to the authorized sender Gmail address, and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`. Save and redeploy.

The Gmail account authorizing the refresh token must match `EMAIL_USER`. Never commit these values or send them in chat. Google refresh tokens for external apps left in **Testing** expire after 7 days for Gmail scopes; for ongoing delivery, review Google's [OAuth publishing and verification requirements](https://support.google.com/cloud/answer/10311615?hl=en). Tokens can also be revoked or expire for other reasons, in which case generate a replacement. The admin portal can retry the existing activation code after delivery is configured. Gmail accepting the API request does not guarantee inbox placement, so check spam if the recipient doesn't see it.

The admin portal refreshes shared records every 10 seconds while open. The customer app refreshes membership and visit history every 10 seconds and the active barber and hairstyle catalogs every 30 seconds; both refresh sooner when brought back to the foreground.

The **Haircut Styles** page lists the 13 built-in hairstyles and any custom styles. Built-in styles are seeded into PostgreSQL with stable catalog keys, so admins can edit their names and reference images without creating duplicates after a restart. Custom styles can also be added, edited, and removed. Images are resized in the browser and stored with the hairstyle; the customer picker uses this shared catalog and retains bundled defaults if the API is unavailable. Customer visit tickets include the selected style name so the admin scanner records the correct service.

The admin visit scanner uses the browser's native `BarcodeDetector` when available, with ZXing and jsQR as decoder fallbacks. Image scanning tries upscaled, cropped, and light/dark padded versions of an uploaded image to recover older QR tickets without a quiet zone. New customer visit QR codes are generated as conventional black-on-white PNG canvas codes with a four-module quiet zone and medium error correction. The admin scanner defaults to the rear camera on mobile and can switch between front and rear cameras. The deployed admin page must use HTTPS for camera access.

## Admin credentials

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` in your environment. The admin signs in with the username (default: `admin001`); existing deployments can temporarily keep using `ADMIN_EMAIL` as a legacy fallback. The password hash should be a bcrypt hash generated from the desired admin password.

## Customer activation flow

1. Add a customer in the admin dashboard.
2. Generate an activation code for that customer.
3. Share the member code, activation code, and email with the customer.
4. The customer uses the activation screen in the customer app to create a password.
5. After activation, the customer can sign in normally.

## Customer reward redemption

Admins configure active reward names and stamp requirements in the admin portal. Signed-in customers can redeem any eligible reward from **My Rewards** in the customer app. Redemption is recorded against the authenticated customer's account, deducts that reward's stamp requirement, and carries any extra stamps forward. Reward redemption is not available from the admin portal.
