// TAGRO OS — Cloudflare Worker
// New standalone deployment. Not related to service.tagro.in Worker.
//
// Bindings required (set in Cloudflare dashboard / wrangler.toml):
//   KV:  TAGRO_DATA     — models, parts, staff, pricing, labour
//   R2:  TAGRO_MANUALS  — workshop manuals, IPLs, PDFs, documents
//   D1:  TAGRO_DB       — service jobs, events, history
//   Secrets: OWNER_TOKEN, ANTHROPIC_KEY
//
// Route groups:
//   /knowledge/*  — Knowledge Layer (models, parts, pricing, manuals, history)
//   /jobs/*       — Workflow Engine (upsert, list, sync)
//   /auth/*       — Session (OTP, login)
//   /admin/*      — Admin operations (KV set, R2 put, seeding)
//
// All Knowledge responses carry provenance:
//   { ok, data, confidence, source, sourceDate, sourceType, versions }

// ── CORS ──────────────────────────────────────────────────
// Restrict to TAGRO domains in production.
// For development / local testing, '*' is acceptable.
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-TAGRO-Key',
};

// ── RESPONSE HELPERS ──────────────────────────────────────
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });

const err = (msg, status = 400) => json({ ok: false, error: msg }, status);

// ── KNOWLEDGE PROVENANCE WRAPPER ──────────────────────────
// Every Knowledge response uses this shape.
// confidence: 0 = unavailable | 0.5 = bundle | 0.7 = derived | 1.0 = authoritative
function knowledge(data, opts = {}) {
  return json({
    ok:          true,
    data:        data,
    // Legacy field aliases for backward compat with os-core.js readers
    ...opts.alias ? { [opts.alias]: data } : {},
    confidence:  opts.confidence  ?? 1.0,
    source:      opts.source      ?? 'TAGRO Knowledge',
    sourceDate:  opts.sourceDate  ?? null,
    sourceType:  opts.sourceType  ?? 'kv',
    retrievedAt: new Date().toISOString(),
  });
}

function knowledgeEmpty(reason = 'Not available') {
  return json({
    ok:          true,
    data:        null,
    confidence:  0,
    source:      reason,
    sourceDate:  null,
    sourceType:  'none',
    retrievedAt: new Date().toISOString(),
  });
}

function knowledgeList(items, opts = {}) {
  return json({
    ok:          true,
    data:        items,
    ...opts.alias ? { [opts.alias]: items } : {},
    confidence:  opts.confidence  ?? 1.0,
    source:      opts.source      ?? 'TAGRO Knowledge',
    sourceDate:  opts.sourceDate  ?? null,
    sourceType:  opts.sourceType  ?? 'kv',
    count:       items.length,
    retrievedAt: new Date().toISOString(),
  });
}

// ── KV HELPER ─────────────────────────────────────────────
const kv = (env) => env.TAGRO_DATA || env.KV || env.TAGRO_KV;

// ── DATA VERSIONS ─────────────────────────────────────────
// Increment these when datasets are updated.
// Clients send their cached version; server only sends new data if version differs.
const VERSIONS = {
  models:  'v2.0',
  parts:   'v2.0',
  staff:   'v2.0',
  pricing: null,    // null = not yet imported
  labour:  null,    // null = not yet imported
};

