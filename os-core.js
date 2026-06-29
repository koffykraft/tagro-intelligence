// TAGRO OS — Core Platform Services
//
// Two platform services:
//   Workflow Engine  — Jobs, Timeline, Session, WorkOrder, Sync
//   Knowledge Layer  — Models, Machines, Parts, Manuals, Pricing, History
//
// Applications call these services. Applications never touch storage directly.
// API endpoint comes from TAGRO_MANIFEST.api — never duplicated here.

// ── STORAGE ───────────────────────────────────────────────
const OS = {
  get:  (k, d=null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
  set:  (k, v)      => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
  del:  (k)         => localStorage.removeItem(k),
  esc:  (s)         => s == null ? '' : String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;')
};

// ── SESSION ───────────────────────────────────────────────
const Session = {
  get:   ()  => OS.get('tagros_session', null),
  set:   (s) => OS.set('tagros_session', { ...s, loginAt: s.loginAt || new Date().toISOString() }),
  clear: ()  => OS.del('tagros_session'),

  valid: () => {
    const s = Session.get();
    if (!s) return false;
    if (s.demo) return true;
    const age = Date.now() - new Date(s.loginAt).getTime();
    if (age > 12 * 60 * 60 * 1000) { Session.clear(); return false; }
    return true;
  },

  requireLogin: () => {
    if (!Session.valid()) { location.href = 'login.html'; return null; }
    return Session.get();
  },

  canAccess: (appId) => {
    const s   = Session.get();
    const app = TAGRO_MANIFEST.apps.find(a => a.id === appId);
    if (!app || !s) return false;
    return TAGRO_MANIFEST.canAccess(app, s);
  }
};

// ══════════════════════════════════════════════════════════
// KNOWLEDGE
// One of four pillars of TAGRO OS.
//
// Knowledge is the accumulated knowledge of the organisation.
// It is not a cache over the Worker.
// It is not a helper library.
// It is the Business Knowledge Operating System.
//
// Every response carries provenance:
//   { data, confidence, source, sourceDate, sourceType }
//
// confidence: 0.0–1.0. Applications and AI use this to decide how much to trust a result.
// source:     human-readable origin ("Price List April 2026", "Machine Catalogue")
// sourceType: 'kv' | 'r2' | 'd1' | 'bundle' | 'excel_import' | 'manual_entry' | 'derived'
//
// Storage is completely invisible to applications.
// Today: KV, D1, R2, Dropbox, Excel imports.
// Tomorrow: vector search, graph database, document store.
// Applications never change because storage changes.
// Only the Knowledge resolvers inside this service change.
//
// Future graph direction:
//   Machine → parts → common failures → manuals → labour → history → customer
//   Part → machines → supersessions → stock → pricing → supplier → usage
// Every record carries `relations` to support this when the graph layer is built.
// ══════════════════════════════════════════════════════════
const Knowledge = {

  // ── RESPONSE WRAPPER ─────────────────────────────────────
  // Every Knowledge method returns this structure.
  // Applications and Intelligence layer check confidence before using data.
  _wrap: (data, confidence = 1.0, source = 'Unknown', sourceDate = null, sourceType = 'kv') => ({
    data,
    confidence,
    source,
    sourceDate,
    sourceType,
    retrievedAt: new Date().toISOString()
  }),

  _empty: (reason = 'Not available') => ({
    data:        null,
    confidence:  0,
    source:      reason,
    sourceDate:  null,
    sourceType:  'none',
    retrievedAt: new Date().toISOString()
  }),

  _emptyList: (reason = 'Not available') => ({
    data:        [],
    confidence:  0,
    source:      reason,
    sourceDate:  null,
    sourceType:  'none',
    retrievedAt: new Date().toISOString()
  }),

  // ── CACHE ─────────────────────────────────────────────────
  // Two-level: memory (fast) → localStorage (offline persistence)
  // Apps never touch the cache directly.
  _mem: {},

  _cacheSet: (key, wrapped) => {
    Knowledge._mem[key] = { wrapped, at: Date.now() };
    try { localStorage.setItem('tagros_k_' + key, JSON.stringify(wrapped)); } catch {}
  },

  _cacheGet: (key, maxAgeMs = 3600000) => {
    const m = Knowledge._mem[key];
    if (m && (Date.now() - m.at) < maxAgeMs) return m.wrapped;
    try {
      const raw = localStorage.getItem('tagros_k_' + key);
      if (raw) {
        const w = JSON.parse(raw);
        Knowledge._mem[key] = { wrapped: w, at: 0 }; // mark as cold
        return w;
      }
    } catch {}
    return null;
  },

  // ── BOOT ─────────────────────────────────────────────────
  // Called once by the shell on startup.
  // Loads all available knowledge so apps can read synchronously.
  // Versioned: only downloads what has changed since last load.
  load: async () => {
    try {
      const s      = Session.get();
      const params = new URLSearchParams();
      if (s?.branch && s.branch !== 'ALL') params.set('branch', s.branch);
      const versions = OS.get('tagros_k_versions', {});
      Object.entries(versions).forEach(([k, v]) => params.set('v_' + k, v));

      const res  = await fetch(`${TAGRO_MANIFEST.api}/knowledge/all?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;

      // Each dataset arrives with its own provenance metadata
      if (data.models) {
        Knowledge._cacheSet('models', Knowledge._wrap(
          data.models.items,
          data.models.confidence || 1.0,
          data.models.source     || 'Machine Catalogue',
          data.models.sourceDate,
          data.models.sourceType || 'kv'
        ));
      }
      if (data.parts) {
        Knowledge._cacheSet('parts', Knowledge._wrap(
          data.parts.items,
          data.parts.confidence || 1.0,
          data.parts.source     || 'Parts Master',
          data.parts.sourceDate,
          data.parts.sourceType || 'kv'
        ));
      }
      if (data.pricing) {
        Knowledge._cacheSet('pricing_table', Knowledge._wrap(
          data.pricing.items,
          data.pricing.confidence || 0.95,
          data.pricing.source     || 'Price List',
          data.pricing.sourceDate,
          data.pricing.sourceType || 'excel_import'
        ));
      }
      if (data.labour) {
        Knowledge._cacheSet('labour_table', Knowledge._wrap(
          data.labour.items,
          data.labour.confidence || 0.95,
          data.labour.source     || 'Labour Schedule',
          data.labour.sourceDate,
          data.labour.sourceType || 'excel_import'
        ));
      }
      OS.set('tagros_k_versions', { ...versions, ...data.versions });
    } catch {
      // Network unavailable — cached data serves the session
    }
  },

  // ── MODELS ───────────────────────────────────────────────
  // All machine models, optionally filtered by category.
  // Synchronous — uses cache. Apps can call without await.
  models: (categoryId = null) => {
    const cached = Knowledge._cacheGet('models');
    const items  = cached?.data || Knowledge._bundleModels();
    const source = cached?.source     || 'Offline Bundle';
    const conf   = cached?.confidence ?? 0.5;
    const stype  = cached?.sourceType || 'bundle';

    const filtered = categoryId && categoryId !== 'all'
      ? items.filter(m => m.category === categoryId ||
          (categoryId === 'other' && !m.category))
      : items;

    return Knowledge._wrap(filtered, conf, source, cached?.sourceDate, stype);
  },

  // ── MACHINE ──────────────────────────────────────────────
  // Full machine record including specs, fuel mix, capacities.
  // Async — may fetch from Worker if not cached.
  // Relations field prepares for future graph traversal.
  machine: async (modelId) => {
    if (!modelId) return Knowledge._empty('No model ID provided');
    const cacheKey = 'machine:' + modelId;
    const cached   = Knowledge._cacheGet(cacheKey, 7200000); // 2h for machine records
    if (cached) return cached;

    // Try to derive from models list first (fast, no network)
    const modelsWrapped = Knowledge._cacheGet('models');
    if (modelsWrapped?.data) {
      const found = modelsWrapped.data.find(
        m => m.id === modelId || m.name === modelId || m.label === modelId
      );
      if (found) {
        // Basic record from models list — lower confidence than full machine record
        const basic = {
          ...found,
          relations: {
            parts:    `Knowledge.parts('${modelId}')`,
            manuals:  `Knowledge.manuals('${modelId}')`,
            history:  `Knowledge.history(serial)`,
            bulletin: `Knowledge.bulletin('${modelId}')`,
          }
        };
        const wrapped = Knowledge._wrap(basic, 0.7,
          modelsWrapped.source, modelsWrapped.sourceDate, 'derived');
        Knowledge._cacheSet(cacheKey, wrapped);
        return wrapped;
      }
    }

    // Fetch full record from Worker
    try {
      const res  = await fetch(`${TAGRO_MANIFEST.api}/knowledge/machine/${encodeURIComponent(modelId)}`);
      if (!res.ok) return Knowledge._empty('Machine record unavailable');
      const body = await res.json();
      if (body.ok && body.machine) {
        const wrapped = Knowledge._wrap(
          { ...body.machine, relations: body.machine.relations || {} },
          body.confidence || 1.0,
          body.source     || 'Machine Catalogue',
          body.sourceDate,
          body.sourceType || 'kv'
        );
        Knowledge._cacheSet(cacheKey, wrapped);
        return wrapped;
      }
    } catch {}
    return Knowledge._empty('Machine record unavailable offline');
  },

  // ── PARTS ────────────────────────────────────────────────
  // Parts list for a model, or all parts. Synchronous from cache.
  parts: (modelId = null) => {
    const cached = Knowledge._cacheGet('parts');
    if (!cached?.data) return Knowledge._emptyList('Parts not yet loaded');
    const items = modelId
      ? cached.data.filter(p => p.models?.includes(modelId) || p.model === modelId)
      : cached.data;
    return Knowledge._wrap(items, cached.confidence, cached.source, cached.sourceDate, cached.sourceType);
  },

  // Single part by number. Includes supersession chain.
  part: (partNumber) => {
    if (!partNumber) return Knowledge._empty('No part number provided');
    const cached = Knowledge._cacheGet('parts');
    if (!cached?.data) return Knowledge._empty('Parts not yet loaded');
    const found = cached.data.find(p =>
      p.no === partNumber || p.number === partNumber || p.partNo === partNumber
    );
    if (!found) return Knowledge._empty('Part not found: ' + partNumber);
    return Knowledge._wrap(
      {
        ...found,
        relations: {
          machines:    found.models || [],
          supersededBy: found.supersededBy || null,
          supersedes:   found.supersedes   || null,
        }
      },
      cached.confidence, cached.source, cached.sourceDate, cached.sourceType
    );
  },

  // Cross-domain search. Returns parts and machines matching the query.
  search: (query, modelId = null) => {
    query = (query || '').toLowerCase().trim();
    if (!query) return Knowledge._emptyList('No query provided');
    const cached = Knowledge._cacheGet('parts');
    if (!cached?.data) return Knowledge._emptyList('Knowledge not yet loaded');
    const results = cached.data.filter(p => {
      const inModel = !modelId || p.models?.includes(modelId) || p.model === modelId;
      const matches =
        (p.name        || '').toLowerCase().includes(query) ||
        (p.description || '').toLowerCase().includes(query) ||
        (p.no          || '').toLowerCase().includes(query);
      return inModel && matches;
    }).slice(0, 20);
    return Knowledge._wrap(results, cached.confidence, cached.source, cached.sourceDate, 'derived');
  },

  // ── PRICING ──────────────────────────────────────────────
  // Price for a part. Returns null until pricing datasets are imported.
  // No hardcoded prices anywhere in the system.
  // Source will be "Price List [date]" once Excel files are imported.
  pricing: async (partNumber) => {
    if (!partNumber) return Knowledge._empty('No part number provided');

    // Check loaded pricing table first
    const table = Knowledge._cacheGet('pricing_table');
    if (table?.data?.[partNumber]) {
      return Knowledge._wrap(
        table.data[partNumber],
        table.confidence,
        table.source,
        table.sourceDate,
        table.sourceType
      );
    }

    // Fetch from Worker (which reads D1/KV pricing table)
    try {
      const res  = await fetch(`${TAGRO_MANIFEST.api}/knowledge/pricing/${encodeURIComponent(partNumber)}`);
      if (!res.ok) return Knowledge._empty('Pricing not available for ' + partNumber);
      const body = await res.json();
      if (body.ok && body.pricing) {
        return Knowledge._wrap(
          body.pricing,
          body.confidence || 0.95,
          body.source     || 'Price List',
          body.sourceDate,
          body.sourceType || 'excel_import'
        );
      }
    } catch {}
    // Not yet imported — apps must handle confidence:0 gracefully
    return Knowledge._empty('Pricing not yet imported');
  },

  // ── LABOUR RATES ─────────────────────────────────────────
  // Labour rate for a named operation. Returns null until schedule is imported.
  labour: async (operation) => {
    if (!operation) return Knowledge._empty('No operation provided');
    const table = Knowledge._cacheGet('labour_table');
    if (table?.data?.[operation]) {
      return Knowledge._wrap(
        table.data[operation],
        table.confidence,
        table.source,
        table.sourceDate,
        table.sourceType
      );
    }
    try {
      const res  = await fetch(`${TAGRO_MANIFEST.api}/knowledge/labour/${encodeURIComponent(operation)}`);
      if (!res.ok) return Knowledge._empty('Labour rate not available');
      const body = await res.json();
      if (body.ok && body.rate) {
        return Knowledge._wrap(body.rate, body.confidence || 0.95,
          body.source || 'Labour Schedule', body.sourceDate, body.sourceType || 'excel_import');
      }
    } catch {}
    return Knowledge._empty('Labour rates not yet imported');
  },

  // ── MACHINE HISTORY ──────────────────────────────────────
  // All previous repairs for a serial number.
  // Becomes richer as historical records are imported into D1.
  history: async (serial) => {
    if (!serial) return Knowledge._emptyList('No serial number provided');
    try {
      const res  = await fetch(`${TAGRO_MANIFEST.api}/knowledge/history/${encodeURIComponent(serial)}`);
      if (!res.ok) return Knowledge._emptyList('History unavailable');
      const body = await res.json();
      if (body.ok) {
        return Knowledge._wrap(
          body.history || [],
          body.confidence || 0.9,
          body.source     || 'Service Records',
          body.sourceDate,
          body.sourceType || 'd1'
        );
      }
    } catch {}
    return Knowledge._emptyList('History unavailable offline');
  },

  // ── MANUALS ──────────────────────────────────────────────
  // Workshop manuals, owner manuals, IPLs for a model.
  // Source: R2 via Worker. Grows as files are uploaded.
  manuals: async (modelId) => {
    if (!modelId) return Knowledge._emptyList('No model ID provided');
    const cacheKey = 'manuals:' + modelId;
    const cached   = Knowledge._cacheGet(cacheKey, 7200000);
    if (cached) return cached;
    try {
      const res  = await fetch(`${TAGRO_MANIFEST.api}/knowledge/manuals/${encodeURIComponent(modelId)}`);
      if (!res.ok) return Knowledge._emptyList('Manuals unavailable for ' + modelId);
      const body = await res.json();
      if (body.ok && body.manuals) {
        const wrapped = Knowledge._wrap(
          body.manuals,
          body.confidence || 1.0,
          body.source     || 'Manual Library',
          body.sourceDate,
          body.sourceType || 'r2'
        );
        Knowledge._cacheSet(cacheKey, wrapped);
        return wrapped;
      }
    } catch {}
    return Knowledge._emptyList('Manuals unavailable offline');
  },

  // ── DOCUMENTS ────────────────────────────────────────────
  // First-class knowledge objects. Not a subset of manuals.
  // Includes: SOPs, branch circulars, training notes, inspection templates,
  // government documents, warranty policies, internal procedures.
  // Each document has its own metadata: type, branch, effectiveDate, version, tags.
  documents: async (filters = {}) => {
    // filters: { type, branch, tags, search }
    const cacheKey = 'documents:' + JSON.stringify(filters);
    const cached   = Knowledge._cacheGet(cacheKey, 1800000); // 30min for docs
    if (cached) return cached;
    try {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v)
      );
      const res  = await fetch(`${TAGRO_MANIFEST.api}/knowledge/documents?${params}`);
      if (!res.ok) return Knowledge._emptyList('Documents unavailable');
      const body = await res.json();
      if (body.ok && body.documents) {
        const wrapped = Knowledge._wrap(
          body.documents,
          body.confidence || 1.0,
          body.source     || 'Document Library',
          body.sourceDate,
          body.sourceType || 'r2'
        );
        Knowledge._cacheSet(cacheKey, wrapped);
        return wrapped;
      }
    } catch {}
    return Knowledge._emptyList('Documents unavailable offline');
  },

  document: async (id) => {
    if (!id) return Knowledge._empty('No document ID provided');
    const cacheKey = 'doc:' + id;
    const cached   = Knowledge._cacheGet(cacheKey, 3600000);
    if (cached) return cached;
    try {
      const res  = await fetch(`${TAGRO_MANIFEST.api}/knowledge/documents/${encodeURIComponent(id)}`);
      if (!res.ok) return Knowledge._empty('Document not found: ' + id);
      const body = await res.json();
      if (body.ok && body.document) {
        const wrapped = Knowledge._wrap(
          body.document,
          body.confidence || 1.0,
          body.source     || 'Document Library',
          body.sourceDate,
          body.sourceType || 'r2'
        );
        Knowledge._cacheSet(cacheKey, wrapped);
        return wrapped;
      }
    } catch {}
    return Knowledge._empty('Document unavailable offline');
  },

  // ── SERVICE BULLETINS ────────────────────────────────────
  // Known issues and service bulletins for a model.
  bulletin: async (modelId) => {
    if (!modelId) return Knowledge._emptyList('No model ID provided');
    const cacheKey = 'bulletin:' + modelId;
    const cached   = Knowledge._cacheGet(cacheKey, 7200000);
    if (cached) return cached;
    try {
      const res  = await fetch(`${TAGRO_MANIFEST.api}/knowledge/bulletin/${encodeURIComponent(modelId)}`);
      if (!res.ok) return Knowledge._emptyList('Bulletins unavailable for ' + modelId);
      const body = await res.json();
      if (body.ok && body.bulletins) {
        const wrapped = Knowledge._wrap(
          body.bulletins,
          body.confidence || 1.0,
          body.source     || 'Technical Bulletins',
          body.sourceDate,
          body.sourceType || 'r2'
        );
        Knowledge._cacheSet(cacheKey, wrapped);
        return wrapped;
      }
    } catch {}
    return Knowledge._emptyList('Bulletins unavailable offline');
  },

  // ── OFFLINE BUNDLE ───────────────────────────────────────
  // Minimal fallback so apps function before first KV sync.
  // Marked confidence: 0.5 — enough to work, not enough to trust for pricing.
  // Never used for pricing, labour, history — those require live data.
  _bundleModels: () => [
    { id:'ms180',   name:'MS 180',   category:'chainsaw',     brand:'STIHL' },
    { id:'ms250',   name:'MS 250',   category:'chainsaw',     brand:'STIHL' },
    { id:'ms362',   name:'MS 362',   category:'chainsaw',     brand:'STIHL' },
    { id:'ms382',   name:'MS 382',   category:'chainsaw',     brand:'STIHL' },
    { id:'ms461',   name:'MS 461',   category:'chainsaw',     brand:'STIHL' },
    { id:'ms462',   name:'MS 462',   category:'chainsaw',     brand:'STIHL' },
    { id:'ms500i',  name:'MS 500i',  category:'chainsaw',     brand:'STIHL' },
    { id:'ms661',   name:'MS 661',   category:'chainsaw',     brand:'STIHL' },
    { id:'fs120',   name:'FS 120',   category:'brushcutter',  brand:'STIHL' },
    { id:'fs200',   name:'FS 200',   category:'brushcutter',  brand:'STIHL' },
    { id:'fs280',   name:'FS 280',   category:'brushcutter',  brand:'STIHL' },
    { id:'fs560',   name:'FS 560',   category:'brushcutter',  brand:'STIHL' },
    { id:'sr200',   name:'SR 200',   category:'mistblower',   brand:'STIHL' },
    { id:'sr430',   name:'SR 430',   category:'mistblower',   brand:'STIHL' },
    { id:'sr450',   name:'SR 450',   category:'mistblower',   brand:'STIHL' },
    { id:'bg86',    name:'BG 86',    category:'sprayer',      brand:'STIHL' },
    { id:'ht101',   name:'HT 101',   category:'hedgetrimmer', brand:'STIHL' },
    { id:'ht131',   name:'HT 131',   category:'hedgetrimmer', brand:'STIHL' },
    { id:'hl100',   name:'HL 100',   category:'polepruner',   brand:'STIHL' },
    { id:'other',   name:'Other / Not Listed', category:'other', brand:'' },
  ],

};

// ══════════════════════════════════════════════════════════
// WORKFLOW ENGINE
// ══════════════════════════════════════════════════════════

// ── JOBS ─────────────────────────────────────────────────
const Jobs = {
  _key: () => Session.get()?.demo ? 'tagros_demo_jobs' : 'tagros_jobs',

  all:  () => OS.get(Jobs._key(), []),

  find: (id) => Jobs.all().find(j => j.id === id || j.workOrder === id),

  upsert: (job) => {
    const all     = Jobs.all();
    const idx     = all.findIndex(j => j.id === job.id);
    const updated = { ...job, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = updated; else all.push(updated);
    OS.set(Jobs._key(), all);
    Jobs._syncOne(updated);
    return updated;
  },

  // Status is always derived — never stored as a field
  deriveStatus: (job) => {
    const map    = TAGRO_MANIFEST.statusFromEvent;
    const events = (job.timeline || []).slice().reverse();
    for (const ev of events) {
      const status = map[ev.type];
      if (status !== undefined && status !== null) return status;
    }
    return 'Received';
  },

  // Age in days since intake
  ageDays: (job) => Math.floor(
    (Date.now() - new Date(job.createdAt || job.date || Date.now()).getTime()) / 86400000
  ),

  _syncOne: async (job) => {
    if (Session.get()?.demo || !job) return;
    const s = Session.get();
    try {
      const res = await fetch(`${TAGRO_MANIFEST.api}/jobs/upsert`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ branch: s.branch, job })
      });
      if (!res.ok) Jobs._queue(job, s.branch);
      else {
        // Server may return a confirmed work order number
        const data = await res.json().catch(() => ({}));
        if (data.workOrder && data.workOrder !== job.workOrder) {
          WorkOrder.confirmFromServer(job.id, data.workOrder);
        }
      }
    } catch {
      Jobs._queue(job, s.branch || 'UNK');
    }
  },

  _queue: (job, branch) => {
    const q = OS.get('tagros_pending_sync', []);
    q.push({ job, branch, failedAt: new Date().toISOString() });
    OS.set('tagros_pending_sync', q);
  },

  pull: async () => {
    if (Session.get()?.demo) return;
    const s = Session.get();
    if (!s?.branch || s.branch === 'ALL') return;
    try {
      const res  = await fetch(`${TAGRO_MANIFEST.api}/jobs?branch=${encodeURIComponent(s.branch)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.jobs)) return;
      const local = Jobs.all();
      const map   = {};
      [...data.jobs, ...local].forEach(j => {
        const key = j.id || j.workOrder;
        if (!key) return;
        const ex = map[key];
        if (!ex) { map[key] = j; return; }
        const ta = Date.parse(ex.updatedAt || 0) || 0;
        const tb = Date.parse(j.updatedAt  || 0) || 0;
        map[key] = tb > ta ? j : ex;
      });
      OS.set(Jobs._key(), Object.values(map));
    } catch {}
  },

  flushQueue: async () => {
    if (Session.get()?.demo) return;
    const s = Session.get();
    if (!s?.branch) return;
    const q   = OS.get('tagros_pending_sync', []);
    if (!q.length) return;
    const rem = [];
    for (const item of q) {
      try {
        const res = await fetch(`${TAGRO_MANIFEST.api}/jobs/upsert`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ branch: item.branch || s.branch, job: item.job })
        });
        if (!res.ok) rem.push(item);
      } catch { rem.push(item); }
    }
    OS.set('tagros_pending_sync', rem);
  }
};

