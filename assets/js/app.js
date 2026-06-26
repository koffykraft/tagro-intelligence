/**
 * TAGRO Shop-Floor App - Core Logic
 * Modern, dependency-free Vanilla JS
 */

// ==========================================================================
// 1. State & Data (Ready for backend fetch)
// ==========================================================================
let STAFF = {};
let CUSTOMERS = [];
let JOBS = [];

// ==========================================================================
// 2. Security Utilities
// ==========================================================================
// Prevents Cross-Site Scripting (XSS) when injecting user data via innerHTML
const escapeHTML = (str) => {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

// ==========================================================================
// 3. Authentication & Session
// ==========================================================================
function session() {
  try { return JSON.parse(localStorage.getItem("tagroSession")) || null; } 
  catch { return null; }
}

function requireSession() {
  const p = location.pathname.split("/").pop();
  if (!session() && !["login.html", "index.html", ""].includes(p)) {
    location.replace("login.html");
  }
}

function setupShell(active) {
  const s = session();
  if (!s) return; 
  
  const b = document.getElementById("branchBadge");
  const u = document.getElementById("userBadge");
  if (b) b.textContent = escapeHTML(s.branch);
  if (u) u.textContent = escapeHTML(s.staff);
  
  document.querySelectorAll(".navbtn").forEach(n => {
    n.classList.toggle("active", n.dataset.nav === active);
  });
}

function logout(e) {
  if (e) e.preventDefault(); // Prevents the screen from jumping to top
  localStorage.removeItem("tagroSession");
  location.href = "login.html";
}

// --- Login UI (Progressive Disclosure) ---
function pickBranch(branchCode, btnElement) {
  document.getElementById('branch').value = branchCode;
  
  document.querySelectorAll('.branch-btn').forEach(btn => btn.classList.remove('primary'));
  btnElement.classList.add('primary');

  document.getElementById('staffSection').classList.remove('hidden');
  document.getElementById('pinSection').classList.add('hidden'); 
  document.getElementById('staff').value = ''; 

  const staffList = STAFF[branchCode] || [];
  const staffGrid = document.getElementById('staffButtons');
  
  let html = staffList.map(name => {
    const safeName = escapeHTML(name);
    return `<button type="button" class="btn staff-btn" onclick="pickStaff('${safeName}', this)">${safeName}</button>`;
  }).join("");
  
  html += `<button type="button" class="btn soft staff-btn" onclick="promptNewUser()">+ New User</button>`;
  staffGrid.innerHTML = html;
}

function pickStaff(name, btnElement) {
  document.getElementById('staff').value = name;
  
  document.querySelectorAll('.staff-btn').forEach(btn => btn.classList.remove('selected'));
  btnElement.classList.add('selected');

  document.getElementById('pinSection').classList.remove('hidden');
  setTimeout(() => document.getElementById('pin')?.focus(), 50);
}

function promptNewUser() {
  const newName = prompt("Enter the new staff member's name:");
  if (newName && newName.trim() !== "") {
     const branch = document.getElementById('branch').value;
     if (!STAFF[branch]) STAFF[branch] = [];
     STAFF[branch].push(newName.trim());
     
     // Re-trigger the active branch button to refresh UI
     document.querySelector('.branch-btn.primary')?.click();
  }
}

function login(demo = false) {
  if (demo) {
    localStorage.setItem("tagroSession", JSON.stringify({ branch: "DEMO", staff: "Demo", loginAt: new Date().toISOString() }));
    location.href = "home.html";
    return;
  }

  const branch = document.getElementById("branch")?.value;
  const staff = document.getElementById("staff")?.value;
  
  if (!branch || !staff) {
    alert("Please select a branch and staff member.");
    return;
  }
  
  localStorage.setItem("tagroSession", JSON.stringify({ branch, staff, loginAt: new Date().toISOString() }));
  location.href = "home.html";
}

// ==========================================================================
// 4. Shared UI Interactions
// ==========================================================================
function toggle(btn) { 
  btn.classList.toggle("selected"); 
}

function selectOne(btn, group) {
  document.querySelectorAll(group).forEach(x => x.classList.remove("selected"));
  btn.classList.add("selected");
}

function showPanel(id) { 
  document.getElementById(id)?.classList.remove("hidden");
  document.getElementById(id)?.classList.add("show"); 
}

// ==========================================================================
// 5. Reception Flow (Receive.html)
// ==========================================================================
function searchCustomer() {
  const q = (document.getElementById("custSearch")?.value || "").toLowerCase().trim();
  const box = document.getElementById("customerResults");
  if (!box) return;
  
  if (q.length < 2) { 
    box.classList.remove("show"); 
    box.innerHTML = ""; 
    return; 
  }
  
  const matches = CUSTOMERS.filter(c => {
    const machineStr = (c.machines || []).join(" ");
    return [c.name, c.phone, c.alias, machineStr].join(" ").toLowerCase().includes(q);
  });
  
  box.classList.add("show");
  
  if (!matches.length) {
    box.innerHTML = `
      <div class="list">
        <div class="title">No match found</div>
        <div class="small">Use + New Customer. Keep eye contact. Do not make reception feel like interrogation.</div>
      </div>`;
    return;
  }
  
  box.innerHTML = matches.map((c, i) => `
    <div class="list click" onclick="pickCustomer(${i})">
      <div class="title">${escapeHTML(c.name)}</div>
      <div class="small">
        ${escapeHTML(c.phone)} · Alias: ${escapeHTML(c.alias || 'N/A')}<br>
        ${escapeHTML((c.machines || []).join(", "))}
      </div>
    </div>`).join("");
}

function pickCustomer(i) {
  const c = CUSTOMERS[i];
  if (!c) return;
  
  document.getElementById("custSearch").value = `${c.name} — ${c.phone}`;
  const m = document.getElementById("machineSelect");
  
  if (m) {
    m.innerHTML = (c.machines || []).map(x => `<option>${escapeHTML(x)}</option>`).join("") + 
                  `<option value="new">+ Add New Machine</option>`;
  }
  document.getElementById("customerResults").classList.remove("show");
}

function saveNewCustomer() {
  const name = document.getElementById("newName")?.value.trim();
  const phone = document.getElementById("newPhone")?.value.trim();
  
  if (!name && !phone) { 
    alert("Enter name or phone"); 
    return; 
  }
  
  document.getElementById("custSearch").value = `${name || "New Customer"}${phone ? " — " + phone : ""}`;
  document.getElementById("newCustomerPanel").classList.remove("show");
  showPanel("newMachinePanel");
}

function saveNewMachine() {
  const model = document.getElementById("newModel")?.value.trim();
  const serial = document.getElementById("newSerial")?.value.trim();
  
  if (!model) { 
    alert("Enter model"); 
    return;
  }
  
  const m = document.getElementById("machineSelect");
  if (m) {
    const newOptionText = `${model}${serial ? " — Serial " + serial : " — Serial unknown"}`;
    m.innerHTML = `<option>${escapeHTML(newOptionText)}</option>` + m.innerHTML;
    m.selectedIndex = 0; // Select the newly added item
  }
  document.getElementById("newMachinePanel").classList.remove("show");
}

function receiveMachine() {
  // 1. Gather Data
  const customerInput = document.getElementById("custSearch")?.value;
  const machine = document.getElementById("machineSelect")?.value;
  const note = document.getElementById("customerNotes")?.value.trim();
  
  const urgencyBtn = document.querySelector(".urgency.selected");
  const urgency = urgencyBtn ? urgencyBtn.textContent.trim() : "None selected";
  
  const symptomBtns = document.querySelectorAll(".symptom-tag.selected");
  const symptoms = Array.from(symptomBtns).map(btn => btn.textContent.trim());

  if (!customerInput) {
    alert("Please select or add a customer first.");
    return;
  }

  // 2. Construct Payload (Ready to send to your backend)
  const jobPayload = {
    customer: customerInput,
    machine: machine,
    urgency: urgency,
    notes: note,
    symptoms: symptoms,
    receivedAt: new Date().toISOString(),
    status: "Waiting Inspection"
  };

  console.log("Saving new job:", jobPayload);
  alert("Reception Complete. Machine moved to Waiting Inspection.");
  location.href = "bench.html";
}

// ==========================================================================
// 6. Shop-Floor Flows (Bench & Work)
// ==========================================================================
function renderBench() {
  const current = document.getElementById("currentJob");
  const paused = document.getElementById("pausedJobs");
  const waiting = document.getElementById("waitingJobs");
  
  const currentJob = JOBS.find(j => j.isCurrent); 
  
  if (current) {
    if (currentJob) {
      const pauseText = currentJob.pausedAt ? `Paused ${escapeHTML(currentJob.pausedAt)} · ` : '';
      current.innerHTML = `
        <div class="list workbench-current">
          <div class="title">${escapeHTML(currentJob.model)} — ${escapeHTML(currentJob.customer)} <span class="pill">Current</span></div>
          <div class="small">${pauseText}${escapeHTML(currentJob.note || '')}</div>
          <div class="grid2" style="margin-top:12px">
            <a class="btn primary" href="work.html?job=${currentJob.id}">▶ Resume</a>
            <a class="btn" href="work.html?job=${currentJob.id}">Open</a>
          </div>
        </div>`;
    } else {
      current.innerHTML = `<div class="small">No active job on bench.</div>`;
    }
  }
  
  if (paused) {
    const pauseStates = ["Paused", "Waiting Parts", "Manager Review"];
    const pausedList = JOBS.filter(j => pauseStates.includes(j.state));
    
    paused.innerHTML = pausedList.length ? pausedList.map(j => `
      <a href="work.html?job=${j.id}" class="list click" style="display:block;">
        <div class="title">${escapeHTML(j.model)} — ${escapeHTML(j.customer)} <span class="pill amber">${escapeHTML(j.state)}</span></div>
        <div class="small">Next: ${escapeHTML(j.next || 'N/A')}<br>${escapeHTML(j.note || '')}</div>
      </a>`).join("") : `<div class="small">No paused jobs.</div>`;
  }
  
  if (waiting) {
    const waitingList = JOBS.filter(j => j.state === "Waiting Inspection");
    
    waiting.innerHTML = waitingList.length ? waitingList.map(j => `
      <a href="work.html?job=${j.id}" class="list click" style="display:block;">
        <div class="title">${escapeHTML(j.model)} — ${escapeHTML(j.customer)} <span class="pill">${escapeHTML(j.state)}</span></div>
        <div class="small">${escapeHTML(j.urgency || '')}<br>${escapeHTML(j.note || '')}</div>
      </a>`).join("") : `<div class="small">No machines waiting.</div>`;
  }
}

function choosePause(btn) {
  document.querySelectorAll(".pause-type").forEach(x => x.classList.remove("selected"));
  btn.classList.add("selected");
}

function pauseWork() {
  const reasonBtn = document.querySelector(".pause-type.selected");
  const reason = reasonBtn ? reasonBtn.textContent.trim() : "Pause";
  const note = document.getElementById("pauseNote")?.value.trim();
  
  localStorage.setItem("tagroPauseNote", JSON.stringify({ reason, note, at: new Date().toISOString() }));
  alert("Paused with resume reminder.");
  location.href = "bench.html";
}

function addPO(part) {
  const list = JSON.parse(localStorage.getItem("tagroPO") || "[]");
  const s = session();
  
  if (!s) {
    alert("Session expired. Please log in again.");
    return;
  }
  
  list.unshift({ 
    part: part, 
    branch: s.branch, 
    staff: s.staff, 
    at: new Date().toISOString(), 
    status: "Need Purchase / Transfer" 
  });
  
  localStorage.setItem("tagroPO", JSON.stringify(list));
  alert(`Added ${part} to Purchase Order.`);
}

// ==========================================================================
// 7. Initialization
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  requireSession();
  const page = document.body.dataset.page;
  if (page) {
    setupShell(page);
    if (page === "bench") renderBench();
  }
});