// ══════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const path = url.pathname;

    // Root health check
    if (path === '/') {
      return json({ ok: true, service: 'TAGRO OS Worker', version: '2.0', versions: VERSIONS });
    }

    // ════════════════════════════════════════════════════
    // KNOWLEDGE LAYER
    // Storage-agnostic. Returns provenance with every response.
    // Apps call Knowledge.method() → os-core.js → these endpoints.
    // Apps never see KV keys, R2 paths, or D1 table names.
    // ════════════════════════════════════════════════════

    // ── GET /knowledge/all ────────────────────────────────
    // Boot call. Returns all knowledge datasets the client needs at startup.
    // Versioned: only sends datasets that have changed since last fetch.
    if (path === '/knowledge/all' && request.method === 'GET') {
      return handleKnowledgeAll(url, env);
    }

    // ── GET /knowledge/models ─────────────────────────────
    if (path === '/knowledge/models' && request.method === 'GET') {
      return handleKnowledgeModels(url, env);
    }

    // ── GET /knowledge/machine/:id ────────────────────────
    if (path.startsWith('/knowledge/machine/') && request.method === 'GET') {
      const modelId = decodeURIComponent(path.slice('/knowledge/machine/'.length));
      return handleKnowledgeMachine(modelId, url, env);
    }

    // ── GET /knowledge/parts/:modelId ─────────────────────
    // Optional modelId — without it, returns all parts
    if (path.startsWith('/knowledge/parts') && request.method === 'GET') {
      const modelId = path.length > '/knowledge/parts'.length
        ? decodeURIComponent(path.slice('/knowledge/parts/'.length))
        : null;
      return handleKnowledgeParts(modelId, url, env);
    }

    // ── GET /knowledge/part/:partNo ───────────────────────
    if (path.startsWith('/knowledge/part/') && request.method === 'GET') {
      const partNo = decodeURIComponent(path.slice('/knowledge/part/'.length));
      return handleKnowledgePart(partNo, env);
    }

    // ── GET /knowledge/search?q=...&model=... ─────────────
    if (path === '/knowledge/search' && request.method === 'GET') {
      return handleKnowledgeSearch(url, env);
    }

    // ── GET /knowledge/manuals/:modelId ───────────────────
    if (path.startsWith('/knowledge/manuals/') && request.method === 'GET') {
      const modelId = decodeURIComponent(path.slice('/knowledge/manuals/'.length));
      return handleKnowledgeManuals(modelId, env);
    }

    // ── GET /knowledge/bulletin/:modelId ──────────────────
    if (path.startsWith('/knowledge/bulletin/') && request.method === 'GET') {
      const modelId = decodeURIComponent(path.slice('/knowledge/bulletin/'.length));
      return handleKnowledgeBulletin(modelId, env);
    }

    // ── GET /knowledge/pricing/:partNo ────────────────────
    // Returns confidence:0 until pricing Excel is imported.
    if (path.startsWith('/knowledge/pricing/') && request.method === 'GET') {
      const partNo = decodeURIComponent(path.slice('/knowledge/pricing/'.length));
      return handleKnowledgePricing(partNo, env);
    }

    // ── GET /knowledge/labour/:operation ──────────────────
    // Returns confidence:0 until labour schedule is imported.
    if (path.startsWith('/knowledge/labour/') && request.method === 'GET') {
      const operation = decodeURIComponent(path.slice('/knowledge/labour/'.length));
      return handleKnowledgeLabour(operation, env);
    }

    // ── GET /knowledge/history/:serial ────────────────────
    if (path.startsWith('/knowledge/history/') && request.method === 'GET') {
      const serial = decodeURIComponent(path.slice('/knowledge/history/'.length));
      return handleKnowledgeHistory(serial, env);
    }

    // ── GET /knowledge/documents ──────────────────────────
    if (path === '/knowledge/documents' && request.method === 'GET') {
      return handleKnowledgeDocuments(url, env);
    }

    // ── GET /knowledge/document/:id ───────────────────────
    if (path.startsWith('/knowledge/document/') && request.method === 'GET') {
      const id = decodeURIComponent(path.slice('/knowledge/document/'.length));
      return handleKnowledgeDocument(id, env);
    }

    // ════════════════════════════════════════════════════
    // WORKFLOW ENGINE — Jobs
    // ════════════════════════════════════════════════════

    // ── POST /jobs/upsert ─────────────────────────────────
    // Receives a job from the client. Assigns confirmed work order number.
    // Persists to D1. Returns confirmed WO.
    if (path === '/jobs/upsert' && request.method === 'POST') {
      return handleJobUpsert(request, env);
    }

    // ── GET /jobs ─────────────────────────────────────────
    if (path === '/jobs' && request.method === 'GET') {
      return handleJobsList(url, env);
    }

    // ════════════════════════════════════════════════════
    // AUTH
    // ════════════════════════════════════════════════════

    if (path === '/auth/otp-send'   && request.method === 'POST') return handleOtpSend(request, env);
    if (path === '/auth/otp-verify' && request.method === 'POST') return handleOtpVerify(request, env);

    // ════════════════════════════════════════════════════
    // ADMIN — owner-token protected
    // ════════════════════════════════════════════════════

    if (path === '/admin/kv-set'  && request.method === 'POST') return handleAdminKvSet(request, env);
    if (path === '/admin/r2-put'  && request.method === 'POST') return handleAdminR2Put(request, env);
    if (path === '/admin/pricing-import' && request.method === 'POST') return handlePricingImport(request, env);
    if (path === '/admin/labour-import'  && request.method === 'POST') return handleLabourImport(request, env);

    return err('Not found', 404);
  }
};

// ══════════════════════════════════════════════════════════
// KNOWLEDGE HANDLERS
// ══════════════════════════════════════════════════════════

// ── /knowledge/all ────────────────────────────────────────
// Single boot call. Sends everything the client needs at startup.
// Each dataset carries its own version and provenance.
// Client sends its cached versions; server only sends changed datasets.
async function handleKnowledgeAll(url, env) {
  const KV = kv(env);
  const vModels  = url.searchParams.get('v_models');
  const vParts   = url.searchParams.get('v_parts');
  const vStaff   = url.searchParams.get('v_staff');
  const branch   = url.searchParams.get('branch');

  const result = { ok: true, versions: VERSIONS };

  try {
    // Models — send if client version differs
    if (vModels !== VERSIONS.models) {
      const raw    = await KV.get('models:all', { type: 'json' });
      const models = raw || [];
      // Normalise to Knowledge schema
      result.models = {
        items:      normaliseModels(models, branch),
        confidence: 1.0,
        source:     'Machine Catalogue',
        sourceDate: null,
        sourceType: 'kv',
        version:    VERSIONS.models,
      };
    }

    // Parts master — send if client version differs
    if (vParts !== VERSIONS.parts) {
      const raw   = await KV.get('parts:master', { type: 'json' });
      const parts = raw || [];
      result.parts = {
        items:      parts,
        confidence: parts.length > 0 ? 1.0 : 0,
        source:     parts.length > 0 ? 'Parts Master' : 'Parts not yet loaded',
        sourceDate: null,
        sourceType: 'kv',
        version:    VERSIONS.parts,
      };
    }

    // Staff — send if client version differs
    if (vStaff !== VERSIONS.staff) {
      const raw   = await KV.get('staff:all', { type: 'json' });
      const staff = raw || [];
      result.staff = {
        items:      branch ? staff.filter(s => s.branch === branch) : staff,
        confidence: 1.0,
        source:     'Staff Registry',
        sourceType: 'kv',
        version:    VERSIONS.staff,
      };
    }

    // Pricing — honest about availability
    result.pricing = VERSIONS.pricing ? {
      items:      await KV.get('pricing:master', { type: 'json' }) || {},
      confidence: 0.95,
      source:     await KV.get('pricing:source') || 'Price List',
      sourceDate: await KV.get('pricing:date'),
      sourceType: 'excel_import',
    } : {
      items:      {},
      confidence: 0,
      source:     'Pricing not yet imported',
      sourceType: 'none',
    };

    // Labour — honest about availability
    result.labour = VERSIONS.labour ? {
      items:      await KV.get('labour:master', { type: 'json' }) || {},
      confidence: 0.95,
      source:     await KV.get('labour:source') || 'Labour Schedule',
      sourceDate: await KV.get('labour:date'),
      sourceType: 'excel_import',
    } : {
      items:      {},
      confidence: 0,
      source:     'Labour rates not yet imported',
      sourceType: 'none',
    };

    return json(result);
  } catch (e) {
    return err('Knowledge load failed: ' + e.message, 500);
  }
}

