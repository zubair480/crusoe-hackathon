// ThermalDesk backend bridge. Kept separate from the Three.js scene so visual work can continue.
const params = new URLSearchParams(location.search);
const API = params.get("api") || localStorage.getItem("thermaldesk-api") || "http://127.0.0.1:3001";
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

const label = value => String(value ?? "—").replaceAll("_", " ");
function availableActions() {
  if (!state) return [];
  const actions = [];
  if (!state.job && !state.scenarioLoaded) actions.push(["load_demo_scope", "Load demo scope"]);
  if (!state.job && state.scenarioLoaded && state.recommendation?.status === "draft") actions.push(["approve_scope", "Approve scope"]);
  if (state.recommendation?.status === "approved" && (!state.job || ["blocked", "coordinating"].includes(state.job.status))) actions.push(["coordinate", state.job ? "Re-coordinate" : "Coordinate repair"]);
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
  root.classList.toggle("wf-online", connected);
  root.innerHTML = `
    <div class="wf-head"><span><i class="wf-dot"></i>Repair workflow</span><span>${connected ? "Connected" : "Offline"}</span></div>
    <div class="wf-meta">${API} · revision ${state?.revision ?? "—"} · Crusoe ${label(health?.integrations?.crusoe)}</div>
    <div class="wf-status"><b>${job ? `Job ${job.job_id}` : recommendation ? `Recommendation ${recommendation.recommendation_id}` : "No active repair"}</b><br>
      <span>${job ? `Status: ${label(job.status)} · parts: ${label(job.parts_status)}` : recommendation ? `Status: ${label(recommendation.status)}` : "Load the synthetic scenario to demonstrate the closed loop."}</span><br>
      <span class="${failed ? "wf-error" : "wf-ok"}">${message}</span></div>
    <div class="wf-actions">
      ${actions.map(([command,text]) => `<button data-command="${command}" ${busy ? "disabled" : ""}>${text}</button>`).join("")}
      ${job ? `<a href="${API}/api/schedule" target="_blank" rel="noopener">Excel</a><a href="${API}/api/report" target="_blank" rel="noopener">Report</a>` : ""}
      <button data-command="reset_demo" ${busy ? "disabled" : ""}>Reset demo</button>
    </div>`;
  root.querySelectorAll("button[data-command]").forEach(button => button.addEventListener("click", () => command(button.dataset.command)));
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
    message = state.job ? `Backend state loaded: ${label(state.job.status)}.` : "Backend state loaded.";
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
    message = `${label(commandName)} completed.`;
    window.dispatchEvent(new CustomEvent("thermaldesk:state", { detail: structuredClone(state) }));
  } catch (error) {
    failed = true; message = error.message;
    try { state = await json("/api/case"); } catch {}
  } finally {
    busy = false; render();
  }
}

window.thermaldeskWorkflow = { refresh, command, get state() { return state; }, api: API };
render();
refresh();
