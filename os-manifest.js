// TAGRO OS — App Registry and System Configuration
//
// SINGLE SOURCE OF TRUTH for:
//   api              — Cloudflare Worker endpoint
//   apps             — every application in the OS
//   roles            — permission groups
//   branches         — all TAGRO branch definitions
//   domains          — business domain taxonomy
//   statusFromEvent  — event-to-status derivation (no manual status anywhere)
//   knowledge        — Knowledge Layer API surface definition
//
// HOW TO ADD AN APP:
//   1. Add one entry to `apps` below.
//   2. Create the HTML file.
//   3. Nothing else changes. The shell discovers it automatically.
//
// HOW TO RESTRICT AN APP:
//   Set access.roles, access.branches, access.users, or access.flags.
//   Set enabled: false to disable without removing.
//
// THE SHELL NEVER HARDCODES APPLICATION LOGIC.
// THE KNOWLEDGE LAYER IS STORAGE-AGNOSTIC.
// Applications call Knowledge.method() — never storage directly.

const TAGRO_MANIFEST = {

  // ── API ─────────────────────────────────────────────────
  // New TAGRO OS Worker — separate from service.tagro.in
  // Set this to the new deployment URL when the Worker is deployed.
  api:     'https://tagro-os.icy-fire-d2ac.workers.dev',
  version: '2.0.0',
  build:   '2026-06',

  // ── KNOWLEDGE LAYER API SURFACE ──────────────────────────
  // This defines the canonical interface that every application uses.
  // Applications never call storage directly — they call Knowledge.method().
  // The Knowledge service resolves from KV, D1, R2, Worker, or fallback.
  //
  // When new datasets are imported (pricing, labour, history, manuals),
  // the Knowledge service expands. Applications become smarter automatically.
  //
  // This is the contract. The implementation lives in os-core.js Knowledge.
  //
  // RESPONSE CONTRACT — every method returns:
  //   { data, confidence, source, sourceDate, sourceType, retrievedAt }
  //
  // confidence: 0.0 = not available | 0.5 = offline bundle | 0.7 = derived | 1.0 = authoritative
  // sourceType: 'kv' | 'r2' | 'd1' | 'bundle' | 'excel_import' | 'manual_entry' | 'derived'
  //
  // GRAPH DIRECTION (future)
  //   Machine → parts → failures → manuals → labour → history → customer
  //   Part → machines → supersessions → stock → pricing → supplier → usage
  // Every record carries `relations` for future graph traversal.
  // Storage is replaceable. Applications never change when storage changes.
  knowledgeAPI: {
    // Synchronous (from cache — no await needed)
    models:    'Knowledge.models(categoryId?) → wrapped model list',
    parts:     'Knowledge.parts(modelId?) → wrapped parts list',
    part:      'Knowledge.part(partNumber) → wrapped part record',
    search:    'Knowledge.search(query, modelId?) → wrapped search results',
    // Async (may fetch from Worker)
    machine:   'Knowledge.machine(modelId) → wrapped full machine record',
    manuals:   'Knowledge.manuals(modelId) → wrapped manual list',
    bulletin:  'Knowledge.bulletin(modelId) → wrapped bulletins',
    pricing:   'Knowledge.pricing(partNumber) → wrapped price record',
    labour:    'Knowledge.labour(operation) → wrapped labour rate',
    history:   'Knowledge.history(serial) → wrapped repair history',
    documents: 'Knowledge.documents(filters?) → wrapped document list',
    document:  'Knowledge.document(id) → wrapped single document',
  },

  // ── KNOWLEDGE STORAGE SOURCES ────────────────────────────
  // Where each knowledge type currently lives.
  // When storage changes (KV → D1 → graph DB), update here only.
  // Applications never see this — only Knowledge resolvers read it.
  knowledgeSources: {
    models:    { primary: 'kv',     key: 'models:all',           fallback: 'bundle'  },
    machine:   { primary: 'kv',     key: 'machine:{id}',         fallback: 'derived' },
    parts:     { primary: 'kv',     key: 'parts:master',         fallback: 'bundle'  },
    part:      { primary: 'kv',     key: 'part:{no}',            fallback: null      },
    manuals:   { primary: 'r2',     key: 'stihl/{model}/',       fallback: null      },
    pricing:   { primary: 'worker', endpoint: '/knowledge/pricing',    fallback: null },
    labour:    { primary: 'worker', endpoint: '/knowledge/labour',     fallback: null },
    history:   { primary: 'd1',     table: 'service_jobs',       fallback: null      },
    search:    { primary: 'worker', endpoint: '/knowledge/search',     fallback: null },
    bulletin:  { primary: 'r2',     key: 'bulletins/{model}/',   fallback: null      },
    documents: { primary: 'r2',     key: 'documents/',           fallback: null      },
    document:  { primary: 'r2',     key: 'documents/{id}',       fallback: null      },
  },

  // ── APPS ────────────────────────────────────────────────
  // Full registry schema. Domain groups: workshop, knowledge, business, administration.

  apps: [

    // ── WORKSHOP ───────────────────────────────────────────
    {
      id: 'receive', label: 'Receive', icon: 'receive',
      file: 'app-receive.html', domain: 'workshop',
      color: '#df6427', description: 'Accept a machine into the workshop',
      enabled: true,
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },
    {
      id: 'jobs', label: 'Jobs', icon: 'jobs',
      file: 'app-jobs.html', domain: 'workshop',
      color: '#2563eb', description: 'Find and open any job',
      enabled: true,
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },
    {
      id: 'work', label: 'Work', icon: 'work',
      file: 'app-work.html', domain: 'workshop',
      color: '#287a3e', description: 'Work on a machine — timeline, estimate, status',
      enabled: true,
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },
    {
      id: 'inspection', label: 'Inspection', icon: 'work',
      file: 'app-inspection.html', domain: 'workshop',
      color: '#0f766e', description: 'Inspect and diagnose a machine',
      enabled: false,   // not yet built
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },
    {
      id: 'estimate', label: 'Estimate', icon: 'reports',
      file: 'app-estimate.html', domain: 'workshop',
      color: '#7c3aed', description: 'Build and send a repair estimate',
      enabled: false,   // not yet built
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },
    {
      id: 'approval', label: 'Approval', icon: 'po',
      file: 'app-approval.html', domain: 'workshop',
      color: '#0891b2', description: 'Customer approval for estimate',
      enabled: false,
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },
    {
      id: 'parts', label: 'Parts', icon: 'parts',
      file: 'app-parts.html', domain: 'workshop',
      color: '#b45309', description: 'Search parts, check prices and availability',
      enabled: true,
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },
    {
      id: 'po', label: 'PO', icon: 'po',
      file: 'app-po.html', domain: 'workshop',
      color: '#be123c', description: 'Purchase orders — parts needed',
      enabled: false,
      access: { roles: ['manager', 'owner'], branches: ['all'], users: [], flags: [] }
    },

    // ── KNOWLEDGE ──────────────────────────────────────────
    {
      id: 'machines', label: 'Machines', icon: 'work',
      file: 'app-machines.html', domain: 'knowledge',
      color: '#0f766e', description: 'Machine catalogue — specs, manuals, history',
      enabled: false,
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },
    {
      id: 'manuals', label: 'Manuals', icon: 'links',
      file: 'app-manuals.html', domain: 'knowledge',
      color: '#475569', description: 'Workshop manuals, IPLs, technical bulletins',
      enabled: false,
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },
    {
      id: 'tech', label: 'Tech', icon: 'tech',
      file: 'app-tech.html', domain: 'knowledge',
      color: '#2563eb', description: 'AI technical assistant — troubleshoot, howto, train',
      enabled: true,
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },

    // ── BUSINESS ───────────────────────────────────────────
    {
      id: 'reports', label: 'Reports', icon: 'reports',
      file: 'app-reports.html', domain: 'business',
      color: '#7c3aed', description: 'Branch summary, variance, performance',
      enabled: false,
      access: { roles: ['manager', 'owner'], branches: ['all'], users: [], flags: [] }
    },

    // ── ADMINISTRATION ─────────────────────────────────────
    {
      id: 'links', label: 'Links', icon: 'links',
      file: 'app-links.html', domain: 'administration',
      color: '#334155', description: 'Useful external sites and resources',
      enabled: true,
      access: { roles: ['all'], branches: ['all'], users: [], flags: [] }
    },

  ],

  // ── PERMISSION RESOLVER ──────────────────────────────────
  // Single function. Called by shell and os-core.js only.
  // Apps never implement their own visibility logic.
  canAccess(app, session) {
    if (!app.enabled) return false;
    if (!session)     return false;
    const role   = (session.role   || 'staff').toLowerCase();
    const branch = (session.branch || '');
    const user   = (session.name   || '');
    const active = session.activeFlags || [];
    const ac     = app.access;
    if (!ac.roles.includes('all')     && !ac.roles.includes(role))           return false;
    if (!ac.branches.includes('all')  && !ac.branches.includes(branch))      return false;
    if (ac.users.length > 0           && !ac.users.includes(user))           return false;
    if (ac.flags.length > 0           && !ac.flags.every(f => active.includes(f))) return false;
    return true;
  },

  // ── BRANCHES ────────────────────────────────────────────
  branches: {
    KVR: 'Karavaloor',
    PKM: 'Ponkunnam',
    NDD: 'Nedumangad',
    MDM: 'Marthandam',
    SKT: 'Shencottai',
    OYR: 'Oyoor',
    SDM: 'Sadanandapuram'
  },

  // ── DOMAINS ─────────────────────────────────────────────
  // Desktop grouping. Each domain becomes a section on the home screen.
  domains: {
    workshop:       { label: 'Workshop',       icon: '🔧', order: 1 },
    knowledge:      { label: 'Knowledge',      icon: '📚', order: 2 },
    business:       { label: 'Business',       icon: '📊', order: 3 },
    administration: { label: 'Administration', icon: '⚙️',  order: 4 },
    // Future domains — add here when apps are built
    // irrigation:  { label: 'Irrigation',    icon: '💧', order: 5 },
    // agriculture: { label: 'Agriculture',   icon: '🌾', order: 6 },
    // finance:     { label: 'Finance',       icon: '💳', order: 7 },
  },

  // ── NOTIFICATION COLOURS ─────────────────────────────────
  notificationColors: {
    internal: { dot: '#df6427', label: 'TAGRO'  },
    phone:    { dot: '#2563eb', label: 'Phone'  },
    alert:    { dot: '#dc2626', label: 'Alert'  },
    ready:    { dot: '#16a34a', label: 'Ready'  }
  },

  // ── STATUS DERIVATION ────────────────────────────────────
  // Status is NEVER set manually. Derived from the last non-null timeline event.
  // To add a new status: add a new event type here. Nothing else changes.
  statusFromEvent: {
    machine_received:    'Received',
    inspection_started:  'Inspecting',
    repair_started:      'Repairing',
    repair_paused:       'On Hold',
    parts_requested:     'Waiting Parts',
    repair_resumed:      'Repairing',
    estimate_ready:      'Awaiting Approval',
    customer_approved:   'Repairing',
    repair_completed:    'Ready',
    customer_notified:   'Ready',
    machine_delivered:   'Delivered',
    note:                null,
    photo:               null,
    parts_used:          null
  }

};