// ── /knowledge/models ─────────────────────────────────────
async function handleKnowledgeModels(url, env) {
  try {
    const KV     = kv(env);
    const branch = url.searchParams.get('branch');
    const cat    = url.searchParams.get('category');
    const raw    = await KV.get('models:all', { type: 'json' }) || [];
    let models   = normaliseModels(raw, branch);
    if (cat) models = models.filter(m => m.category === cat);
    return knowledgeList(models, {
      alias:      'models',
      source:     'Machine Catalogue',
      sourceType: 'kv',
    });
  } catch (e) {
    return err('Models load failed: ' + e.message, 500);
  }
}

// ── /knowledge/machine/:id ────────────────────────────────
async function handleKnowledgeMachine(modelId, url, env) {
  try {
    const KV = kv(env);

    // Try dedicated machine record first (richer, has specs)
    const machineKey = 'machine:' + modelId.replace(/\s+/g, '_').toUpperCase();
    let machine = await KV.get(machineKey, { type: 'json' });

    if (!machine) {
      // Fall back to models list
      const models = await KV.get('models:all', { type: 'json' }) || [];
      const found  = models.find(m =>
        m.id === modelId || m.name === modelId ||
        m.id?.toUpperCase() === modelId.toUpperCase() ||
        m.name?.toUpperCase() === modelId.toUpperCase()
      );
      if (!found) return knowledgeEmpty('Machine not found: ' + modelId);

      // Construct a basic record with relations scaffold
      machine = {
        ...normaliseModel(found),
        source:   'models:all',
        _partial: true,   // signals this is not the full machine record
      };
    }

    // Add relations for future graph traversal
    machine.relations = machine.relations || {
      parts:    `/knowledge/parts/${encodeURIComponent(modelId)}`,
      manuals:  `/knowledge/manuals/${encodeURIComponent(modelId)}`,
      bulletin: `/knowledge/bulletin/${encodeURIComponent(modelId)}`,
      history:  `/knowledge/history/{serial}`,
    };

    return knowledge(machine, {
      alias:      'machine',
      confidence: machine._partial ? 0.7 : 1.0,
      source:     machine._partial ? 'Machine Catalogue (partial)' : 'Machine Catalogue',
      sourceType: 'kv',
    });
  } catch (e) {
    return err('Machine lookup failed: ' + e.message, 500);
  }
}

// ── /knowledge/parts/:modelId ─────────────────────────────
async function handleKnowledgeParts(modelId, url, env) {
  try {
    const KV   = kv(env);
    const q    = (url.searchParams.get('q') || '').toLowerCase().trim();
    let parts  = await KV.get('parts:master', { type: 'json' }) || [];

    // Filter by model if specified
    if (modelId) {
      // Try model-specific key first
      const modelKey  = 'parts:' + modelId.toUpperCase().replace(/\s+/g, '');
      const modelParts = await KV.get(modelKey, { type: 'json' });
      if (modelParts?.length) {
        parts = modelParts;
      } else {
        // Fall back: filter master by model references in the part record
        parts = parts.filter(p =>
          p.models?.includes(modelId) ||
          p.model  === modelId ||
          p.models?.some(m => m.toUpperCase() === modelId.toUpperCase())
        );
      }
    }

    // Optional search within the result
    if (q) {
      parts = parts.filter(p =>
        (p.name        || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.no          || '').toLowerCase().includes(q)
      ).slice(0, 50);
    }

    const hasData = parts.length > 0;
    return knowledgeList(parts, {
      alias:      'parts',
      confidence: hasData ? 1.0 : 0,
      source:     hasData ? 'Parts Master' : 'No parts found for this model',
      sourceType: 'kv',
    });
  } catch (e) {
    return err('Parts lookup failed: ' + e.message, 500);
  }
}