// ── WORK ORDER ────────────────────────────────────────────
// Client generates a temporary INTAKE-{branch}-{timestamp} ID immediately.
// The Worker assigns the final sequential WO (e.g. KVR/2606/001) on first sync.
// confirmFromServer() updates the local record when the server responds.
const WorkOrder = {
  next: (branch) => {
    if (Session.get()?.demo) return 'DEMO-' + String(Date.now()).slice(-4);
    return 'INTAKE-' + (branch || 'UNK') + '-' + Date.now().toString(36).toUpperCase();
  },
  confirmFromServer: (jobId, confirmedWO) => {
    const all = Jobs.all();
    const idx = all.findIndex(j => j.id === jobId);
    if (idx < 0) return;
    all[idx] = { ...all[idx], workOrder: confirmedWO, woConfirmed: true };
    OS.set(Jobs._key(), all);
  }
};

// ── CUSTOMERS ─────────────────────────────────────────────
const Customers = {
  all:  () => OS.get('tagros_customers', []),
  save: (arr) => OS.set('tagros_customers', arr),

  find: (q, branch) => {
    q = q.toLowerCase().trim();
    if (!q) return [];
    const s = Session.get();
    return Customers.all().filter(c =>
      (c.branch === branch || s?.role === 'owner' || s?.demo) &&
      [c.name, c.phone, c.place, ...(c.alias || [])].join(' ').toLowerCase().includes(q)
    ).slice(0, 8);
  },

  upsert: (customer) => {
    const all = Customers.all();
    const idx = all.findIndex(c => c.id === customer.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...customer };
    } else {
      all.push(customer);
    }
    Customers.save(all);
  }
};

