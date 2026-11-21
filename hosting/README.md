# Hosting Refill Guard on Vultr with https (task 2.6)

One Ubuntu server on Vultr runs the app behind Caddy, which gets and renews the https certificate on its own. Phones need https for the microphone, so this is what the demo runs on. Until it's up, the Cloudflare quick tunnel works too (pages fall back to polling there).

```
phone / laptop ──https──▶ Caddy (:443, automatic certificate) ──▶ Next.js on 127.0.0.1:3000 ──▶ Tiger Data Postgres
```

## What you need

- The MLH Vultr code (credit) and the GoDaddy Registry domain code.
- This repository on your laptop, with a working `.env`.
- An SSH key on your laptop (`~/.ssh/id_ed25519.pub`). Make one with `ssh-keygen -t ed25519` if you don't have one.

## 1. Create the server on Vultr

1. Sign in at vultr.com and redeem the MLH code under **Billing**.
2. **Deploy** a **Cloud Compute** server: Ubuntu 24.04, 2 GB RAM or more (the build needs it), a region near the venue.
3. Add your SSH public key under **SSH Keys**, and tick it on the deploy page.
4. Note the server's **IPv4 address**.

## 2. Point the domain at it (GoDaddy)

1. Redeem the domain code, then open the domain's **DNS** settings.
2. Add an **A** record: name `@` (or a subdomain such as `refill`), value the server's IPv4 address, TTL 600.
3. Wait until `dig +short <your domain>` prints the IP. Caddy can't get a certificate before that.

## 3. Set up the server (once)

```bash
scp hosting/setup-server.sh root@<server-ip>:
ssh root@<server-ip> 'DOMAIN=<your domain> bash setup-server.sh'
```

It installs Node.js 24 (checksum checked), Caddy, a `refill-guard` systemd service bound to `127.0.0.1:3000`, and a firewall that allows only SSH, http and https.

## 4. Prepare `.env` for the server

The server reads `.env` from the app folder. Start from your laptop's `.env` and change:

| Variable | On the server |
|---|---|
| `APP_BASE_URL` | `https://<your domain>` (add `,http://localhost:3000` only if you also run it locally) |
| `DEMO_CONTROLS` | leave it out: on a public address, reset and the clock stay staff-only |
| `DATABASE_URL` | the Tiger Data URL; the CA in `certs/tiger-cloud-ca.pem` verifies it |
| `LIVE_AGENT` / `ANTHROPIC_API_KEY` | as for the demo; `LIVE_AGENT=1` also needs Claude Code signed in on the server |

`deploy.sh --env` copies `.env` over SSH and makes it readable only by the app. It never goes into git.

## 5. Tell Auth0 about the new address

In the Auth0 dashboard, **Applications → Refill Guard console → Settings**:

- **Allowed Callback URLs**: add `https://<your domain>/api/auth/callback`
- **Allowed Logout URLs**: add `https://<your domain>`

(Role 2's agent can make this change through the Management API if you'd rather.)

## 6. Deploy

From the repository root:

```bash
HOST=root@<server-ip> DOMAIN=<your domain> bash hosting/deploy.sh --env
```

It copies the code (no `node_modules`, `.git`, `.env` unless `--env`), runs `npm ci` and `npm run build` on the server, restarts the service, and checks `https://<your domain>/api/clock`. Later deploys can leave out `--env`.

## 7. Before the demo

- Open `https://<your domain>/console/today`, sign in, and press **Pair a patient's phone** for Sam. Open the link on the judge's phone within 10 minutes.
- Press **Reset demo**, then **Run daily check**: the paired phone rings.
- Allow the microphone on the phone when `/phone` asks.

## When something's wrong

| Symptom | Look at |
|---|---|
| `deploy.sh` says "Not up yet" | `ssh root@<ip> journalctl -u refill-guard -n 50` |
| Browser warns about the certificate | `ssh root@<ip> journalctl -u caddy -n 50` (usually DNS not pointing at the server yet) |
| Sign-in fails with "callback URL mismatch" | Step 5 |
| Live events stop | Caddy's `flush_interval -1` is in `/etc/caddy/Caddyfile`; pages also fall back to polling |
