# Housik

Shared house trips, without a spreadsheet. Svelte 5 + SvelteKit 3, TypeScript, SQLite and a Node server.

## Run with containers

```sh
git clone https://github.com/Chipi-Chapa-Corp/housik.git
cd housik
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:4827>. Podman works with the same files: `podman compose up -d --build`.

`Containerfile` builds the app and its native SQLite dependency in a separate build stage. The running container uses the non-root `node` user. SQLite and uploaded receipts live in the `housik_data` named volume and survive container replacement. The service includes a health check.

Set `OPENAI_API_KEY` in `.env` to enable receipt scanning. No API key is needed for the rest of the app. `.env`, local databases, uploads, and test data are excluded from the image and Git.

Optional `.env` settings:

```dotenv
HOUSIK_PORT=4827
HOUSIK_BIND=127.0.0.1
ORIGIN=http://localhost:4827
```

For another host port, change both `HOUSIK_PORT` and the port in `ORIGIN`. For access through a reverse proxy, set `ORIGIN` to the external URL. Set `HOUSIK_BIND=0.0.0.0` to expose the port beyond localhost.

```sh
docker compose logs -f housik
docker compose down
```

`down` keeps the data volume. `down -v` also deletes the trip database and receipts. Existing development data is not automatically imported into the container volume.

## Tailscale Funnel

Funnel forwards the existing local app port to a public HTTPS URL. Run Tailscale on the same host as Docker/Podman; Housik can remain bound to `127.0.0.1`.

1. Start Housik with `docker compose up -d --build`.
2. On that host, with Tailscale installed and signed in, run:

   ```sh
   tailscale funnel --bg http://127.0.0.1:4827
   tailscale funnel status
   ```

   Follow Tailscale's enablement prompt if Funnel is not enabled yet. The command prints your public URL.

3. Set `ORIGIN` in `.env` to that exact HTTPS URL, for example:

   ```dotenv
   HOUSIK_PORT=4827
   HOUSIK_BIND=127.0.0.1
   ORIGIN=https://your-machine.your-tailnet.ts.net
   ```

4. Recreate the app container to apply it:

   ```sh
   docker compose up -d --force-recreate
   ```

Open the Funnel URL. The app uses it for secure session cookies and same-origin form/upload checks; TLS is handled by Tailscale. Setting `ORIGIN` does not require rebuilding the image. Do not point `ORIGIN` at localhost when using the Funnel URL.

If host port 4827 is occupied, set `HOUSIK_PORT=3080` and target `http://127.0.0.1:3080` in the Funnel command. The public URL in `ORIGIN` stays the URL printed by Funnel, independent of the local port.

If the default HTTPS listener is already used by another Tailscale service, choose a separate public port:

```sh
tailscale funnel --bg --https=8443 http://127.0.0.1:4827
```

Include `:8443` in `ORIGIN` in that case. Use the corresponding Podman Compose commands when running Podman.

To remove only this forwarding rule:

```sh
tailscale funnel --https=443 off
```

