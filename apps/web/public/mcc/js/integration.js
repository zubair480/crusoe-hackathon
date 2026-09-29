// ThermalDesk backend bridge. Kept separate from the Three.js scene so visual work can continue.
const params = new URLSearchParams(location.search);
const defaultApi = location.port === "8765" ? "http://127.0.0.1:3001" : location.origin;
const API = params.get("api") || localStorage.getItem("thermaldesk-api") || defaultApi;
localStorage.setItem("thermaldesk-api", API);

const style = document.createElement("style");
style.textContent = `
  #workflow{position:fixed;right:16px;bottom:64px;z-index:7;width:330px;padding:12px 14px;background:rgba(8,11,14,.88);backdrop-filter:blur(8px);border-left:2px solid #ffc440;color:#eef1f3;font:500 12px/1.35 var(--hud);clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
  #workflow .wf-head{display:flex;justify-content:space-between;gap:8px;align-items:center;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}
  #workflow .wf-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff4632;margin-right:6px}.wf-online .wf-dot{background:#5cf08a;box-shadow:0 0 9px #5cf08a}
  #workflow .wf-meta{color:#7f8a94;font:500 10px/1.4 var(--mono);margin:5px 0 9px;overflow-wrap:anywhere}
  #workflow .wf-status{padding:7px 8px;background:#ffffff0b;border-left:2px solid #ffffff2b;margin-bottom:8px}
  #workflow .wf-actions{display:flex;flex-wrap:wrap;gap:6px}#workflow button,#workflow a{border:1px solid #ffffff2b;background:#161b20;color:#eef1f3;padding:6px 8px;font:700 10px var(--hud);letter-spacing:.8px;text-transform:uppercase;text-decoration:none;cursor:pointer}
  #workflow button:hover,#workflow a:hover{border-color:#ffc440}#workflow button:disabled{opacity:.45;cursor:wait}.wf-error{color:#ff7668}.wf-ok{color:#5cf08a}
  #workflow .wf-upload{border:1px solid #ffc440;background:#ffc440;color:#090b0d;padding:6px 8px;font:800 10px var(--hud);letter-spacing:.8px;text-transform:uppercase;cursor:pointer}#workflow .wf-upload input{display:none}
  @media(max-width:760px){#workflow{left:10px;right:10px;bottom:58px;width:auto;max-height:42vh;overflow:auto}}
`;
document.head.append(style);

const root = document.createElement("section");
root.id = "workflow";
root.setAttribute("aria-live", "polite");
document.body.append(root);

let state = null;
let health = null;
let busy = false;
let message = "Connecting to workflow backend…";
let failed = false;

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const label = value => escape(String(value ?? "—").replaceAll("_", " "));
function analysisMessage() {
  const rec = state?.recommendation;
  if (!rec) return "Upload an image or report to begin analysis.";
  if (rec.analysis_mode !== "live") return "Fixture or validation result only; no live Crusoe analysis. Draft report is available.";
  return rec.status === "needs_information" ? "Crusoe returned a draft with missing information. Review the findings and report." : "Crusoe draft ready for review. Report is available.";
}
function availableActions() {
  if (!state) return [];
  const actions = [];
  if (!state.job && !state.scenarioLoaded) actions.push(["load_demo_scope", "Load demo scope"]);
  if (!state.job && state.recommendation?.status === "draft" && !state.recommendation.missing_information?.length) actions.push(["approve_scope", "Approve scope"]);
  if (state.recommendation?.status === "approved" && (!state.job || ["blocked", "coordinating"].includes(state.job.status))) actions.push(["coordinate", "Run simulated demo"]);
  if (state.job && ["scheduled", "in_progress", "awaiting_verification"].includes(state.job.status)) actions.push(["complete", "Record completion"]);
  if (state.completion && (!state.verification || state.verification.completion_version !== state.completion.version)) actions.push(["verify", "Verify evidence"]);
  if (state.verification?.result === "ready_for_review" && state.job?.status === "awaiting_verification") actions.push(["approve_closure", "Approve closure"]);
  return actions;
}