// ── /knowledge/part/:partNo ───────────────────────────────
async function handleKnowledgePart(partNo, env) {
  try {
    const KV = kv(env);

    // Try dedicated part key first
    const partKey = 'part:' + partNo.replace(/[^a-zA-Z0-9\-]/g, '_');
    let part = await KV.get(partKey, { type: 'json' });

    if (!part) {
      // Search in master parts list
      const all = await KV.get('parts:master', { type: 'json' }) || [];
      part = all.find(p =>
        p.no === partNo || p.number === partNo || p.partNo === partNo
      );
    }

    if (!part) return knowledgeEmpty('Part not found: ' + partNo);

    // Add relations
    part.relations = part.relations || {
      machines:    part.models || [],
      supersededBy: part.supersededBy || null,
      supersedes:   part.supersedes   || null,
    };

    return knowledge(part, {
      alias:      'part',
      confidence: 1.0,
      source:     'Parts Master',
      sourceType: 'kv',
    });
  } catch (e) {
    return err('Part lookup failed: ' + e.message, 500);
  }
}

// ── /knowledge/search?q=...&model=... ────────────────────
async function handleKnowledgeSearch(url, env) {
  try {
    const KV    = kv(env);
    const q     = (url.searchParams.get('q') || '').toLowerCase().trim();
    const model = url.searchParams.get('model');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

    if (!q) return knowledgeList([], { source: 'No query provided' });

    const parts   = await KV.get('parts:master', { type: 'json' }) || [];
    const models  = await KV.get('models:all',   { type: 'json' }) || [];

    // Search parts
    const partResults = parts.filter(p => {
      const inModel = !model || p.models?.includes(model) || p.model === model;
      const matches  =
        (p.name        || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.no          || '').toLowerCase().includes(q);
      return inModel && matches;
    }).slice(0, limit).map(p => ({ ...p, _type: 'part' }));

    // Search models (if no model filter)
    const modelResults = model ? [] : models.filter(m =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.id   || '').toLowerCase().includes(q)
    ).slice(0, 5).map(m => ({ ...normaliseModel(m), _type: 'machine' }));

    const results = [...partResults, ...modelResults];
    return knowledgeList(results, {
      alias:      'results',
      confidence: results.length > 0 ? 1.0 : 0,
      source:     'Parts Master + Machine Catalogue',
      sourceType: 'kv',
    });
  } catch (e) {
    return err('Search failed: ' + e.message, 500);
  }
}

// ── /knowledge/manuals/:modelId ───────────────────────────
// Lists available manual files for a model from R2.
// Returns signed URLs (or public URLs if bucket is public).
async function handleKnowledgeManuals(modelId, env) {
  try {
    const R2 = env.TAGRO_MANUALS || env.R2 || env['tagro-manuals'];
    if (!R2) {
      return knowledgeList([], {
        confidence: 0, source: 'R2 bucket not configured', sourceType: 'none'
      });
    }

    // List objects in the model's folder
    // R2 key convention: stihl/{MODEL_UPPER}/filename.pdf
    const modelKey = modelId.toUpperCase().replace(/\s+/g, '_');
    const prefix   = `stihl/${modelKey}/`;

    const listed = await R2.list({ prefix, limit: 50 });
    if (!listed?.objects?.length) {
      return knowledgeList([], {
        confidence: 0,
        source:     `No manuals found for ${modelId}`,
        sourceType: 'r2',
      });
    }

    const manuals = listed.objects.map(obj => {
      const filename  = obj.key.split('/').pop();
      const type      = classifyManual(filename);
      return {
        id:       obj.key,
        key:      obj.key,
        filename,
        type,          // 'workshop_manual' | 'ipl' | 'owner_manual' | 'bulletin' | 'other'
        label:    labelFromFilename(filename, type),
        size:     obj.size,
        uploaded: obj.uploaded,
        // URL to fetch the file — apps request via Worker to keep R2 private
        url:      `/knowledge/r2/${encodeURIComponent(obj.key)}`,
        modelId,
      };
    });

    return knowledgeList(manuals, {
      alias:      'manuals',
      confidence: 1.0,
      source:     'Manual Library (R2)',
      sourceType: 'r2',
    });
  } catch (e) {
    return err('Manuals lookup failed: ' + e.message, 500);
  }
}

// ── /knowledge/bulletin/:modelId ──────────────────────────
async function handleKnowledgeBulletin(modelId, env) {
  try {
    const KV = kv(env);
    const key = 'bulletin:' + modelId.toUpperCase().replace(/\s+/g, '_');
    const bulletins = await KV.get(key, { type: 'json' }) || [];

    // Also check R2 bulletins folder
    const R2 = env.TAGRO_MANUALS || env.R2 || env['tagro-manuals'];
    if (R2 && !bulletins.length) {
      const prefix = `bulletins/${modelId.toUpperCase().replace(/\s+/g,'_')}/`;
      try {
        const listed = await R2.list({ prefix, limit: 20 });
        if (listed?.objects?.length) {
          const r2Bulletins = listed.objects.map(obj => ({
            id:       obj.key,
            filename: obj.key.split('/').pop(),
            type:     'service_bulletin',
            url:      `/knowledge/r2/${encodeURIComponent(obj.key)}`,
            modelId,
          }));
          return knowledgeList(r2Bulletins, {
            alias:      'bulletins',
            confidence: 1.0,
            source:     'Technical Bulletins (R2)',
            sourceType: 'r2',
          });
        }
      } catch {}
    }

    return knowledgeList(bulletins, {
      alias:      'bulletins',
      confidence: bulletins.length > 0 ? 1.0 : 0,
      source:     bulletins.length > 0 ? 'Technical Bulletins' : `No bulletins for ${modelId}`,
      sourceType: 'kv',
    });
  } catch (e) {
    return err('Bulletin lookup failed: ' + e.message, 500);
  }
}

