// Ready to be populated via backend fetch API
let STAFF = {};
let CUSTOMERS = [];
let JOBS = [];

function loadStaff() {
  const b = document.getElementById("branch")?.value;
  const s = document.getElementById("staff");
  if (!s || !b) return;
  s.innerHTML = (STAFF[b] || []).map(n => `<option>${n}</option>`).join("");
}

function login() {
  const branch = document.getElementById("branch")?.value;
  const staff = document.getElementById("staff")?.value;
  
  if (!branch || !staff) {
    alert("Please select a branch and staff member.");
    return;
  }
  
  localStorage.setItem("tagroSession", JSON.stringify({ branch, staff, loginAt: new Date().toISOString() }));
  location.href = "home.html";
}

function session() {
  try { return JSON.parse(localStorage.getItem("tagroSession") || "null"); }
  catch { return null; }
}

function requireSession() {
  const p = location.pathname.split("/").pop();
  if (!session() && !["login.html", "index.html", ""].includes(p)) {
    location.href = "login.html";
  }
}

function setupShell(active) {
  const s = session();
  if (!s) return; // requireSession will handle the redirect if missing
  
  const b = document.getElementById("branchBadge");
  const u = document.getElementById("userBadge");
  if (b) b.textContent = s.branch;
  if (u) u.textContent = s.staff;
  
  document.querySelectorAll(".navbtn").forEach(n => n.classList.toggle("active", n.dataset.nav === active));
}

function logout() {
  localStorage.removeItem("tagroSession");
  location.href = "login.html";
}

function toggle(btn) { 
  btn.classList.toggle("selected"); 
}

function selectOne(btn, group) {
  document.querySelectorAll(group).forEach(x => x.classList.remove("selected"));
  btn.classList.add("selected");
}

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
    box.innerHTML = `<div class="list"><div class="title">No match found</div><div class="small">Use + New Customer. Keep eye contact. Do not make reception feel like interrogation.</div></div>`;
    return;
  }
  
  box.innerHTML = matches.map((c, i) => `
    <div class="list click" onclick="pickCustomer(${i})">
      <div class="title">${c.name}</div>
      <div class="small">${c.phone} · Alias: ${c.alias || 'N/A'}<br>${(c.machines || []).join(", ")}</div>
    </div>`).join("");
}

function pickCustomer(i) {
  const c = CUSTOMERS[i];
  if (!c) return;
  
  document.getElementById("custSearch").value = `${c.name} — ${c.phone}`;
  const m = document.getElementById("machineSelect");
  
  if (m) {
    m.innerHTML = (c.machines || []).map(x => `<option>${x}</option>`).join("") + "<option>+ Add New Machine</option>";
  }
  document.getElementById("customerResults").classList.remove("show");
}

function showPanel(id) { 
  document.getElementById(id)?.classList.add("show"); 
}

function saveNewCustomer() {
  const name = document.getElementById("newName").value.trim();
  const phone = document.getElementById("newPhone").value.trim();
  
  if (!name && !phone) { 
    alert("Enter name or phone"); 
    return; 
  }
  
  document.getElementById("custSearch").value = `${name || "New Customer"}${phone ? " — " + phone : ""}`;
  document.getElementById("newCustomerPanel").classList.remove("show");
  showPanel("newMachinePanel");
}

function saveNewMachine() {
  const model = document.getElementById("newModel").value.trim();
  const serial = document.getElementById("newSerial").value.trim();
  
  if (!model) { 
    alert("Enter model"); 
    return; 
  }
  
  const m = document.getElementById("machineSelect");
  if (m) {
    m.innerHTML = `<option>${model}${serial ? " — Serial " + serial : " — Serial unknown"}</option>` + m.innerHTML;
    m.selectedIndex = 0;
  }
  document.getElementById("newMachinePanel").classList.remove("show");
}

function receiveMachine() {
  alert("Reception Complete. Machine moved to Waiting Inspection.");
  location.href = "bench.html";
}

function renderBench() {
  const current = document.getElementById("currentJob");
  const paused = document.getElementById("pausedJobs");
  const waiting = document.getElementById("waitingJobs");
  
  // Find current job (assuming you will flag it in your DB)
  const currentJob = JOBS.find(j => j.isCurrent); 
  
  if (current) {
    if (currentJob) {
      current.innerHTML = `
        <div class="list workbench-current">
          <div class="title">${currentJob.model} — ${currentJob.customer} <span class="pill">Current</span></div>
          <div class="small">Paused 18 min ago · ${currentJob.note || ''}</div>
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
      <div class="list click" onclick="location.href='work.html?job=${j.id}'">
        <div class="title">${j.model} — ${j.customer} <span class="pill amber">${j.state}</span></div>
        <div class="small">Next: ${j.next || 'N/A'}<br>${j.note || ''}</div>
      </div>`).join("") : `<div class="small">No paused jobs.</div>`;
  }
  
  if (waiting) {
    const waitingList = JOBS.filter(j => j.state === "Waiting Inspection");
    
    waiting.innerHTML = waitingList.length ? waitingList.map(j => `
      <div class="list click" onclick="location.href='work.html?job=${j.id}'">
        <div class="title">${j.model} — ${j.customer} <span class="pill">${j.state}</span></div>
        <div class="small">${j.urgency || ''}<br>${j.note || ''}</div>
      </div>`).join("") : `<div class="small">No machines waiting.</div>`;
  }
}

function choosePause(btn) {
  document.querySelectorAll(".pause-type").forEach(x => x.classList.remove("selected"));
  btn.classList.add("selected");
}

function pauseWork() {
  const reason = document.querySelector(".pause-type.selected")?.textContent.trim() || "Pause";
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
  
  list.unshift({ part, branch: s.branch, staff: s.staff, at: new Date().toISOString(), status: "Need Purchase / Transfer" });
  localStorage.setItem("tagroPO", JSON.stringify(list));
  alert("Added to Purchase Order.");
}

document.addEventListener("DOMContentLoaded", () => {
  requireSession();
  const page = document.body.dataset.page;
  setupShell(page);
  if (page === "bench") renderBench();
});
