# TAGRO OS — Deployment Guide

## Prerequisites
- Cloudflare account (info@tagro.in)
- Node.js installed
- Wrangler CLI: `npm install -g wrangler`
- Login: `npx wrangler login`

---

## Step 1 — Create Cloudflare resources

```bash
# KV namespace (stores models, parts, staff, pricing)
npx wrangler kv namespace create TAGRO_DATA
# → Copy the id into wrangler.toml

# R2 bucket (stores manuals, PDFs, documents)
npx wrangler r2 bucket create tagro-manuals

# D1 database (stores service jobs, history)
npx wrangler d1 create tagro-db
# → Copy the database_id into wrangler.toml
```

## Step 2 — Apply D1 schema

```bash
npx wrangler d1 execute tagro-db --file=schema.sql
```

## Step 3 — Set secrets

```bash
npx wrangler secret put OWNER_TOKEN
# Enter a strong secret — used for admin operations and pricing import

npx wrangler secret put FAST2SMS_KEY
# Enter your Fast2SMS API key

npx wrangler secret put DROPBOX_TOKEN
# Enter your Dropbox access token

npx wrangler secret put ANTHROPIC_KEY
# Enter your Anthropic API key (for future AI assistant)
```

## Step 4 — Update wrangler.toml

Replace:
- `REPLACE_WITH_KV_NAMESPACE_ID` with the KV id from Step 1
- `REPLACE_WITH_D1_DATABASE_ID` with the D1 database_id from Step 1

## Step 5 — Deploy

```bash
npx wrangler deploy
```

The Worker will be available at: `https://tagro-os.<your-account>.workers.dev`

Update `os-manifest.js` → `api:` field with this URL.

## Step 6 — Seed initial data

```bash
# Seed models and staff from your existing KV data
# (or use the admin/kv-set endpoint with OWNER_TOKEN)

curl -X POST https://tagro-os.<account>.workers.dev/admin/kv-set \
  -H "Content-Type: application/json" \
  -d '{"ownerToken":"<OWNER_TOKEN>","key":"models:all","value":[...]}'
```

## Step 7 — Deploy frontend to GitHub Pages

```bash
git init
git add .
git commit -m "TAGRO OS v2.0 initial deploy"
git remote add origin https://github.com/koffykraft/tagro-os.git
git push -u origin main
# Enable GitHub Pages → main branch → root folder
```

---

## Importing pricing data

Once the Worker is deployed, send pricing Excel data via:

```bash
curl -X POST https://tagro-os.<account>.workers.dev/admin/pricing-import \
  -H "Content-Type: application/json" \
  -d '{
    "ownerToken": "<OWNER_TOKEN>",
    "source": "STIHL Price List April 2026",
    "sourceDate": "2026-04-01",
    "pricing": {
      "1110-120-0610": { "mrp": 1825, "dealer": 1460, "gst": 18 },
      "4130-120-0603": { "mrp": 2240, "dealer": 1792, "gst": 18 }
    }
  }'
```

## Importing labour rates

```bash
curl -X POST https://tagro-os.<account>.workers.dev/admin/labour-import \
  -H "Content-Type: application/json" \
  -d '{
    "ownerToken": "<OWNER_TOKEN>",
    "source": "TAGRO Labour Schedule 2026",
    "sourceDate": "2026-01-01",
    "rates": {
      "carburetor_overhaul": { "rate": 350, "unit": "per job" },
      "chain_bar_replace":   { "rate": 150, "unit": "per job" }
    }
  }'
```

---

## Knowledge endpoint quick test

```bash
curl https://tagro-os.<account>.workers.dev/knowledge/all
curl https://tagro-os.<account>.workers.dev/knowledge/models
curl https://tagro-os.<account>.workers.dev/knowledge/parts/MS%20382
curl https://tagro-os.<account>.workers.dev/knowledge/pricing/1110-120-0610
# → returns confidence:0 until pricing is imported — that is correct
```
