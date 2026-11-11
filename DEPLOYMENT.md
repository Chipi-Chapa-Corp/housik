# Server deployment with pm3

Housik is a standalone pm3 project named `housik`, checked out at
`/home/kitkat/housik` on `kitkat@server.local`. It uses
`compose.production.yml`, which builds this repository's `Containerfile`.

The app publishes `127.0.0.1:4827`. The separate `infra` pm3 project runs
Tailscale Funnel and forwards its public HTTPS endpoint to that port:
<https://housik.mercat-pumpkinseed.ts.net/>. Housik can restart independently
of Tailscale, SigNoz, and the rest of infra.

## Deploy an update

Commit and push app changes to `main`, then run:

```sh
ssh kitkat@server.local 'pm3 restart housik -d'
```

pm3 pulls the repository, rebuilds the image, and restarts Housik. The `-d`
flag backgrounds the operation; it does not mean the deployment has finished.
Check progress and logs with:

```sh
ssh kitkat@server.local 'pm3 view housik'
ssh kitkat@server.local 'pm3 logs housik --once --lines 50'
```

No commit pin or change in infra is needed for an app update. To restart the
current image without rebuilding, use `pm3 restart housik -d --no-build`.

## Persistent data and configuration

The external Podman volume `housik-data` holds SQLite and uploaded receipts.
Compose does not create or remove it. Ordinary redeployments preserve it.
The original deployment's data was migrated from `infra-housik-data`, with
an offline archive retained in `/home/kitkat/backups/` on the server.

The production Compose file trusts the forwarded host, protocol, and client
IP headers supplied by Tailscale. Keep the backend bound to loopback. It
derives its public HTTPS origin from those headers, so `ORIGIN` is not set
in this deployment.

Receipt scanning is optional. Set `OPENAI_API_KEY` and optionally
`OPENAI_MODEL` in the checkout's ignored `.env`, then redeploy. The default
model is `gpt-4.1-mini`. All other app functionality works without a key.

Stop Housik before exporting the whole data volume for a consistent backup
of its database and receipts together. Treat the archive as private data.

## Register on a fresh server

On the server, before first startup:

```sh
git clone https://github.com/Chipi-Chapa-Corp/housik.git /home/kitkat/housik
podman volume create housik-data
pm3 create /home/kitkat/housik --name housik --git -- -f compose.production.yml
pm3 enable housik
pm3 restart housik -d
```

For an existing deployment, restore its data into `housik-data` before
starting the app. Never run two app instances against the same SQLite
volume. Set up the Tailscale forwarding rule separately in infra.