// ── /knowledge/pricing/:partNo ────────────────────────────
// Honest: returns confidence:0 until Excel files are imported.
// Once imported via /admin/pricing-import, returns real data.
async function handleKnowledgePricing(partNo, env) {
  try {
    const KV = kv(env);

    // Check if pricing has been imported
    const pricingVersion = await KV.get('pricing:version');
    if (!pricingVersion) {
      return json({
        ok:          true,
        data:        null,
        confidence:  0,
        source:      'Pricing not yet imported',
        sourceDate:  null,
        sourceType:  'none',
        retrievedAt: new Date().toISOString(),
        // Explicit message for operators and AI layer
        message:     'Pricing data has not been imported. Please upload the price list Excel file.',
      });
    }

    // Pricing has been imported — look up the part
    const priceKey = 'price:' + partNo.replace(/[^a-zA-Z0-9\-]/g, '_');
    const price    = await KV.get(priceKey, { type: 'json' });

    if (!price) {
      return json({
        ok:          true,
        data:        null,
        confidence:  0.3,
        source:      await KV.get('pricing:source') || 'Price List',
        sourceDate:  await KV.get('pricing:date'),
        sourceType:  'excel_import',
        retrievedAt: new Date().toISOString(),
        message:     `Part ${partNo} not found in pricing database`,
      });
    }

    return knowledge(price, {
      alias:      'pricing',
      confidence: 0.95,
      source:     await KV.get('pricing:source') || 'Price List',
      sourceDate: await KV.get('pricing:date'),
      sourceType: 'excel_import',
    });
  } catch (e) {
    return err('Pricing lookup failed: ' + e.message, 500);
  }
}

// ── /knowledge/labour/:operation ──────────────────────────
async function handleKnowledgeLabour(operation, env) {
  try {
    const KV = kv(env);
    const labourVersion = await KV.get('labour:version');

    if (!labourVersion) {
      return json({
        ok:          true,
        data:        null,
        confidence:  0,
        source:      'Labour rates not yet imported',
        sourceDate:  null,
        sourceType:  'none',
        retrievedAt: new Date().toISOString(),
        message:     'Labour rate schedule has not been imported. Please upload the labour schedule.',
      });
    }

    const labourKey = 'labour:' + operation.replace(/[^a-zA-Z0-9\-_]/g, '_').toLowerCase();
    const rate      = await KV.get(labourKey, { type: 'json' });

    if (!rate) {
      return json({
        ok:          true,
        data:        null,
        confidence:  0.3,
        source:      await KV.get('labour:source') || 'Labour Schedule',
        sourceDate:  await KV.get('labour:date'),
        sourceType:  'excel_import',
        retrievedAt: new Date().toISOString(),
        message:     `Operation "${operation}" not found in labour schedule`,
      });
    }

    return knowledge(rate, {
      alias:      'rate',
      confidence: 0.95,
      source:     await KV.get('labour:source') || 'Labour Schedule',
      sourceDate: await KV.get('labour:date'),
      sourceType: 'excel_import',
    });
  } catch (e) {
    return err('Labour lookup failed: ' + e.message, 500);
  }
}

// ── /knowledge/history/:serial ────────────────────────────
// Retrieves all service records for a machine serial number.
// Source: D1 table, falling back to an empty honest response.
async function handleKnowledgeHistory(serial, env) {
  try {
    const D1 = env.TAGRO_DB;
    if (!D1) {
      return json({
        ok:          true,
        data:        [],
        confidence:  0,
        source:      'D1 database not configured',
        sourceType:  'none',
        retrievedAt: new Date().toISOString(),
        message:     'History database not connected',
      });
    }

    // Query D1 for all jobs with this serial number
    const result = await D1.prepare(
      `SELECT id, work_order, branch, created_at, customer_name, model,
              complaint, status, updated_at
       FROM service_jobs
       WHERE machine_serial = ?
       ORDER BY created_at DESC
       LIMIT 50`
    ).bind(serial).all();

    const history = (result.results || []).map(row => ({
      id:          row.id,
      workOrder:   row.work_order,
      branch:      row.branch,
      date:        row.created_at,
      customer:    row.customer_name,
      model:       row.model,
      complaint:   row.complaint,
      status:      row.status,
      updatedAt:   row.updated_at,
    }));

    return knowledgeList(history, {
      alias:      'history',
      confidence: 0.9,
      source:     'Service Records (D1)',
      sourceType: 'd1',
    });
  } catch (e) {
    // D1 query failed — return honest empty response
    return json({
      ok:          true,
      data:        [],
      confidence:  0,
      source:      'History query failed',
      sourceType:  'd1',
      retrievedAt: new Date().toISOString(),
      message:     'Unable to retrieve history: ' + e.message,
    });
  }
}

