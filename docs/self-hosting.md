# Running JETStream on your own server

JETStream is one Node.js process that serves both the web app and its API, with a PostgreSQL database. Put a web server with HTTPS in front of it.

**Before the first real use, try all of this with test data.** It has not yet run against a real PostgreSQL server, a real mail server, or a real HTTPS proxy.

## What you need

- A server that always runs (Linux or Windows), with Node.js 20.9+ or 22
- PostgreSQL 14 or newer, with an empty database and a user that owns it
- A name for it, such as `time.example.com`, with an HTTPS certificate
- For email: your mail server's address, user and password

## Set up

```sh
git clone <the repository> /opt/jetstream && cd /opt/jetstream
npm ci
npm run build
npm prune --omit=dev
```

Write the settings to `/etc/jetstream.env`, readable only by the user that runs it (start from [`.env.example`](../.env.example)). Then, with those settings in the environment:

```sh
npm run db:migrate      # makes the tables
npm run admin:create    # makes the first administrator
npm start
```

| Setting | Meaning |
| --- | --- |
| `DATABASE_URL` | Required. `postgres://user:password@host:5432/jetstream` |
| `PUBLIC_URL` | Required. The address people use, such as `https://time.example.com/`. Links in messages are made from it |
| `HOST`, `PORT` | Where it listens. `127.0.0.1` and `3000` unless set. Keep it on this computer, behind the proxy |
| `TRUST_PROXY` | How many proxies are in front; `1` behind nginx or Caddy. Needed for sign-in limits to see the right address |
| `BASE_PATH` | Only if it is not at the root, such as `/jetstream`. Must match `PUBLIC_URL` |
| `SMTP_URL` | `smtp://user:password@mail.example.com:587` or `smtps://…:465`. Characters such as `@` in the password must be percent-encoded. Without it, messages are only kept in the Outbox |
| `EMAIL_FROM` | Required with `SMTP_URL`. `JETStream <time@example.com>` |
| `ALLOW_INSECURE_HTTP` | Only for a closed network without HTTPS. Passwords then travel unprotected |

Check that it runs: `curl http://127.0.0.1:3000/api/health` answers `{"status":"ok","database":"ok"}`. Monitoring can ask the same.

### Keep it running

- **Linux:** [`deploy/jetstream.service`](../deploy/jetstream.service) for systemd.
- **Windows:** run `node dist\server\main.js` in the project folder as a service with a tool such as NSSM, with the settings in the service's environment. Not tried.
- **HTTPS:** [`deploy/nginx.conf`](../deploy/nginx.conf) or [`deploy/Caddyfile`](../deploy/Caddyfile). Uploads need 5 MB.

## After setting up

1. Sign in and set the company's name, address, logo, currency, week and payment terms in **Settings**.
2. Add expense categories and tasks, then clients and projects.
3. Invite people. Give whoever approves and bills a role with those permissions, or make them an administrator.
4. Send yourself an estimate or invoice to see that email arrives.

## Backup and restore

Everything, with receipts, is in the database. Back it up every night, keep copies on another computer, and try restoring one.

```sh
pg_dump --format=custom --file=jetstream-$(date +%F).dump "$DATABASE_URL"
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" jetstream-2026-11-25.dump
```

Stop JETStream while restoring. The CSV export in Settings is no backup: it leaves out receipts, history and sign-ins.

## Update

Back up first. Then, in the project folder:

```sh
git pull
npm ci && npm run build && npm prune --omit=dev
npm run db:migrate
sudo systemctl restart jetstream
```

It refuses to start while migrations are missing.

## Before people rely on it

- [ ] HTTPS works, and `http://` leads to it
- [ ] The server's port and PostgreSQL cannot be reached from outside
- [ ] `/etc/jetstream.env` is readable only by its user
- [ ] Never run `npm run dev` or `npm run demo` where others reach it
- [ ] Nobody loaded demo data (`npm run db:seed`) into the real database
- [ ] Backups run, and one was restored as a test
- [ ] Updates of Node.js, PostgreSQL and the system are someone's job
- [ ] Two administrators exist, so that one can let the other back in

## Known advisories

`npm audit` reports advisories in React Router 6 (fixed only in version 7, which needs Node 20) and nodemailer (fixed only in version 10, which needs Node 20). They are about features this app does not use: server rendering, links made from what others type, several mail servers in one process, and raw messages. Update both when Node 18 no longer has to be supported.
