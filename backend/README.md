# CYX Club Backend

Cloudflare Workers backend for the CYX Club game boosting website.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite)
- **Sessions:** Cloudflare KV
- **Language:** TypeScript

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create D1 Database

```bash
wrangler d1 create cyx-club-db
```

Copy the `database_id` from the output and update `wrangler.toml`.

### 3. Create KV Namespace

```bash
wrangler kv namespace create SESSIONS
```

Copy the `id` from the output and update `wrangler.toml`.

### 4. Run migrations

```bash
npm run seed
```

### 5. Set admin password

```bash
npx tsx scripts/seed-admin.ts
```

Copy the SQL output and run it:

```bash
wrangler d1 execute cyx-club-db --command "UPDATE users SET password_hash = '<hash>' WHERE username = 'admin';"
```

### 6. Update wrangler.toml

Replace the placeholder IDs in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "cyx-club-db"
database_id = "<your-d1-database-id>"

[[kv_namespaces]]
binding = "SESSIONS"
id = "<your-kv-namespace-id>"
```

### 7. Update CORS origins

Update `ALLOWED_ORIGINS` in `wrangler.toml` with your frontend domains.

## Development

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

## API Endpoints

### Auth (No auth required)
- `POST /api/auth/register` - Register with card_key + username + password
- `POST /api/auth/login` - Login (user)
- `POST /api/auth/employee/login` - Login (employee)
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Check current session

### Orders (User auth required)
- `POST /api/orders` - Create order
- `GET /api/orders` - List user's orders
- `GET /api/employees` - List available employees

### Employee (Employee auth required)
- `GET /api/employee/orders` - List assigned orders
- `PUT /api/employee/orders/:id/status` - Update order status

### Admin (Admin auth required)
- `POST /api/admin/cards` - Generate card keys (batch)
- `GET /api/admin/cards` - List card keys
- `POST /api/admin/employees` - Create employee account
- `GET /api/admin/employees` - List employees
- `GET /api/admin/orders` - List all orders
- `GET /api/admin/stats` - Dashboard stats

## Response Format

All responses follow this format:

```json
{
  "success": true,
  "data": { ... }
}
```

or on error:

```json
{
  "success": false,
  "error": "Error message"
}
```

## Session Management

- Sessions stored in KV with 7-day expiry
- Session token in HTTP-only cookie `cyx_session`
- Passwords hashed with PBKDF2 (SHA-256, 100k iterations)
