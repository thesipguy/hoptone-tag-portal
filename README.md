# Hoptone portal

Admin portal for adding clients and a customer portal where each client chooses which call categories are blocked.

Stack: Node.js (Express + EJS), MariaDB, nginx in front for HTTPS.

## What it does

**Admin portal** (`/admin`)
- Add clients with email, password (bcrypt-hashed, cost 12), customer ID (string) and SIP devices as a comma-delimited string (`1001, 1002, office@pbx`). Devices are trimmed and de-duplicated.
- Every new client starts with **all categories blocked**.
- Edit a client: details, reset password, enable/disable, change their blocked categories. Delete a client.
- Manage categories (add, rename, describe, reorder, delete). The slug must match the list names in your number records (`conference-lines`, `jewish-news`, `jewish-podcasts`, `secular-media`, `standard` are pre-loaded). A newly added category is blocked for every existing client.
- Search clients by email, customer ID or SIP device. Change your own admin password.

**Customer portal** (`/`)
- Clients sign in with their email and password and switch each category between Blocked and Allowed.
- Clients can change their own password. Disabled clients cannot sign in.

**Blocklist API** (for your call-blocking engine, optional)
Send `Authorization: Bearer <API_KEY>`:
- `GET /api/v1/blocklist?device=1001` returns the client owning that SIP device
- `GET /api/v1/blocklist?customer_id=CUST-001`
- `GET /api/v1/customers` returns every active client

```json
{"customer_id":"CUST-001","sip_devices":["1001","1002"],"blocked_lists":["conference-lines","secular-media"]}
```
A call should be blocked when any of the caller number's `lists` is in the client's `blocked_lists`.
The API is disabled unless `API_KEY` is set. Disabled clients are left out.

Security: sessions stored in MariaDB, httpOnly + SameSite cookies (Secure behind HTTPS), CSRF tokens on every form, login rate limiting (10 attempts / 15 min / IP), session regenerated on login, helmet security headers.

## Install

See [INSTALL.md](INSTALL.md) for step-by-step instructions for a fresh Debian server.

## Day-to-day

- Logs: `journalctl -u hoptone-portal -f`
- Add another admin or reset an admin password: `cd /opt/hoptone-portal && npm run create-admin -- other@yourdomain.com`
- Update code: `cd /opt/hoptone-portal && git pull && npm ci --omit=dev && systemctl restart hoptone-portal`
- Backup: `mariadb-dump hoptone_tag_portal > hoptone-$(date +%F).sql`

## Database

| Table | Purpose |
|---|---|
| `admins` | Admin logins |
| `customers` | `customer_id`, `email`, `password_hash`, `sip_devices` (normalised comma string), `is_active` |
| `categories` | `slug` (matches number `lists`), `name`, `description`, `sort_order` |
| `customer_blocked_categories` | One row per client per **blocked** category |
| `sessions` | Login sessions |

To see what a device blocks directly in SQL:
```sql
SELECT cu.customer_id, c.slug
  FROM customers cu
  JOIN customer_blocked_categories b ON b.customer_id = cu.id
  JOIN categories c ON c.id = b.category_id
 WHERE cu.is_active = 1 AND FIND_IN_SET('1001', cu.sip_devices);
```
