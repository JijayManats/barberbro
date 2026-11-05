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

Required environment variables:

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`
- `EMAIL_HOST`
- `EMAIL_PORT`
- `EMAIL_USER`
- `EMAIL_PASS`
- `EMAIL_FROM`

Render will provide the `PORT` automatically; do not hardcode it unless you are explicitly using a custom setup.

The repository also includes a `render.yaml` file that can be used with Render Blueprint deployments.

Configure the `EMAIL_*` settings on the deployed backend service. For Gmail, use an app password rather than the account's normal password. The admin portal reports whether the SMTP server accepted the recipient; acceptance does not guarantee inbox placement, so check spam/quarantine if the message was accepted but is not visible.

The admin portal refreshes shared records every 10 seconds while open. The customer app refreshes membership and visit history every 10 seconds and the active barber list every 30 seconds; both refresh sooner when brought back to the foreground.

## Admin credentials

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` in your environment. The password hash should be a bcrypt hash generated from the desired admin password.

## Customer activation flow

1. Add a customer in the admin dashboard.
2. Generate an activation code for that customer.
3. Share the member code, activation code, and email with the customer.
4. The customer uses the activation screen in the customer app to create a password.
5. After activation, the customer can sign in normally.