// ── NOTIFICATIONS ─────────────────────────────────────────
const Notifications = {
  all:    () => OS.get('tagros_notifications', []),
  unread: () => Notifications.all().filter(n => !n.read).length,

  add: (msg, type = 'internal') => {
    const arr = Notifications.all();
    arr.unshift({ id: Date.now(), msg, type, at: new Date().toISOString(), read: false });
    if (arr.length > 100) arr.pop();
    OS.set('tagros_notifications', arr);
    Notifications.badge();
  },

  markRead: () => {
    OS.set('tagros_notifications', Notifications.all().map(n => ({ ...n, read: true })));
    Notifications.badge();
  },

  badge: () => {
    const el = document.getElementById('notif-badge');
    const n  = Notifications.unread();
    if (el) { el.textContent = n; el.style.display = n ? 'flex' : 'none'; }
  }
};

// ── APP LAUNCHER ──────────────────────────────────────────
const AppLauncher = {
  current: null,

  open: (appId, context = null) => {
    const app = TAGRO_MANIFEST.apps.find(a => a.id === appId);
    if (!app) return;
    if (!Session.canAccess(appId)) { Toast.show('Access restricted'); return; }
    if (context) OS.set('tagros_launch_context', { ...context, appId, at: Date.now() });
    else         OS.del('tagros_launch_context');
    AppLauncher.current = appId;
    const frame   = document.getElementById('app-frame');
    const overlay = document.getElementById('app-overlay');
    if (!frame || !overlay) return;
    frame.src = app.file;
    overlay.classList.add('open');
    document.getElementById('app-title').textContent = app.label;
  },

  close: () => {
    AppLauncher.current = null;
    OS.del('tagros_launch_context');
    const overlay = document.getElementById('app-overlay');
    const frame   = document.getElementById('app-frame');
    if (overlay) overlay.classList.remove('open');
    if (frame)   setTimeout(() => { frame.src = 'about:blank'; }, 300);
  }
};

// ── TOAST ─────────────────────────────────────────────────
const Toast = {
  _timer: null,
  show: (msg, duration = 2500) => {
    let t = document.getElementById('os-toast');
    if (!t) { t = document.createElement('div'); t.id = 'os-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(Toast._timer);
    Toast._timer = setTimeout(() => t.classList.remove('visible'), duration);
  }
};

// ── HARD RESET ────────────────────────────────────────────
const HardReset = {
  trigger: () => {
    AppLauncher.close();
    document.querySelectorAll('.overlay, .modal, .sheet').forEach(el => el.remove());
    document.body.style.overflow = '';
    Toast.show('Recovered — tap an app to continue');
  }
};

// ── DEVICE ID ─────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('tagros_device_id');
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('tagros_device_id', id);
  }
  return id;
}

// ── TIME UTILITIES ────────────────────────────────────────
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}
