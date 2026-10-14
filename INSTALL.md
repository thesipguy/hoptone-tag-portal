# Installing the Hoptone portal on Debian

These steps take a fresh Debian 12 or 13 server to a working portal over HTTPS.
Run every command as **root** (log in as root, or run `sudo -i` first).

You need:
- A Debian server with a public IP address
- A domain name pointed at that server, for example `portal.yourdomain.com` (an A record)
- Access to the GitHub repo `thesipguy/hoptone-tag-portal`

Wherever you see `portal.yourdomain.com` or `you@yourdomain.com`, replace it with your own value.

---

## Step 1. Install the packages

```bash
apt update && apt upgrade -y
apt install -y git curl openssl mariadb-server nginx nodejs npm certbot python3-certbot-nginx
```

Check that Node.js is version 18 or newer:

```bash
node -v
```

## Step 2. Secure MariaDB

```bash
mariadb-secure-installation
```

Press Enter for the current root password (it's blank). Answer **Y** to every question after that.

## Step 3. Let the server read the private GitHub repo

The repo is private, so the server needs a read-only "deploy key".

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/hoptone_deploy -C "hoptone server"
cat /root/.ssh/hoptone_deploy.pub
```

Copy the line that `cat` prints, which starts with `ssh-ed25519`. Then add it on GitHub:

1. Open https://github.com/thesipguy/hoptone-tag-portal/settings/keys
2. Click **Add deploy key**
3. Title: `hoptone server`. Paste the key. Leave **Allow write access** unchecked.
4. Click **Add key**

Then tell the server to use that key for GitHub:

```bash
cat >> /root/.ssh/config <<'EOF'
Host github.com
  IdentityFile /root/.ssh/hoptone_deploy
  IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config
ssh -T git@github.com
```

Type `yes` if it asks about the host fingerprint. A message saying you've "successfully authenticated" means the key works.

## Step 4. Download the code

```bash
git clone git@github.com:thesipguy/hoptone-tag-portal.git /opt/hoptone-portal
cd /opt/hoptone-portal
npm ci --omit=dev
```

## Step 5. Create the database

This makes the `hoptone_tag_portal` database and a database user with a random password. It also loads the tables and the 5 categories.

```bash
DBPASS=$(openssl rand -hex 16)
mariadb -e "CREATE DATABASE hoptone_tag_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            CREATE USER 'hoptone'@'localhost' IDENTIFIED BY '$DBPASS';
            GRANT ALL PRIVILEGES ON hoptone_tag_portal.* TO 'hoptone'@'localhost';"
mariadb hoptone_tag_portal < /opt/hoptone-portal/schema.sql
```

Run Step 6 in the **same terminal session**, because it uses `$DBPASS`.

## Step 6. Create the settings file

```bash
cd /opt/hoptone-portal
cp .env.example .env
sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$DBPASS/" .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^API_KEY=.*/API_KEY=$(openssl rand -hex 32)/" .env
```

Check it:

```bash
cat .env
```

`DB_NAME` should say `hoptone_tag_portal`, and `DB_PASSWORD`, `SESSION_SECRET` and `API_KEY` should be long random strings. If you won't use the blocklist API, you can blank out `API_KEY=`.

## Step 7. Create the service user and lock down the settings file

The app runs as its own user. Only that user can read `.env`.

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin hoptone
chown hoptone:hoptone /opt/hoptone-portal/.env
chmod 600 /opt/hoptone-portal/.env
```

## Step 8. Create your admin login

```bash
cd /opt/hoptone-portal
npm run create-admin -- you@yourdomain.com
```

It will ask for a password, which must be at least 8 characters.

## Step 9. Start the portal as a service

```bash
cp /opt/hoptone-portal/deploy/hoptone-portal.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hoptone-portal
systemctl status hoptone-portal --no-pager
```

You should see **active (running)**. To double-check, run this. It should print `302`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/admin
```

## Step 10. Put it on your domain with nginx

```bash
cp /opt/hoptone-portal/deploy/nginx-hoptone-portal.conf /etc/nginx/sites-available/hoptone-portal
sed -i 's/portal.example.com/portal.yourdomain.com/' /etc/nginx/sites-available/hoptone-portal
ln -s /etc/nginx/sites-available/hoptone-portal /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

`nginx -t` should say "syntax is ok" and "test is successful".

## Step 11. Turn on HTTPS

```bash
certbot --nginx -d portal.yourdomain.com
```

Enter your email and agree to the terms. Choose **redirect** if it asks. Certbot renews the certificate automatically.

Logins only work over HTTPS. The settings file has `BEHIND_PROXY=1`, which makes the login cookie HTTPS-only.

## Step 12. Open the firewall (if you use one)

```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

You don't need to open port 3000. The app only listens on the server itself, behind nginx.

## Step 13. Log in

- Admin portal: `https://portal.yourdomain.com/admin`. Sign in with the email and password from Step 8, then click **Add client**.
- Customer portal: `https://portal.yourdomain.com/`. Clients sign in here with the email and password you gave them.

---

## Later

**Update to the latest code**
```bash
cd /opt/hoptone-portal && git pull && npm ci --omit=dev && systemctl restart hoptone-portal
```

**See the logs**
```bash
journalctl -u hoptone-portal -f
```

**Add another admin, or reset an admin password**
```bash
cd /opt/hoptone-portal && npm run create-admin -- other@yourdomain.com
```

**Back up the database**
```bash
mariadb-dump hoptone_tag_portal > /root/hoptone-$(date +%F).sql
```

**Use the blocklist API** (the key is `API_KEY` in `/opt/hoptone-portal/.env`)
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" "https://portal.yourdomain.com/api/v1/blocklist?device=1001"
```

## If something goes wrong

| Problem | Fix |
|---|---|
| `systemctl status` shows **failed** | Run `journalctl -u hoptone-portal -n 50`. "SESSION_SECRET must be set" means Step 6 didn't run. "Access denied" means the `DB_PASSWORD` in `.env` doesn't match the one from Step 5. |
| Login page reloads with no error | You're on `http://`, not `https://`. Finish Step 11, or for a quick test set `BEHIND_PROXY=0` in `.env` and restart. |
| `git clone` says "Permission denied (publickey)" | The deploy key from Step 3 isn't on GitHub yet, or `/root/.ssh/config` is missing. |
| nginx shows **502 Bad Gateway** | The app isn't running. Check `systemctl status hoptone-portal`. |
| "Too many login attempts" | Wait 15 minutes. Logins are limited to 10 tries per 15 minutes from one IP address. |
