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

## Install on Debian 12

Run as root (or with sudo).

```bash
# 1. Packages
apt update
apt install -y mariadb-server nginx curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
mariadb-secure-installation        # optional but recommended

# 2. App user and code
useradd --system --home /opt/hoptone-portal --shell /usr/sbin/nologin hoptone
mkdir -p /opt/hoptone-portal
cp -r ./hoptone-portal/* /opt/hoptone-portal/     # copy this folder to the server first
cd /opt/hoptone-portal
npm ci --omit=dev || npm install --omit=dev

# 3. Database
DBPASS=$(openssl rand -hex 16)
mariadb -e "CREATE DATABASE hoptone_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            CREATE USER 'hoptone'@'localhost' IDENTIFIED BY '$DBPASS';
            GRANT ALL PRIVILEGES ON hoptone_portal.* TO 'hoptone'@'localhost';"
mariadb hoptone_portal < schema.sql

# 4. Config
cp .env.example .env
sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$DBPASS/" .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^API_KEY=.*/API_KEY=$(openssl rand -hex 32)/" .env     # skip if you don't need the API
chown -R hoptone:hoptone /opt/hoptone-portal
chmod 600 .env

# 5. First admin (prompts for a password)
sudo -u hoptone npm run create-admin -- you@yourdomain.com

# 6. Service
cp deploy/hoptone-portal.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hoptone-portal
systemctl status hoptone-portal

# 7. nginx + HTTPS
cp deploy/nginx-hoptone-portal.conf /etc/nginx/sites-available/hoptone-portal
sed -i 's/portal.example.com/portal.yourdomain.com/' /etc/nginx/sites-available/hoptone-portal
ln -s /etc/nginx/sites-available/hoptone-portal /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d portal.yourdomain.com
```

Then open `https://portal.yourdomain.com/admin` to add clients. Clients sign in at `https://portal.yourdomain.com/`.

`BEHIND_PROXY=1` (the default in `.env.example`) makes session cookies HTTPS-only, so the portal must be reached through nginx with HTTPS. For a quick test over plain HTTP, set `BEHIND_PROXY=0`.

## Day-to-day

- Logs: `journalctl -u hoptone-portal -f`
- Add another admin or reset an admin password: `sudo -u hoptone npm run create-admin -- other@yourdomain.com`
- Update code: copy new files over, `npm install --omit=dev`, `systemctl restart hoptone-portal`
- Backup: `mariadb-dump hoptone_portal > hoptone-$(date +%F).sql`

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