// ── /knowledge/documents ──────────────────────────────────
// First-class document objects: SOPs, circulars, policies, templates.
// Not manuals — separate collection with richer metadata.
async function handleKnowledgeDocuments(url, env) {
  try {
    const KV     = kv(env);
    const type   = url.searchParams.get('type');
    const branch = url.searchParams.get('branch');
    const search = (url.searchParams.get('search') || '').toLowerCase();

    // Documents index stored in KV as a structured list
    let docs = await KV.get('documents:index', { type: 'json' }) || [];

    if (type)   docs = docs.filter(d => d.type   === type);
    if (branch) docs = docs.filter(d => !d.branch || d.branch === branch || d.branch === 'ALL');
    if (search) docs = docs.filter(d =>
      (d.title       || '').toLowerCase().includes(search) ||
      (d.description || '').toLowerCase().includes(search) ||
      (d.tags        || []).some(t => t.toLowerCase().includes(search))
    );

    return knowledgeList(docs, {
      alias:      'documents',
      confidence: docs.length > 0 ? 1.0 : 0,
      source:     'Document Library',
      sourceType: 'kv',
    });
  } catch (e) {
    return err('Documents lookup failed: ' + e.message, 500);
  }
}

// ── /knowledge/document/:id ───────────────────────────────
async function handleKnowledgeDocument(id, env) {
  try {
    const KV  = kv(env);
    const doc = await KV.get('document:' + id, { type: 'json' });
    if (!doc) return knowledgeEmpty('Document not found: ' + id);

    // If document has an R2 key, generate access URL
    if (doc.r2Key) {
      doc.url = `/knowledge/r2/${encodeURIComponent(doc.r2Key)}`;
    }

    return knowledge(doc, {
      alias:      'document',
      confidence: 1.0,
      source:     'Document Library',
      sourceType: doc.r2Key ? 'r2' : 'kv',
    });
  } catch (e) {
    return err('Document lookup failed: ' + e.message, 500);
  }
}

// ══════════════════════════════════════════════════════════
// WORKFLOW ENGINE HANDLERS
// ══════════════════════════════════════════════════════════

// ── /jobs/upsert ─────────────────────────────────────────
async function handleJobUpsert(request, env) {
  try {
    const { branch, job } = await request.json();
    if (!branch || !job) return err('branch and job required');
    if (!job.customer?.name)  return err('Customer name required');
    if (!job.customer?.phone) return err('Customer phone required');
    if (!job.machine?.model)  return err('Machine model required');
    if (!Array.isArray(job.timeline) || !job.timeline.length) {
      return err('Timeline required — job must have at least one event');
    }

    const KV = kv(env);

    // Assign a confirmed sequential work order number if this is a new job
    // (client sends INTAKE-* temporary ID until confirmed)
    let confirmedWO = job.workOrder;
    if (!job.woConfirmed || (job.workOrder || '').startsWith('INTAKE-')) {
      confirmedWO = await assignWorkOrder(KV, branch);
    }

    const confirmed = {
      ...job,
      workOrder:   confirmedWO,
      woConfirmed: true,
      branch,
      updatedAt:   new Date().toISOString(),
    };

    // Persist to D1 if available
    const D1 = env.TAGRO_DB;
    if (D1) {
      await upsertJobD1(D1, confirmed);
    }

    // Also sync to Dropbox for offline access and backup
    if (env.DROPBOX_TOKEN) {
      const dbxPath = `/TAGROS/${branch}/jobs.json`;
      try {
        let jobs = [];
        const dl = await dropboxDownload(env.DROPBOX_TOKEN, dbxPath);
        if (dl.ok) jobs = await dl.json().catch(() => []);
        const idx = jobs.findIndex(j => j.id === confirmed.id);
        if (idx >= 0) jobs[idx] = confirmed; else jobs.push(confirmed);
        await dropboxUpload(env.DROPBOX_TOKEN, dbxPath, JSON.stringify(jobs, null, 2));
      } catch {}
    }

    return json({ ok: true, job: confirmed, workOrder: confirmedWO });
  } catch (e) {
    return err('Job upsert failed: ' + e.message, 500);
  }
}

// ── /jobs ─────────────────────────────────────────────────
async function handleJobsList(url, env) {
  try {
    const branch = url.searchParams.get('branch');
    if (!branch) return err('branch required');

    const D1 = env.TAGRO_DB;
    if (D1) {
      const result = await D1.prepare(
        `SELECT * FROM service_jobs WHERE branch = ? ORDER BY created_at DESC LIMIT 200`
      ).bind(branch).all();
      return json({ ok: true, jobs: result.results || [] });
    }

    // D1 not available — try Dropbox
    if (env.DROPBOX_TOKEN) {
      const dbxPath = `/TAGROS/${branch}/jobs.json`;
      const dl      = await dropboxDownload(env.DROPBOX_TOKEN, dbxPath);
      if (dl.ok) {
        const jobs = await dl.json().catch(() => []);
        return json({ ok: true, jobs, source: 'dropbox' });
      }
    }

    return json({ ok: true, jobs: [], source: 'none' });
  } catch (e) {
    return err('Jobs list failed: ' + e.message, 500);
  }
}

// ══════════════════════════════════════════════════════════
// AUTH HANDLERS (minimal — expand as needed)
// ══════════════════════════════════════════════════════════

