#!/usr/bin/env python3
"""
TAGRO OS — Parts Model Tagger
Reads parts:master from KV via the Knowledge API,
extracts model references from part names,
adds a `models` array to each part,
writes back to KV via /admin/kv-set.

Run: python tag_parts_models.py

Note: Parts with bare numbers like "210/230/250" (no MS/FS prefix)
cannot be auto-tagged. They remain searchable via /knowledge/search.
All named references like "MS 382", "FS 120/250", "MS 290/390/360" work.
"""

import json, re, os, urllib.request, sys

# ── CONFIG ────────────────────────────────────────────────
WORKER_URL  = 'https://tagro-os.icy-fire-d2ac.workers.dev'
OWNER_TOKEN = os.environ.get('OWNER_TOKEN', '')

if not OWNER_TOKEN:
    OWNER_TOKEN = input("Enter OWNER_TOKEN: ").strip()
if not OWNER_TOKEN:
    print("OWNER_TOKEN required. Exiting.")
    sys.exit(1)

# ── KNOWN MODELS (longest first to avoid partial matches) ──
KNOWN_MODELS = sorted([
    'MS 180', 'MS 182', 'MS 192T', 'MS 192 T',
    'MS 211', 'MS 230', 'MS 250', 'MS 260',
    'MS 290', 'MS 360', 'MS 361', 'MS 362',
    'MS 380', 'MS 381', 'MS 382',
    'MS 390', 'MS 391',
    'MS 460', 'MS 461', 'MS 462',
    'MS 500I', 'MS 500 I',
    'MS 660', 'MS 661',
    'MS 193T', 'MS 193 T',
    'FS 38', 'FS 45', 'FS 55', 'FS 85',
    'FS 120', 'FS 130', 'FS 250', 'FS 280',
    'FS 350', 'FS 400', 'FS 410', 'FS 560',
    'FSA 45', 'FSA 57', 'FSA 65', 'FSA 85',
    'FSA 130', 'FSA 200',
    'SR 200', 'SR 420', 'SR 430', 'SR 450',
    'BR 200', 'BR 350', 'BR 420', 'BR 430', 'BR 600',
    'BG 50', 'BG 56', 'BG 86',
    'BGA 57', 'BGA 86', 'BGA 100',
    'BGE 71', 'BGE 81',
    'SH 56', 'SH 86',
    'HT 75', 'HT 101', 'HT 131', 'HT 133',
    'HL 94', 'HL 100', 'HL 135',
    'HLA 65', 'HLA 85',
    'MSA 70', 'MSA 120', 'MSA 140', 'MSA 160', 'MSA 200', 'MSA 220',
    'WP 230', 'WP 200',
], key=len, reverse=True)

def extract_models(name, stihl_name=''):
    """Extract model references, handling slash-lists like MS 290/390/360."""
    text = (name + ' ' + stihl_name).upper()

    # Expand slash-lists: "MS 290/390/360" → "MS 290 MS 390 MS 360"
    def expand_slash(m):
        prefix = m.group(1)
        nums   = m.group(2).split('/')
        return ' '.join(prefix.strip() + ' ' + n for n in nums)

    text = re.sub(
        r'((?:MS|FS|FSA|SR|BR|BG|BGA|BGE|SH|HT|HL|HLA|MSA|WP)\s{0,2})(\d+(?:/\d+)+)',
        expand_slash, text
    )

    found = []
    for model in KNOWN_MODELS:
        pattern = re.escape(model.upper())
        if re.search(r'\b' + pattern + r'\b', text):
            if model not in found:
                found.append(model)
    return found

def api_get(path):
    req = urllib.request.Request(WORKER_URL + path)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def api_post(path, body):
    data = json.dumps(body).encode('utf-8')
    req  = urllib.request.Request(
        WORKER_URL + path, data=data,
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())

# ── LOAD ──────────────────────────────────────────────────
print("Loading parts master...")
resp  = api_get('/knowledge/parts')
parts = resp.get('data') or resp.get('parts') or []
print(f"Loaded {len(parts)} parts")

if not parts:
    print("No parts found. Exiting.")
    sys.exit(1)

# ── TAG ───────────────────────────────────────────────────
tagged = untagged = unchanged = 0

for p in parts:
    models   = extract_models(p.get('name',''), p.get('stihlName',''))
    existing = p.get('models', [])

    if set(models) == set(existing):
        unchanged += 1
        continue

    p['models'] = models
    if models: tagged += 1
    else:      untagged += 1

print(f"\nResults:")
print(f"  Tagged:    {tagged}")
print(f"  Untagged:  {untagged}  (generic parts — still searchable)")
print(f"  Unchanged: {unchanged}")

# Sample output
print(f"\nSample tagged parts:")
for p in [x for x in parts if x.get('models')][:5]:
    print(f"  {p['name'][:50]:50} → {p['models']}")

print(f"\nSample untagged (generic — no model in name):")
for p in [x for x in parts if not x.get('models')][:3]:
    print(f"  {p['name'][:60]}")

# ── WRITE BACK ────────────────────────────────────────────
confirm = input(f"\nWrite {len(parts)} parts back to KV? (y/n): ").strip().lower()
if confirm != 'y':
    print("Cancelled.")
    sys.exit(0)

print("Writing to KV (this may take a moment)...")
resp2 = api_post('/admin/kv-set', {
    'ownerToken': OWNER_TOKEN,
    'key':        'parts:master',
    'value':      parts
})

if resp2.get('ok'):
    print(f"\n✓ parts:master updated.")
    print(f"  /knowledge/parts/MS%20382 will now return MS 382 parts.")
    print(f"  /knowledge/parts/FS%20120 will now return FS 120 parts.")
else:
    print(f"\n✗ Failed: {resp2}")
