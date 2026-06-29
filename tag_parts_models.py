#!/usr/bin/env python3
"""
TAGRO OS — Parts Model Tagger
Uses requests library for reliable HTTPS on Windows.
Run: pip install requests
     python tag_parts_models.py
"""

import json, re, os, sys

try:
    import requests
except ImportError:
    print("Installing requests...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'requests'])
    import requests

# ── CONFIG ────────────────────────────────────────────────
WORKER_URL  = 'https://tagro-os.icy-fire-d2ac.workers.dev'
OWNER_TOKEN = os.environ.get('OWNER_TOKEN', '')

if not OWNER_TOKEN:
    OWNER_TOKEN = input("Enter OWNER_TOKEN: ").strip()
if not OWNER_TOKEN:
    print("OWNER_TOKEN required. Exiting.")
    sys.exit(1)

# ── KNOWN MODELS ──────────────────────────────────────────
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
    text = (name + ' ' + stihl_name).upper()
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

# ── LOAD PARTS ────────────────────────────────────────────
print("Loading parts master from Worker...")
try:
    r = requests.get(f'{WORKER_URL}/knowledge/parts', timeout=60)
    print(f"HTTP {r.status_code}")
    if r.status_code != 200:
        print("Error body:", r.text[:300])
        sys.exit(1)
    data  = r.json()
    parts = data.get('data') or data.get('parts') or []
    print(f"Loaded {len(parts)} parts")
except Exception as e:
    print(f"Failed to load parts: {e}")
    sys.exit(1)

if not parts:
    print("No parts found. Exiting.")
    sys.exit(1)

# ── TAG MODELS ────────────────────────────────────────────
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

print(f"\nTagging results:")
print(f"  Tagged:    {tagged}")
print(f"  Untagged:  {untagged}  (generic parts — still searchable by name)")
print(f"  Unchanged: {unchanged}")

print(f"\nSample tagged:")
for p in [x for x in parts if x.get('models')][:5]:
    print(f"  {p['name'][:50]:50} → {p['models']}")

print(f"\nSample untagged:")
for p in [x for x in parts if not p.get('models')][:3]:
    print(f"  {p['name'][:60]}")

# ── WRITE BACK ────────────────────────────────────────────
confirm = input(f"\nWrite {len(parts)} tagged parts back to KV? (y/n): ").strip().lower()
if confirm != 'y':
    print("Cancelled.")
    sys.exit(0)

print("Writing to KV...")
try:
    r2 = requests.post(
        f'{WORKER_URL}/admin/kv-set',
        json={ 'ownerToken': OWNER_TOKEN, 'key': 'parts:master', 'value': parts },
        timeout=120
    )
    print(f"HTTP {r2.status_code}")
    resp2 = r2.json()
    if resp2.get('ok'):
        print(f"\n✓ parts:master updated with model tags.")
        print(f"  Test: curl \"{WORKER_URL}/knowledge/parts/MS%20382\"")
    else:
        print(f"✗ Failed: {resp2}")
except Exception as e:
    print(f"Write failed: {e}")