For the 8443 example, use `--https=8443 off` instead. See the [official Funnel command reference](https://tailscale.com/docs/reference/tailscale-cli/funnel).

## Run locally

Requires Node 22.17+.

```sh
npm install
cp .env.example .env
npm run dev
```

Open the URL printed by Vite. Enter a name (up to 20 characters) and password; a new name creates an account on first sign-in. There is no separate registration screen. Existing names require their original password.

## What works

- Multiple trips per account; globally unique trip names and name invitations.
- Trip owners manage people, rent, purchases, receipt imports and tags. Only a payment’s receiver can confirm or undo it, including when the sender is the trip owner.
- Invited people can read the trip and change **only their own** expense participation: default, include, exclude, cover fully, or contribute extra. They cannot edit other people or confirm payments to another person.
- Trips use arrival and departure dates; nights are calculated automatically. Rent can be entered as a total or a nightly rate × the calculated nights. Trip settings accept an HTTP(S) location link; the house/place name becomes clickable.
- Separate extra expenses cover fuel, car costs, benefit credits, and other contributions. Their value is entered in the trip currency and credited to the person who paid.
- Receipt photos/PDFs are stored privately. Scanning extracts line items using OpenAI's Responses API and structured outputs. Review/edit every item before importing it atomically. Each receipt creates a group with its own default payers and adds its items to the purchase list. Manual receipt entry works without an API key.
- Per-person shares, expenses paid, transfers sent/received, overpayments, and live remaining balances.
- A settlement plan, paid/unpaid tracking, partial payments, undo, and CSV export.
- Responsive layouts, keyboard-accessible dialogs, and an optional sample trip created from the trips page.

## Sharing

Invite a person's name from the trip. They may already have an account or create it later using that name. Their trip appears after sign-in. Names are case-insensitive. The URL alone does not grant access. Invitations apply immediately; include only names belonging to the intended person.

## Install as an app

Housik supports installation as a PWA with a home-screen icon and a standalone window. Serve it over HTTPS (localhost also works for development). On Android, use the browser menu's Install app or Add to Home screen action. On iPhone, use Safari's Share → Add to Home Screen and enable Open as Web App when offered.

The service worker caches only public app assets and an offline screen. Trip data, receipts, sign-in and payments require a connection; private pages are never cached and changes are not queued offline. Reconnecting and selecting Try again returns to the requested page. Updates activate after existing app windows close.

Icons are PNG exports of `static/favicon.svg`, with an opaque square background; the maskable variant adds padding around the house.

## Currency and interface

All trips use CZK. The initial placeholder EUR entries are relabeled as CZK without changing their amounts, as requested. UI text uses 1rem throughout. The personal summary shows the signed-in member’s signed remaining balance (+ receive / − pay); the Settle card opens settlements. Expenses show plain full expense totals. People cards show the signed balance calculation: purchases paid + transfers sent − share − received. Transfers settle the trip balance and are not assigned to individual expense lines. Confirmed payments use green + amounts and require confirmation before undo.

## Split rules

Amounts use integer minor units (cents/halers). An ungrouped expense defaults to everyone. The Share with dropdown accepts multiple tags. The union of their participants shares the expense, with each person counted once; Everyone uses the whole trip. A tag defines its default participants. Each signed-in member can adjust only their own participation. An individual inclusion/exclusion overrides that default. Full payers split the whole expense equally among themselves. Extra contributions are added to the volunteer’s ordinary share. Other participants split the reduced remainder. Volunteers never receive a discount from their own extra, and shares of other expenses stay unchanged. Extras cannot exceed the other participants’ shares. The app rejects a split with no payers.

Any indivisible cent goes to participants in stable ID order. Adding a person includes them in existing ungrouped expenses; named groups retain their explicit membership. Editing trip dates does not silently change existing rent amounts.

Balances include both original expense payments and recorded person-to-person payments. Overpayment can reverse who owes whom. Plans recalculate after any change. The solver searches for the minimum number of transfers, pruning equivalent states; a 200,000-state budget keeps larger groups responsive. If that budget is reached, the solver returns its best complete plan without claiming a proven minimum.

## Receipt scanning

Set `OPENAI_API_KEY` in `.env`. `OPENAI_MODEL` defaults to `gpt-4.1-mini`; use a vision model supporting structured outputs and PDF input. JPG, PNG, WebP and PDF are supported up to 10 MB. Receipt content is sent to OpenAI when scanning is configured; without a key, uploading opens manual review automatically. Requests set `store: false`. No provider key reaches the browser. Review is mandatory, and currency mismatches require manually converted CZK amounts before import. No live provider call is made by the automated tests.

## Storage and sessions

`DATABASE_PATH` defaults to `./data/housik.sqlite`; `UPLOAD_DIR` defaults to `./data/receipts`. SQLite enables foreign keys and WAL. Back up the database using SQLite's backup API or stop the app before copying the database and receipt directory together. The schema is created automatically for this initial version.

Passwords use scrypt with random salts. Browser cookies are HTTP-only, SameSite=Lax, and secure on HTTPS. Sessions have no server-side expiry; the persistent cookie renews on use for 400 days, subject to browser retention limits. Signing out revokes that session. Passwords and session tokens are never stored in plaintext. There is no password recovery flow in this initial version.

## Production

```sh
npm run build
ORIGIN=https://your-host.example npm start
```

Run behind HTTPS with a persistent writable data directory. Set `ORIGIN` to the external URL so form origin checks work behind a proxy. `.env.example` includes `BODY_SIZE_LIMIT=12M` for receipt uploads. Deploy one app instance per SQLite database on a local filesystem.

## Checks

```sh
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npm run test:pwa
```

Browser tests use a separate SQLite database and receipt directory. `test:pwa` builds a production fixture and verifies the manifest, icons, service worker, offline recovery and cache boundaries. For headed tests/screenshots on the shared Linux machine, use the `isolated-gui` skill available in your agent environment and its private display/session; never use the user's display. `HEADED=1` enables a visible test browser on that private display. `E2E_EXTERNAL_SERVER=1` uses an already-running fixture server at port 5180.

Implementation references: [SvelteKit](https://svelte.dev/docs/kit), [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision).