async function handleOtpSend(request, env) {
  try {
    const { name, branch } = await request.json();
    if (!name || !branch) return err('name and branch required');
    const KV = kv(env);
    const staff = await KV.get('staff:all', { type: 'json' }) || [];
    const member = staff.find(s => s.name === name && s.branch === branch);
    if (!member?.phone) return err('Staff not found or no phone on record');

    const otp     = String(Math.floor(100000 + Math.random() * 900000));
    const otpKey  = `otp:${branch}:${name.replace(/\s+/g,'_')}`;
    const expires = new Date(Date.now() + 10 * 60000).toISOString();
    await KV.put(otpKey, JSON.stringify({ otp, expires, attempts: 0 }), { expirationTtl: 600 });

    // Send via Fast2SMS if key available
    if (env.FAST2SMS_KEY) {
      const msg = `Your TAGRO login code is ${otp}. Valid 10 minutes.`;
      await sendSMS(env.FAST2SMS_KEY, member.phone, msg).catch(() => {});
    }

    return json({ ok: true, masked: member.phone.replace(/\d(?=\d{4})/g, '*') });
  } catch (e) { return err('OTP send failed: ' + e.message, 500); }
}

async function handleOtpVerify(request, env) {
  try {
    const { name, branch, otp } = await request.json();
    if (!name || !branch || !otp) return err('name, branch, otp required');
    const KV    = kv(env);
    const key   = `otp:${branch}:${name.replace(/\s+/g,'_')}`;
    const stored = await KV.get(key, { type: 'json' });
    if (!stored) return json({ ok: false, reason: 'expired' });
    if (new Date(stored.expires) < new Date()) { await KV.delete(key); return json({ ok: false, reason: 'expired' }); }
    if (stored.attempts >= 5) return json({ ok: false, reason: 'blocked' });
    if (stored.otp !== otp) {
      stored.attempts++;
      await KV.put(key, JSON.stringify(stored), { expirationTtl: 600 });
      return json({ ok: false, reason: 'wrong', attemptsLeft: 5 - stored.attempts });
    }
    await KV.delete(key);
    const staff  = await KV.get('staff:all', { type: 'json' }) || [];
    const member = staff.find(s => s.name === name && s.branch === branch);
    return json({ ok: true, member });
  } catch (e) { return err('OTP verify failed: ' + e.message, 500); }
}

// ══════════════════════════════════════════════════════════
// ADMIN HANDLERS
// ══════════════════════════════════════════════════════════

async function handleAdminKvSet(request, env) {
  try {
    const { ownerToken, key, value } = await request.json();
    if (ownerToken !== env.OWNER_TOKEN) return err('Unauthorised', 403);
    if (!key) return err('key required');
    await kv(env).put(key, typeof value === 'string' ? value : JSON.stringify(value));
    return json({ ok: true, key });
  } catch (e) { return err('KV set failed: ' + e.message, 500); }
}

async function handleAdminR2Put(request, env) {
  try {
    const { ownerToken, r2Path, data, content_type } = await request.json();
    if (ownerToken !== env.OWNER_TOKEN) return err('Unauthorised', 403);
    if (!r2Path || !data) return err('r2Path and data required');
    const R2 = env.TAGRO_MANUALS || env.R2 || env['tagro-manuals'];
    if (!R2) return err('R2 not configured', 500);
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    await R2.put(r2Path, bytes, { httpMetadata: { contentType: content_type || 'application/octet-stream' } });
    return json({ ok: true, r2Path });
  } catch (e) { return err('R2 put failed: ' + e.message, 500); }
}

// ── /admin/pricing-import ─────────────────────────────────
// Receives structured pricing data from Excel import script.
// Stores each part price as an individual KV key for fast lookup.
// Also stores an index and provenance metadata.
async function handlePricingImport(request, env) {
  try {
    const { ownerToken, pricing, source, sourceDate } = await request.json();
    if (ownerToken !== env.OWNER_TOKEN) return err('Unauthorised', 403);
    if (!pricing || typeof pricing !== 'object') return err('pricing object required');

    const KV = kv(env);
    // pricing = { "1110-120-0610": { mrp: 1825, dealer: 1460, gst: 18 }, ... }
    const partNos  = Object.keys(pricing);
    const batchSize = 50;

    for (let i = 0; i < partNos.length; i += batchSize) {
      const batch = partNos.slice(i, i + batchSize);
      await Promise.all(batch.map(no => {
        const key = 'price:' + no.replace(/[^a-zA-Z0-9\-]/g, '_');
        return KV.put(key, JSON.stringify({ ...pricing[no], partNo: no }));
      }));
    }

    // Store master pricing table and provenance
    await KV.put('pricing:master',  JSON.stringify(pricing));
    await KV.put('pricing:version', new Date().toISOString());
    await KV.put('pricing:source',  source  || 'Excel Import');
    await KV.put('pricing:date',    sourceDate || new Date().toISOString().slice(0,10));

    // Update VERSIONS (in KV so clients can detect the change)
    await KV.put('versions:pricing', new Date().toISOString());

    return json({ ok: true, count: partNos.length, source, sourceDate });
  } catch (e) { return err('Pricing import failed: ' + e.message, 500); }
}

