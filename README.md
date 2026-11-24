# Weblox on Cloudflare Workers

```bash
npm install
npm run build          # makes ./public (host page, sign-in browser, headers)
npx wrangler login
npx wrangler deploy    # or: npx wrangler dev   to test locally
```

Open `https://weblox.<your-subdomain>.workers.dev/`.

## What changed vs. the Bun version
- `/wisp/` is a Workers-native Wisp server using `cloudflare:sockets` (`src/wisp.ts`), still limited to Roblox hosts on port 443.
- No engine download step: `/blox/engine/*` streams files from Roblox's CDN (`src/engine.ts`). Pin a version with the `ENGINE_VERSION` var in `wrangler.jsonc`.
- Static files are served as Workers Static Assets; COOP/COEP headers come from `public/_headers`.

## Known risks
- Workers' `connect()` cannot reach hosts behind Cloudflare's own network. If a Roblox endpoint is fronted by Cloudflare it will fail with a connection error.
- A Worker invocation has a cap on simultaneous open connections (6); extra streams queue. Pages that fire many parallel requests may be slow.
- Each engine file is one Worker request. The free plan allows 100k requests/day, so use the Paid plan if several people use it.