function render() {
  const connected = Boolean(state && health);
  const job = state?.job;
  const recommendation = state?.recommendation;
  const actions = availableActions();
  if (state && !job) actions.unshift(["analyze", "Analyze evidence"]);
  root.classList.toggle("wf-online", connected);
  root.innerHTML = `
    <div class="wf-head"><span><i class="wf-dot"></i>Repair workflow</span><span>${connected ? "Connected" : "Offline"}</span></div>
    <div class="wf-meta">${escape(API)} · revision ${state?.revision ?? "—"} · Crusoe ${label(health?.integrations?.crusoe)}</div>
    <div class="wf-status"><b>${job ? `Job ${escape(job.job_id)}` : recommendation ? `Recommendation ${escape(recommendation.recommendation_id)}` : "No active repair"}</b><br>
      <span>${job ? `Status: ${label(job.status)} · parts: ${label(job.parts_status)}` : recommendation ? `Status: ${label(recommendation.status)}` : "Upload inspection evidence to create a draft report."}</span><br>
      <span class="${failed ? "wf-error" : "wf-ok"}">${escape(message)}</span></div>
    ${health?.integrations?.crusoe === "simulated" ? '<p>Demo analysis is enabled. Images are stored locally; Crusoe is not called.</p>' : health?.integrations?.crusoe === "live_requests_disabled" ? '<p class="wf-error">Live Crusoe requests are disabled by the spending control.</p>' : ""}
    <p>Demo purchasing and outreach are simulated. Open <b>Parts & dispatch</b> for public supplier research, recorded quotes and downloadable email drafts.</p>
    ${job ? '<p>Inspection uploads are locked for this repair. Reset demo clears this case and its schedule; download the report first if needed.</p>' : ""}
    ${recommendation ? `<details><summary>Findings (${recommendation.findings.length}) · missing information (${recommendation.missing_information.length})</summary>${recommendation.findings.map(f => `<p><b>${label(f.severity)}</b>: ${escape(f.description)}<br>Evidence: ${escape(f.evidence_ids.join(", "))}</p>`).join("")}<p>${escape(recommendation.repair_scope)}</p><ul>${recommendation.missing_information.map(item => `<li>${escape(item)}</li>`).join("")}</ul></details>` : ""}
    <div class="wf-actions">
      <a href="${escape(API)}/api/preparation/workbench" target="_blank" rel="noopener">Parts & dispatch</a>
      ${!job ? `<label class="wf-upload">Upload & analyze<input id="wf-file" type="file" accept="image/png,image/jpeg,application/pdf,text/plain" ${busy || !state ? "disabled" : ""}></label>` : ""}
      ${actions.map(([command,text]) => `<button data-command="${command}" ${busy ? "disabled" : ""}>${text}</button>`).join("")}
      ${job ? `<a href="${escape(API)}/api/schedule" target="_blank" rel="noopener">Excel</a>` : ""}
      ${recommendation || state?.inspection.evidence.some(e => e.source === "upload") ? `<a href="${escape(API)}/api/report" target="_blank" rel="noopener">${job ? "Report" : "Draft report"}</a>` : ""}
      <button data-command="reset_demo" ${busy ? "disabled" : ""}>Reset demo</button>
    </div>`;
  root.querySelectorAll("button[data-command]").forEach(button => button.addEventListener("click", () => command(button.dataset.command)));
  root.querySelector("#wf-file")?.addEventListener("change", event => upload(event.target.files?.[0]));
}

async function json(path, options) {
  const response = await fetch(API + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function refresh() {
  try {
    [health, state] = await Promise.all([json("/api/health"), json("/api/case")]);
    failed = false;
    message = state.job ? `Backend state loaded: ${state.job.status}.` : analysisMessage();
    window.dispatchEvent(new CustomEvent("thermaldesk:state", { detail: structuredClone(state) }));
  } catch (error) {
    failed = true;
    message = error.message;
  }
  render();
}

async function command(commandName) {
  if (!state || busy) return;
  busy = true; failed = false; message = `Running ${label(commandName)}…`; render();
  try {
    state = await json("/api/case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: commandName, expectedRevision: state.revision, reviewer: "3D demo reviewer" }),
    });
    message = commandName === "analyze" ? analysisMessage() : `${commandName.replaceAll("_", " ")} completed.`;
    window.dispatchEvent(new CustomEvent("thermaldesk:state", { detail: structuredClone(state) }));
  } catch (error) {
    failed = true; message = error.message;
    try { state = await json("/api/case"); } catch {}
  } finally {
    busy = false; render();
  }
}

async function upload(file) {
  if (!file || !state || busy) return;
  if (state.job) { failed = true; message = `Upload blocked: repair ${state.job.job_id} is ${state.job.status}. The current inspection is locked.`; render(); return; }
  busy = true; failed = false; message = `Uploading ${file.name}…`; render();
  let saved = false;
  try {
    const form = new FormData();
    form.set("file", file);
    form.set("expectedRevision", String(state.revision));
    const response = await fetch(API + "/api/evidence", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    state = data;
    saved = true;
    message = `${file.name} saved. Analyzing evidence…`; render();
    window.dispatchEvent(new CustomEvent("thermaldesk:state", { detail: structuredClone(state) }));
    state = await json("/api/case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "analyze", expectedRevision: state.revision }),
    });
    message = analysisMessage();
    window.dispatchEvent(new CustomEvent("thermaldesk:state", { detail: structuredClone(state) }));
  } catch (error) {
    failed = true; message = saved ? `${file.name} was saved, but analysis could not complete: ${error.message}. Use Analyze evidence to retry.` : error.message;
    try { state = await json("/api/case"); } catch {}
  } finally {
    busy = false; render();
  }
}

window.thermaldeskWorkflow = { refresh, command, upload, get state() { return state; }, api: API };
render();
refresh();