// ── /admin/labour-import ──────────────────────────────────
// Receives labour rate schedule from Excel import script.
async function handleLabourImport(request, env) {
  try {
    const { ownerToken, rates, source, sourceDate } = await request.json();
    if (ownerToken !== env.OWNER_TOKEN) return err('Unauthorised', 403);
    if (!rates || typeof rates !== 'object') return err('rates object required');

    const KV = kv(env);
    // rates = { "carburetor_clean": { rate: 250, unit: "per job" }, ... }
    await Promise.all(Object.entries(rates).map(([op, rate]) => {
      const key = 'labour:' + op.replace(/[^a-zA-Z0-9\-_]/g, '_').toLowerCase();
      return KV.put(key, JSON.stringify({ ...rate, operation: op }));
    }));

    await KV.put('labour:master',  JSON.stringify(rates));
    await KV.put('labour:version', new Date().toISOString());
    await KV.put('labour:source',  source || 'Labour Schedule Import');
    await KV.put('labour:date',    sourceDate || new Date().toISOString().slice(0,10));
    await KV.put('versions:labour', new Date().toISOString());

    return json({ ok: true, count: Object.keys(rates).length, source, sourceDate });
  } catch (e) { return err('Labour import failed: ' + e.message, 500); }
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

// Normalise model records to Knowledge schema
// Old schema uses: { id, name, type, branches }
// Knowledge schema: { id, name, category, brand, branches }
function normaliseModels(models, branch) {
  let result = models.map(normaliseModel);
  if (branch) result = result.filter(m => !m.branches || m.branches.includes(branch));
  return result;
}

function normaliseModel(m) {
  return {
    id:       m.id   || m.name,
    name:     m.name || m.id,
    label:    m.name || m.id,   // alias for older client code
    category: (m.category || typeToCategory(m.type || '') || 'other').toLowerCase(),
    brand:    m.brand    || 'STIHL',
    branches: m.branches || [],
    specs:    m.specs    || null,
    ...m,
  };
}

// Map old 'type' field to new 'category' field
function typeToCategory(type) {
  const map = {
    'Chainsaw':    'chainsaw',
    'Brushcutter': 'brushcutter',
    'Sprayer':     'mistblower',
    'Blower':      'blower',
    'Hedgetrimmer':'hedgetrimmer',
    'Pruner':      'polepruner',
    'Pump':        'waterpump',
    'Generator':   'generator',
    'Battery':     'battery',
  };
  return map[type] || 'other';
}

// Work order counter — sequential per branch per month
// e.g. KVR/2606/001
async function assignWorkOrder(KV, branch) {
  const now = new Date();
  const y   = now.getFullYear().toString().slice(-2);
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  const key = `wo_counter:${branch}:${y}${m}`;

  // Atomic-ish increment using KV (not truly atomic but acceptable for low concurrency)
  const current = parseInt(await KV.get(key) || '0');
  const next    = current + 1;
  await KV.put(key, String(next), { expirationTtl: 90 * 24 * 3600 }); // 90 days

  return `${branch}/${y}${m}/${String(next).padStart(3, '0')}`;
}

// D1 upsert for a job
async function upsertJobD1(D1, job) {
  const lastEvent = (job.timeline || []).at(-1);
  await D1.prepare(`
    INSERT INTO service_jobs
      (id, work_order, branch, customer_name, customer_phone,
       machine_model, machine_serial, complaint, status,
       created_at, updated_at, timeline_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      work_order     = excluded.work_order,
      customer_name  = excluded.customer_name,
      customer_phone = excluded.customer_phone,
      machine_model  = excluded.machine_model,
      machine_serial = excluded.machine_serial,
      complaint      = excluded.complaint,
      status         = excluded.status,
      updated_at     = excluded.updated_at,
      timeline_json  = excluded.timeline_json
  `).bind(
    job.id,
    job.workOrder,
    job.branch,
    job.customer?.name  || '',
    job.customer?.phone || '',
    job.machine?.model  || '',
    job.machine?.serial || '',
    job.complaint       || '',
    lastEvent?.type     || 'machine_received',
    job.createdAt       || new Date().toISOString(),
    job.updatedAt       || new Date().toISOString(),
    JSON.stringify(job.timeline || [])
  ).run();
}

// Classify a manual filename by type
function classifyManual(filename) {
  const f = filename.toLowerCase();
  if (f.includes('workshop') || f.includes('repair') || f.includes('rm_'))   return 'workshop_manual';
  if (f.includes('ipl') || f.includes('parts_list') || f.includes('_pl_'))  return 'ipl';
  if (f.includes('owner') || f.includes('instruction') || f.includes('im_')) return 'owner_manual';
  if (f.includes('bulletin') || f.includes('tsb') || f.includes('sb_'))     return 'service_bulletin';
  return 'other';
}

function labelFromFilename(filename, type) {
  const labels = {
    workshop_manual: 'Workshop Manual',
    ipl:             'Illustrated Parts List',
    owner_manual:    'Owner\'s Manual',
    service_bulletin:'Service Bulletin',
    other:           'Document',
  };
  return labels[type] || filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

// SMS via Fast2SMS
async function sendSMS(apiKey, phone, message) {
  return fetch(
    `https://www.fast2sms.com/dev/bulkV2?authorization=${apiKey}&route=q` +
    `&message=${encodeURIComponent(message)}&language=english&flash=0&numbers=${phone}`
  );
}

// Dropbox helpers
async function dropboxDownload(token, path) {
  return fetch('https://content.dropboxapi.com/2/files/download', {
    method:  'POST',
    headers: {
      Authorization:      `Bearer ${token}`,
      'Dropbox-API-Arg':  JSON.stringify({ path }),
    },
  });
}

async function dropboxUpload(token, path, content) {
  return fetch('https://content.dropboxapi.com/2/files/upload', {
    method:  'POST',
    headers: {
      Authorization:      `Bearer ${token}`,
      'Content-Type':     'application/octet-stream',
      'Dropbox-API-Arg':  JSON.stringify({ path, mode: 'overwrite', autorename: false }),
    },
    body: content,
  });
}
