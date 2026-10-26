const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
const pill = document.getElementById("status-pill");

const PAGE = {
  home: {
    title: "Setup",
    lede: "Finish these steps to get SoleMCP working with your coding apps.",
  },
  apps: {
    title: "Apps",
    lede: "Connect Cursor, Claude Code, or Codex so they can use tools you allow.",
  },
  tools: {
    title: "Tools",
    lede: "Connect an account, then attach it to a project. Allow it before Cursor can use it.",
  },
  projects: {
    title: "Projects",
    lede: "Each folder uses one account per service. A second Notion login stays on its own project.",
  },
  status: {
    title: "Status",
    lede: "Health of SoleMCP on this Mac, recent calls, and what is stopped.",
  },
};

/** @type {{ tab: string, fingerprint: string }} */
const uiState = { tab: "home", fingerprint: "" };
const snapshot = { projects: [], connectors: [], catalog: [], calls: [] };
const registryUi = { query: "", servers: [], error: "", loading: false };
const linkState = { projectId: null, serviceId: null, lockProject: false };

function setPage(tab) {
  const meta = PAGE[tab] ?? PAGE.home;
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-lede").textContent = meta.lede;
  document.getElementById("page-actions").replaceChildren();
  document.querySelector(".content")?.classList.toggle("content-wide", tab === "tools");
}

function toast(message, kind = "ok") {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.className = `toast ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => node.classList.add("hidden"), 2800);
}

async function api(path, options = {}) {
  if (!token) throw new Error("Open this page from Terminal with solemcp ui.");
  const res = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function projectLabel(p) {
  if (p.originUrl) return p.originUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
  const path = p.paths?.[0];
  if (path) {
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] || path;
  }
  return p.id;
}

function transportLabel(c) {
  return c.transport === "http" ? "Online service" : "Local program";
}

function connectionLabel(status) {
  if (!status || status === "—") return "Not checked yet";
  if (status === "running" || status === "ok" || status === "connected") return "Ready";
  if (status === "stopped" || status === "idle") return "Idle";
  if (status === "failed") return "Failed";
  if (String(status).includes("fail")) return "Failed";
  return String(status);
}

/** Map raw doctor / activity strings to plain language. */
function humanIssue(raw) {
  const s = String(raw);
  const m = s.match(/^connector\s+(\S+):\s*upstream marked failed/i);
  if (m) return `${m[1]} is Failed and stays stopped until you reconnect it.`;
  if (/quarantine|pending/i.test(s)) return s.replace(/quarantine/gi, "approval");
  return s
    .replace(/\bconnector\b/gi, "tool")
    .replace(/\bupstream\b/gi, "connection")
    .replace(/\bdaemon\b/gi, "SoleMCP");
}

function humanActivity(raw) {
  return String(raw)
    .replace(/\bUI listening on\b/i, "Control window opened on")
    .replace(/\bquarantined\b/gi, "waiting for approval")
    .replace(/\bconnector\b/gi, "tool")
    .replace(/\bcatalog:\s*/gi, "")
    .replace(/\bPAT\b/g, "access token");
}

function fingerprint(data) {
  return JSON.stringify(data);
}

function goTab(name) {
  uiState.tab = name;
  document.querySelectorAll(".sidebar-nav button").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle("active", on);
    p.toggleAttribute("hidden", !on);
  });
  setPage(name);
  // Re-apply page actions for the active tab from last payload if present
  if (goTab._last) applyPageActions(name, goTab._last);
}

function setBadge(id, text, warn = false) {
  const node = document.getElementById(id);
  if (!node) return;
  if (!text) {
    node.classList.add("hidden");
    node.textContent = "";
    return;
  }
  node.textContent = text;
  node.classList.toggle("hidden", false);
  node.classList.toggle("warn", warn);
}

function applyPageActions(tab, data) {
  const actions = document.getElementById("page-actions");
  actions.replaceChildren();
  if (tab === "projects") {
    const btn = el(`<button type="button" class="btn primary">Link folder…</button>`);
    btn.addEventListener("click", () => document.getElementById("adopt-dialog").showModal());
    actions.append(btn);
  }
  if (tab === "tools") {
    const btn = el(`<button type="button" class="btn">Custom tool…</button>`);
    btn.addEventListener("click", () => document.getElementById("add-dialog").showModal());
    actions.append(btn);
  }
  void data;
}

function setupProgress(clients, connectors, projects) {
  const clientList = clients.clients ?? [];
  const toolList = connectors.connectors ?? [];
  const projectList = projects.projects ?? [];
  const anyApp = clientList.some((c) => c.installed && !c.blocked);
  const pending = toolList.filter((c) => c.quarantine?.state !== "approved");
  const anyApproved = toolList.some((c) => c.quarantine?.state === "approved");
  const linked = projectList.filter((p) => p.adopted).length;
  const anyAssigned = projectList.some((p) => (p.assignments ?? []).length > 0);

  const steps = [
    {
      id: "apps",
      done: anyApp,
      title: "Connect a coding app",
      body: anyApp
        ? "At least one app is connected."
        : "Connect Cursor, Claude Code, or Codex.",
      cta: "Connect an app",
      tab: "apps",
    },
    {
      id: "tools",
      done: anyApproved,
      title: "Add and allow a tool",
      body:
        pending.length > 0
          ? `${pending.length} tool${pending.length === 1 ? "" : "s"} waiting for your approval.`
          : anyApproved
            ? "You have at least one allowed tool."
            : "Add GitHub, Notion, or another tool, then allow it.",
      cta: pending.length > 0 ? "Review approvals" : "Browse tools",
      tab: "tools",
    },
    {
      id: "projects",
      done: linked > 0 && anyAssigned,
      title: "Link a project and an account",
      body:
        linked === 0
          ? "Link a folder, then connect one account for each service."
          : anyAssigned
            ? "At least one project has an account."
            : "Connect an account on your linked project.",
      cta: "Open projects",
      tab: "projects",
    },
  ];

  const next = steps.find((s) => !s.done) ?? null;
  const remaining = steps.filter((s) => !s.done).length;
  return { steps, next, remaining, pendingCount: pending.length, anyAssigned, linked };
}

async function refresh({ force = false } = {}) {
  const [status, projects, connectors, doctor, activity, clients, catalog, calls] = await Promise.all([
    api("/api/status"),
    api("/api/projects"),
    api("/api/connectors"),
    api("/api/doctor"),
    api("/api/activity"),
    api("/api/clients"),
    api("/api/catalog"),
    api("/api/calls"),
  ]);

  const payload = { status, projects, connectors, doctor, activity, clients, catalog };
  const fp = fingerprint({
    projects: projects.projects,
    connectors: connectors.connectors,
    doctor,
    activity: activity.events,
    clients: clients.clients,
    catalog: catalog.entries,
    status: status.version,
    calls: calls.calls,
    failures: status.failures,
  });

  snapshot.projects = projects.projects ?? [];
  snapshot.connectors = connectors.connectors ?? [];
  snapshot.catalog = catalog.entries ?? [];
  snapshot.calls = calls.calls ?? [];

  const list = connectors.connectors ?? [];
  const pending = list.filter((c) => c.quarantine?.state !== "approved").length;
  const progress = setupProgress(clients, connectors, projects);

  if (!doctor.ok) {
    const n = doctor.issues?.length ?? 1;
    pill.textContent = n === 1 ? "1 issue — see Status" : `${n} issues — see Status`;
    pill.className = "status-chip warn";
  } else if (pending > 0) {
    pill.textContent = `${pending} waiting for approval`;
    pill.className = "status-chip warn";
  } else {
    pill.textContent = `Running · ${list.length} tool${list.length === 1 ? "" : "s"}`;
    pill.className = "status-chip ok";
  }

  setBadge("nav-badge-home", progress.remaining > 0 ? String(progress.remaining) : "");
  setBadge("nav-badge-tools", pending > 0 ? String(pending) : "", true);
  setBadge("nav-badge-status", doctor.ok ? "" : "!", true);

  if (!force && fp === uiState.fingerprint) return;
  uiState.fingerprint = fp;
  goTab._last = payload;

  renderHome(payload, progress);
  renderApps(clients);
  renderTools(list, catalog.entries ?? []);
  renderProjects(projects.projects ?? []);
  renderStatus(doctor, activity.events ?? [], status, snapshot.calls);
  applyPageActions(uiState.tab, payload);
}

function renderHome(payload, progress) {
  const panel = document.getElementById("panel-home");
  panel.replaceChildren();

  const { steps, next, remaining } = progress;
  const doctor = payload.doctor;

  const dots = el(`<div class="progress" aria-hidden="true"></div>`);
  for (const s of steps) {
    const cls = s.done ? "done" : next?.id === s.id ? "current" : "";
    dots.append(el(`<div class="progress-dot ${cls}"></div>`));
  }
  panel.append(dots);

  if (next) {
    const focus = el(`<div class="focus-card">
      <p class="focus-kicker">Next step · ${esc(String(steps.indexOf(next) + 1))} of ${esc(String(steps.length))}</p>
      <h2>${esc(next.title)}</h2>
      <p>${esc(next.body)}</p>
      <button type="button" class="btn primary">${esc(next.cta)}</button>
    </div>`);
    focus.querySelector("button").addEventListener("click", () => goTab(next.tab));
    panel.append(focus);
  } else {
    panel.append(
      el(`<div class="focus-card">
        <p class="focus-kicker">You’re set up</p>
        <h2>SoleMCP is ready</h2>
        <p>Manage tools and projects anytime. Open Status if something looks wrong.</p>
        <button type="button" class="btn primary" data-go="tools">Browse tools</button>
      </div>`),
    );
    panel.querySelector("[data-go]").addEventListener("click", () => goTab("tools"));
  }

  const done = steps.filter((s) => s.done);
  if (done.length) {
    const group = el(`<div class="group">
      <div class="group-title">Completed</div>
      <div class="inset done-list"></div>
    </div>`);
    const inset = group.querySelector(".inset");
    for (const s of done) {
      inset.append(
        el(`<div class="row">
          <div class="row-main">
            <div class="row-title">${esc(s.title)}</div>
            <div class="row-subtitle">${esc(s.body)}</div>
          </div>
          <div class="row-trailing"><span class="pill ok">Done</span></div>
        </div>`),
      );
    }
    panel.append(group);
  }

  if (!doctor.ok) {
    const first = humanIssue(doctor.issues?.[0] ?? "Something needs attention");
    const callout = el(`<div class="callout">
      <div>
        <h3>Needs attention</h3>
        <p>${esc(first)}</p>
      </div>
      <button type="button" class="btn plain">View Status</button>
    </div>`);
    callout.querySelector("button").addEventListener("click", () => goTab("status"));
    panel.append(callout);
  }

  if (remaining === 0) {
    panel.append(
      el(`<p class="group-footer">Tip: after connecting a new tool, allow it under Tools. It shows up on the project you linked it to.</p>`),
    );
  }
}

function renderApps(guide) {
  const panel = document.getElementById("panel-apps");
  panel.replaceChildren();

  panel.append(
    el(`<div class="group">
      <div class="group-title">Before you start</div>
      <div class="inset">
        <div class="row stack">
          <div class="row-main">
            <div class="row-title">How connecting works</div>
            <div class="row-subtitle">${esc(guide.note ?? "Your coding apps talk to SoleMCP on this Mac.")}</div>
            <ol style="margin:8px 0 0;padding-left:1.15rem;color:var(--secondary);font-size:12px;line-height:1.45">
              ${(guide.afterInstall ?? []).map((s) => `<li>${esc(s)}</li>`).join("")}
            </ol>
          </div>
        </div>
      </div>
    </div>`),
  );

  const group = el(`<div class="group">
    <div class="group-title">Coding apps</div>
    <div class="inset" data-apps></div>
  </div>`);
  const inset = group.querySelector("[data-apps]");

  for (const c of guide.clients ?? []) {
    let pillHtml;
    if (c.blocked) pillHtml = `<span class="pill warn">Needs fix</span>`;
    else if (c.installed) pillHtml = `<span class="pill ok">Connected</span>`;
    else pillHtml = `<span class="pill">Not connected</span>`;

    const row = el(`<div class="row stack">
      <div class="row-main">
        <div class="row-title" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${esc(c.title)} ${pillHtml}</div>
        <div class="row-subtitle">${esc(c.summary)}${c.blocked ? ` — ${esc(c.blocked)}` : ""}</div>
      </div>
      <div class="row-trailing" data-actions></div>
      <details class="more">
        <summary>More options</summary>
        <div class="row-subtitle" style="margin-top:8px">Settings: <code>${esc(c.configPath)}</code></div>
        <div data-more style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>
        <pre class="snippet">${esc(c.snippet)}</pre>
      </details>
    </div>`);

    const actions = row.querySelector("[data-actions]");
    const more = row.querySelector("[data-more]");

    const primary = el(`<button type="button" class="btn primary">${esc(
      c.installed ? "Reconnect" : c.oneClickUrl ? "Connect" : c.installLabel || "Connect",
    )}</button>`);

    primary.addEventListener("click", async () => {
      if (c.oneClickUrl && !c.installed) {
        location.href = c.oneClickUrl;
        return;
      }
      primary.disabled = true;
      try {
        const res = await api("/api/clients/install", {
          method: "POST",
          body: JSON.stringify({ client: c.id }),
        });
        const result = res.result ?? {};
        toast(result.wrote ? `Connected ${c.title}` : result.reason ?? "Already connected");
        await refresh({ force: true });
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "bad");
        primary.disabled = false;
      }
    });
    actions.append(primary);

    if (c.oneClickWebUrl) {
      more.append(
        el(`<a class="btn" href="${esc(c.oneClickWebUrl)}" target="_blank" rel="noreferrer">Web install link</a>`),
      );
    }
    if (c.oneClickUrl) {
      const write = el(`<button type="button" class="btn">Write settings file</button>`);
      write.addEventListener("click", async () => {
        write.disabled = true;
        try {
          const res = await api("/api/clients/install", {
            method: "POST",
            body: JSON.stringify({ client: c.id }),
          });
          toast(res.result?.wrote ? "Settings updated" : res.result?.reason ?? "No change");
          await refresh({ force: true });
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), "bad");
          write.disabled = false;
        }
      });
      more.append(write);
    }
    const copy = el(`<button type="button" class="btn">Copy install command</button>`);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(c.cliCommand);
        toast("Copied");
      } catch {
        toast(c.cliCommand);
      }
    });
    more.append(copy);

    inset.append(row);
  }
  panel.append(group);
}

function serviceOf(connector) {
  if (connector?.catalogId) return connector.catalogId;
  const ids = snapshot.catalog.map((entry) => entry.id).sort((a, b) => b.length - a.length);
  for (const id of ids) {
    if (connector?.slug === id || connector?.slug?.startsWith(`${id}-`)) return id;
  }
  return null;
}

function catalogEntry(serviceId) {
  return snapshot.catalog.find((entry) => entry.id === serviceId) ?? null;
}

function connectorHeading(connector) {
  const entry = catalogEntry(serviceOf(connector));
  const service = entry?.title ?? connector.slug;
  return connector.accountLabel ? `${service} · ${connector.accountLabel}` : service;
}

function accountOnProject(project, serviceId) {
  for (const assignment of project.assignments ?? []) {
    const connector = snapshot.connectors.find((c) => c.id === assignment.connectorId);
    if (connector && serviceOf(connector) === serviceId) return connector;
  }
  return null;
}

function rememberLinkContext(ctx) {
  const form = document.getElementById("catalog-form");
  form.elements.namedItem("projectId").value = ctx?.projectId ?? "";
  form.elements.namedItem("accountLabel").value = ctx?.accountLabel ?? "";
}

function linkFields(ctx) {
  const body = {};
  if (ctx?.projectId) body.projectId = ctx.projectId;
  if (ctx?.accountLabel) body.accountLabel = ctx.accountLabel;
  return body;
}

function projectsUsing(connectorId) {
  return snapshot.projects
    .filter((project) => (project.assignments ?? []).some((assignment) => assignment.connectorId === connectorId))
    .map((project) => projectLabel(project))
    .join(", ");
}

function openLinkDialog(projectId, serviceId) {
  linkState.projectId = projectId ?? null;
  linkState.serviceId = serviceId ?? null;
  linkState.lockProject = Boolean(projectId);
  renderLink();
  document.getElementById("link-dialog").showModal();
}

function renderLink() {
  const body = document.getElementById("link-body");
  const title = document.getElementById("link-title");
  const summary = document.getElementById("link-summary");
  body.replaceChildren();
  const project = snapshot.projects.find((p) => p.id === linkState.projectId) ?? null;

  if (!project) {
    title.textContent = "Link an account";
    summary.textContent = "Choose the project this account belongs to.";
    if (!snapshot.projects.length) {
      body.append(el(`<p class="group-footer">Link a folder first. Cursor matches that folder to the account.</p>`));
      const btn = el(`<button type="button" class="btn primary">Link folder…</button>`);
      btn.addEventListener("click", () => {
        document.getElementById("link-dialog").close();
        document.getElementById("adopt-dialog").showModal();
      });
      body.append(btn);
      return;
    }
    for (const candidate of snapshot.projects) {
      const btn = el(`<button type="button" class="service-choice">
        <span class="row-main">
          <span class="row-title">${esc(projectLabel(candidate))}</span>
          <span class="row-subtitle">${esc((candidate.paths ?? []).join(", "))}</span>
        </span>
      </button>`);
      btn.addEventListener("click", () => {
        linkState.projectId = candidate.id;
        renderLink();
      });
      body.append(btn);
    }
    return;
  }

  const entry = catalogEntry(linkState.serviceId);
  if (!entry) {
    title.textContent = projectLabel(project);
    summary.textContent = "Pick a service. This project can keep one account for it.";
    if (!linkState.lockProject) {
      const back = el(`<button type="button" class="btn" style="margin-bottom:10px">All projects</button>`);
      back.addEventListener("click", () => {
        linkState.projectId = null;
        renderLink();
      });
      body.append(back);
    }
    for (const candidate of snapshot.catalog) {
      const linked = accountOnProject(project, candidate.id);
      const btn = el(`<button type="button" class="service-choice">
        <img class="catalog-logo" alt="" src="/logos/${esc(candidate.id)}.svg" />
        <span class="row-main">
          <span class="row-title">${esc(candidate.title)}</span>
          <span class="row-subtitle">${esc(linked ? (linked.accountLabel ? linked.accountLabel : "Linked") : "Not linked")}</span>
        </span>
      </button>`);
      btn.addEventListener("click", () => {
        linkState.serviceId = candidate.id;
        renderLink();
      });
      body.append(btn);
    }
    return;
  }

  title.textContent = entry.title;
  const linked = accountOnProject(project, entry.id);
  if (linked) {
    summary.textContent = "This project already has an account for this service.";
    body.append(el(`<p class="group-footer" style="margin-bottom:12px">${esc(projectLabel(project))} uses ${esc(connectorHeading(linked))}. Remove it before linking a different ${esc(entry.title)} account.</p>`));
    const remove = el(`<button type="button" class="btn">Remove from this project</button>`);
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await api("/api/unassign", {
          method: "POST",
          body: JSON.stringify({ slug: linked.slug, projectId: project.id }),
        });
        toast(`Removed ${connectorHeading(linked)}`);
        await refresh({ force: true });
        linkState.serviceId = null;
        renderLink();
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "bad");
        remove.disabled = false;
      }
    });
    body.append(remove);
  } else {
    summary.textContent = `Link one ${entry.title} account to ${projectLabel(project)}.`;
    const existing = snapshot.connectors.filter((c) => serviceOf(c) === entry.id);
    if (existing.length) {
      body.append(el(`<p class="group-footer" style="margin-bottom:8px">Use an account already on this Mac</p>`));
      for (const connector of existing) {
        const use = el(`<button type="button" class="service-choice">
          <img class="catalog-logo" alt="" src="/logos/${esc(entry.id)}.svg" />
          <span class="row-main"><span class="row-title">${esc(connectorHeading(connector))}</span></span>
        </button>`);
        use.addEventListener("click", async () => {
          use.disabled = true;
          try {
            await api("/api/assign", {
              method: "POST",
              body: JSON.stringify({ slug: connector.slug, projectId: project.id }),
            });
            document.getElementById("link-dialog").close();
            const pending = connector.quarantine?.state !== "approved";
            toast(pending ? `${connectorHeading(connector)} linked. Allow it on Tools before Cursor can use it.` : `${connectorHeading(connector)} linked`);
            await refresh({ force: true });
          } catch (err) {
            toast(err instanceof Error ? err.message : String(err), "bad");
            use.disabled = false;
          }
        });
        body.append(use);
      }
    }
    const another = existing.length > 0;
    body.append(el(`<p class="group-footer" style="margin:8px 0">${another ? `Or sign in to a different ${esc(entry.title)} account` : `Sign in to ${esc(entry.title)}`}</p>`));
    const label = el(`<label class="field">Account name
      <input id="link-account-label" placeholder="${another ? "Personal" : "Work"}" ${another ? "required" : ""} />
    </label>`);
    body.append(label);
    const verb = entry.authMode === "oauth" || entry.authMode === "github" ? "Sign in" : "Add";
    const go = el(`<button type="button" class="btn primary">${verb}</button>`);
    go.addEventListener("click", () => {
      const accountLabel = document.getElementById("link-account-label").value.trim();
      if (another && !accountLabel) {
        toast("Name this account so you can tell it apart", "bad");
        return;
      }
      document.getElementById("link-dialog").close();
      openCatalogDialog(entry, { projectId: project.id, accountLabel });
    });
    body.append(go);
  }

  const back = el(`<button type="button" class="btn" style="margin-top:10px">All services</button>`);
  back.addEventListener("click", () => {
    linkState.serviceId = null;
    renderLink();
  });
  body.append(back);
}

function projectSwitches(project) {
  const box = el(`<div class="project-switches"></div>`);
  box.append(projectSwitch(project, "readsOnly", "Reads only", "Read tools run. Writes stay hidden until you name them."));
  box.append(projectSwitch(project, "searchMode", "Search mode", "Advertise search and call instead of the full tool list."));
  return box;
}

function projectSwitch(project, key, label, hint) {
  const on = project[key] === true;
  const row = el(`<label class="switch-row">
    <span>
      <span class="row-title">${esc(label)}</span>
      <span class="row-subtitle">${esc(hint)}</span>
    </span>
    <input type="checkbox" ${on ? "checked" : ""} />
  </label>`);
  row.querySelector("input").addEventListener("change", async (ev) => {
    const input = ev.target;
    input.disabled = true;
    try {
      await api("/api/projects/settings", {
        method: "POST",
        body: JSON.stringify({ projectId: project.id, [key]: input.checked }),
      });
      toast(`${label} ${input.checked ? "on" : "off"}`);
      await refresh({ force: true });
    } catch (err) {
      input.checked = !input.checked;
      toast(err instanceof Error ? err.message : String(err), "bad");
      input.disabled = false;
    }
  });
  return row;
}

async function reconnectConnector(slug, button) {
  button.disabled = true;
  try {
    await api("/api/connectors/reconnect", {
      method: "POST",
      body: JSON.stringify({ slug }),
    });
    toast(`Reconnected ${slug}`);
    await refresh({ force: true });
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "bad");
    button.disabled = false;
  }
}

function renderProjects(projects) {
  const panel = document.getElementById("panel-projects");
  panel.replaceChildren();

  if (!projects.length) {
    panel.append(
      el(`<div class="inset empty">
        <h3>No projects yet</h3>
        <p>Link the folder your coding app has open. Each project keeps one account per service.</p>
        <div style="margin-top:12px"><button type="button" class="btn primary" id="empty-adopt">Link folder…</button></div>
      </div>`),
    );
    panel.querySelector("#empty-adopt").addEventListener("click", () => {
      document.getElementById("adopt-dialog").showModal();
    });
    return;
  }

  const group = el(`<div class="group">
    <div class="group-title">Linked folders</div>
    <div class="inset" data-list></div>
  </div>`);
  const inset = group.querySelector("[data-list]");

  for (const p of projects) {
    const paths = (p.paths ?? []).join(", ") || "—";
    const row = el(`<div class="row stack">
      <div class="row-main">
        <div class="row-title" style="display:flex;gap:8px;align-items:center">${esc(projectLabel(p))}
          <span class="pill ${p.adopted ? "ok" : ""}">${p.adopted ? "Linked" : "Not linked"}</span>
        </div>
        <div class="row-subtitle"><code>${esc(paths)}</code></div>
      </div>
      <div class="account-list" data-accounts></div>
    </div>`);
    const list = row.querySelector("[data-accounts]");
    const linked = (p.assignments ?? [])
      .map((a) => snapshot.connectors.find((c) => c.id === a.connectorId))
      .filter(Boolean);
    if (!linked.length) {
      list.append(el(`<div class="row-subtitle">No accounts yet</div>`));
    }
    for (const connector of linked) {
      const serviceId = serviceOf(connector);
      const logo = serviceId ? `/logos/${serviceId}.svg` : "";
      const pending = connector.quarantine?.state !== "approved";
      const account = el(`<div class="account-row">
        ${logo ? `<img class="catalog-logo" alt="" src="${esc(logo)}" />` : ""}
        <div class="row-main">
          <div class="row-title">${esc(connectorHeading(connector))}</div>
          <div class="row-subtitle">${pending ? "Needs approval" : "Ready"}</div>
        </div>
        <button type="button" class="btn" data-remove>Remove</button>
      </div>`);
      account.querySelector("[data-remove]").addEventListener("click", async () => {
        try {
          await api("/api/unassign", {
            method: "POST",
            body: JSON.stringify({ slug: connector.slug, projectId: p.id }),
          });
          toast(`Removed ${connectorHeading(connector)}`);
          await refresh({ force: true });
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), "bad");
        }
      });
      list.append(account);
    }
    const link = el(`<button type="button" class="btn primary">Link account</button>`);
    link.addEventListener("click", () => openLinkDialog(p.id));
    list.append(link);
    list.append(projectSwitches(p));
    inset.append(row);
  }
  panel.append(group);
}

async function startOAuthCatalogInstall(entry, ctx) {
  const res = await api("/api/catalog/install", {
    method: "POST",
    body: JSON.stringify({ id: entry.id, ...linkFields(ctx) }),
  });
  const result = res.result ?? {};
  if (result.status === "complete") {
    finishLink(entry, ctx);
    await refresh({ force: true });
    return;
  }
  if (!result.authorizeUrl || !result.sessionId) {
    throw new Error(result.error ?? "Sign-in did not start.");
  }
  window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
  toast(`Finish signing in to ${entry.title}…`);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await api(`/api/catalog/oauth/${encodeURIComponent(result.sessionId)}`);
    if (status.status === "complete") {
      finishLink(entry, ctx);
      await refresh({ force: true });
      return;
    }
    if (status.status === "error") throw new Error(status.error ?? "Sign-in failed");
  }
  throw new Error("Timed out waiting for browser sign-in");
}

function finishLink(entry, ctx) {
  const name = ctx?.accountLabel ? `${entry.title} (${ctx.accountLabel})` : entry.title;
  toast(`${name} linked. Allow it on Tools before Cursor can use it.`);
  goTab(ctx?.projectId ? "projects" : "tools");
}

async function startGithubCatalogInstall(entry, ctx) {
  const res = await api("/api/catalog/install", {
    method: "POST",
    body: JSON.stringify({ id: entry.id, action: "connect", ...linkFields(ctx) }),
  });
  const result = res.result ?? {};
  if (result.status === "complete") {
    finishLink(entry, ctx);
    await refresh({ force: true });
    return;
  }
  if (result.status !== "needs_auth") {
    throw new Error(result.message ?? result.error ?? "Could not connect GitHub");
  }
  openGithubAuthDialog(entry, result, ctx);
}

function openGithubAuthDialog(entry, needs, ctx) {
  const form = document.getElementById("catalog-form");
  delete form.dataset.registryName;
  delete form.dataset.registryVersion;
  form.elements.namedItem("id").value = entry.id;
  rememberLinkContext(ctx);
  document.getElementById("catalog-title").textContent = "Connect GitHub";
  document.getElementById("catalog-summary").textContent =
    needs.message ?? "Sign in with GitHub on this Mac, or paste an access token.";
  const fields = document.getElementById("catalog-fields");
  fields.replaceChildren();

  if (needs.ghInstalled) {
    const ghBtn = el(`<button type="button" class="btn primary">Sign in with GitHub</button>`);
    ghBtn.addEventListener("click", async () => {
      ghBtn.disabled = true;
      ghBtn.textContent = "Waiting for browser…";
      try {
        const res = await api("/api/catalog/install", {
          method: "POST",
          body: JSON.stringify({ id: entry.id, action: "gh-login", ...linkFields(ctx) }),
        });
        const result = res.result ?? {};
        if (result.status === "complete") {
          document.getElementById("catalog-dialog").close();
          finishLink(entry, ctx);
          await refresh({ force: true });
          return;
        }
        throw new Error(result.message ?? "GitHub sign-in did not finish");
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "bad");
        ghBtn.disabled = false;
        ghBtn.textContent = "Sign in with GitHub";
      }
    });
    fields.append(ghBtn);
    fields.append(
      el(`<p class="group-footer" style="margin:8px 0 12px">Opens GitHub in your browser, then saves the login in your keychain.</p>`),
    );
  } else {
    fields.append(
      el(`<p class="group-footer" style="margin-bottom:12px">For one-click sign-in, install GitHub’s command-line tool: <code>brew install gh</code></p>`),
    );
  }

  fields.append(
    el(`<p class="group-footer" style="margin-bottom:8px">Or <a href="${esc(needs.createUrl ?? "https://github.com/settings/tokens")}" target="_blank" rel="noreferrer">create an access token</a> and paste it below.</p>`),
  );
  fields.append(
    el(`<label class="field">GitHub access token
      <input name="secret:GITHUB_OAUTH_TOKEN" type="password" autocomplete="off" placeholder="ghp_… or github_pat_…" />
    </label>`),
  );

  document.getElementById("catalog-dialog").showModal();
}

function openCatalogDialog(entry, ctx) {
  rememberLinkContext(ctx);
  if (entry.authMode === "oauth") {
    startOAuthCatalogInstall(entry, ctx).catch((err) => toast(err instanceof Error ? err.message : String(err), "bad"));
    return;
  }
  if (entry.authMode === "github") {
    startGithubCatalogInstall(entry, ctx).catch((err) => toast(err instanceof Error ? err.message : String(err), "bad"));
    return;
  }
  if (entry.authMode === "none" && !entry.needsPath) {
    api("/api/catalog/install", {
      method: "POST",
      body: JSON.stringify({ id: entry.id, ...linkFields(ctx) }),
    })
      .then(async () => {
        finishLink(entry, ctx);
        await refresh({ force: true });
      })
      .catch((err) => toast(err instanceof Error ? err.message : String(err), "bad"));
    return;
  }

  const form = document.getElementById("catalog-form");
  delete form.dataset.registryName;
  delete form.dataset.registryVersion;
  form.elements.namedItem("id").value = entry.id;
  rememberLinkContext(ctx);
  document.getElementById("catalog-title").textContent = `Add ${entry.title}`;
  document.getElementById("catalog-summary").textContent = entry.summary;
  const fields = document.getElementById("catalog-fields");
  fields.replaceChildren();

  if (entry.needsPath) {
    fields.append(
      el(`<label class="field">${esc(entry.pathLabel ?? "Folder")}
        <input name="path" required placeholder="${esc(entry.pathPlaceholder ?? "")}" />
      </label>`),
    );
  }
  for (const s of entry.secrets ?? []) {
    const hint = s.present
      ? "Already saved — leave blank to keep it, or paste a new value."
      : s.help;
    fields.append(
      el(`<label class="field">${esc(s.label)}
        <input name="secret:${esc(s.ref)}" type="password" autocomplete="off" ${s.present ? "" : "required"} placeholder="${s.present ? "(saved)" : ""}" />
        <span class="group-footer">${esc(hint)}</span>
      </label>`),
    );
  }
  if (!entry.needsPath && !(entry.secrets ?? []).length) {
    fields.append(el(`<p class="group-footer">No sign-in needed. You’ll still need to allow this tool before it can run.</p>`));
  }
  document.getElementById("catalog-dialog").showModal();
}

function renderTools(connectors, catalogEntries = []) {
  const panel = document.getElementById("panel-tools");
  panel.replaceChildren();

  const pending = [];
  for (const c of connectors) {
    const connectorPending = c.quarantine?.state !== "approved";
    const pendingTools = Object.entries(c.quarantine?.tools ?? {}).filter(([, t]) => t.state !== "approved");
    if (connectorPending || pendingTools.length) pending.push({ c, connectorPending, pendingTools });
  }

  if (pending.length) {
    const group = el(`<div class="group">
      <div class="group-title">Needs approval</div>
      <div class="inset" data-review></div>
      <p class="group-footer">New tools stay off until you allow them.</p>
    </div>`);
    const inset = group.querySelector("[data-review]");
    for (const { c, connectorPending, pendingTools } of pending) {
      const row = el(`<div class="row">
        <div class="row-main">
          <div class="row-title">${esc(connectorHeading(c))}</div>
          <div class="row-subtitle">${esc(transportLabel(c))} · ${esc(connectionLabel(c.upstreamStatus))}</div>
        </div>
        <div class="row-trailing" data-act></div>
      </div>`);
      const act = row.querySelector("[data-act]");
      if (connectorPending) {
        const btn = el(`<button type="button" class="btn primary">Allow</button>`);
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await api("/api/approve/connector", {
              method: "POST",
              body: JSON.stringify({ slug: c.slug }),
            });
            toast(`${c.slug} is allowed`);
            await refresh({ force: true });
          } catch (err) {
            toast(err instanceof Error ? err.message : String(err), "bad");
            btn.disabled = false;
          }
        });
        act.append(btn);
      }
      for (const [tool] of pendingTools) {
        const btn = el(`<button type="button" class="btn">Allow ${esc(tool)}</button>`);
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await api("/api/approve/tool", {
              method: "POST",
              body: JSON.stringify({ slug: c.slug, tool }),
            });
            toast(`Allowed ${tool}`);
            await refresh({ force: true });
          } catch (err) {
            toast(err instanceof Error ? err.message : String(err), "bad");
            btn.disabled = false;
          }
        });
        act.append(btn);
      }
      inset.append(row);
    }
    panel.append(group);
  }

  const catalogGroup = el(`<div class="group">
    <div class="group-title">Ready-made</div>
    <div class="registry-search" data-registry></div>
    <div class="catalog-grid" data-catalog></div>
    <p class="group-footer">Each project can use one account per service. Sign-in details stay in your Mac keychain. Registry results install through the same approval step.</p>
  </div>`);
  catalogGroup.querySelector("[data-registry]").append(renderRegistrySearch());
  const catalogGrid = catalogGroup.querySelector("[data-catalog]");
  for (const entry of catalogEntries) {
    const count = entry.accountCount ?? (entry.installed ? 1 : 0);
    const countLabel = count === 0 ? "No account yet" : count === 1 ? "1 account" : `${count} accounts`;
    const card = el(`<article class="catalog-card">
      <img class="catalog-logo" alt="" src="/logos/${esc(entry.id)}.svg" />
      <div class="catalog-name">${esc(entry.title)}</div>
      <p class="catalog-summary">${esc(entry.summary)}</p>
      <div class="catalog-meta">${esc(countLabel)}</div>
      <div class="catalog-action"></div>
    </article>`);
    const action = card.querySelector(".catalog-action");
    const label = count > 0 ? "Add account" : entry.authMode === "oauth" || entry.authMode === "github" ? "Connect" : "Add";
    const btn = el(`<button type="button" class="btn primary">${label}</button>`);
    btn.addEventListener("click", () => openLinkDialog(null, entry.id));
    action.append(btn);
    catalogGrid.append(card);
  }
  panel.append(catalogGroup);

  const allowed = connectors.filter((c) => c.quarantine?.state === "approved");
  const group = el(`<div class="group">
    <div class="group-title">Allowed on this Mac</div>
    <div class="inset" data-allowed></div>
  </div>`);
  const inset = group.querySelector("[data-allowed]");
  if (!allowed.length) {
    inset.append(
      el(`<div class="empty" style="padding:18px 14px"><p>Nothing allowed yet. Add a tool above, then tap Allow.</p></div>`),
    );
  } else {
    for (const c of allowed) {
      inset.append(
        el(`<div class="row">
          <div class="row-main">
            <div class="row-title">${esc(connectorHeading(c))}</div>
            <div class="row-subtitle">${esc(projectsUsing(c.id) || "Not linked to a project")} · ${esc(connectionLabel(c.upstreamStatus))}</div>
          </div>
          <div class="row-trailing" data-trail></div>
        </div>`),
      );
      const trail = inset.lastElementChild.querySelector("[data-trail]");
      if (c.upstreamStatus === "failed") {
        trail.append(el(`<span class="pill warn">Failed</span>`));
        const again = el(`<button type="button" class="btn">Reconnect</button>`);
        again.addEventListener("click", () => reconnectConnector(c.slug, again));
        trail.append(again);
      } else {
        trail.append(el(`<span class="pill ok">Allowed</span>`));
      }
    }
  }
  panel.append(group);
}

function renderRegistrySearch() {
  const wrap = el(`<div class="registry-box"></div>`);
  const field = el(`<label class="field">Search the MCP registry
    <input type="search" placeholder="filesystem, github, sqlite…" value="${esc(registryUi.query)}" />
  </label>`);
  const input = field.querySelector("input");
  const go = el(`<button type="button" class="btn">Search</button>`);
  const row = el(`<div class="registry-row"></div>`);
  row.append(field, go);
  wrap.append(row);
  go.addEventListener("click", () => runRegistrySearch(input, go));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      runRegistrySearch(input, go);
    }
  });
  if (registryUi.loading) {
    wrap.append(el(`<p class="group-footer">Searching the official registry…</p>`));
  }
  if (registryUi.error) {
    wrap.append(el(`<p class="err">${esc(registryUi.error)}</p>`));
  }
  if (registryUi.servers.length) {
    const list = el(`<div class="inset registry-results"></div>`);
    for (const server of registryUi.servers) {
      const item = el(`<div class="row">
        <div class="row-main">
          <div class="row-title">${esc(server.title || server.name)}</div>
          <div class="row-subtitle">${esc(server.description || server.name)}</div>
        </div>
        <div class="row-trailing"><button type="button" class="btn primary">Install</button></div>
      </div>`);
      item.querySelector("button").addEventListener("click", () => installRegistryServer(server));
      list.append(item);
    }
    wrap.append(list);
  }
  return wrap;
}

async function runRegistrySearch(input, button) {
  registryUi.query = input.value.trim();
  registryUi.loading = true;
  registryUi.error = "";
  button.disabled = true;
  renderTools(snapshot.connectors, snapshot.catalog);
  try {
    const result = await api(`/api/registry/search?q=${encodeURIComponent(registryUi.query)}`);
    registryUi.servers = result.servers ?? [];
    registryUi.error = "";
    if (!registryUi.servers.length) registryUi.error = "No registry servers matched that search.";
  } catch (err) {
    registryUi.servers = [];
    registryUi.error = err instanceof Error ? err.message : "The MCP registry is unreachable. Ready-made tools still work.";
  } finally {
    registryUi.loading = false;
    button.disabled = false;
    renderTools(snapshot.connectors, snapshot.catalog);
  }
}

async function installRegistryServer(server) {
  try {
    const res = await api("/api/registry/install", {
      method: "POST",
      body: JSON.stringify({ name: server.name, version: server.version }),
    });
    const result = res.result ?? {};
    if (result.status === "needs_env") {
      openRegistryEnvDialog(server, result);
      return;
    }
    toast(`${result.title || server.title || server.name} added. Allow it on Tools before it can run.`);
    registryUi.servers = [];
    registryUi.query = "";
    await refresh({ force: true });
  } catch (err) {
    registryUi.error = err instanceof Error ? err.message : String(err);
    toast(registryUi.error, "bad");
    renderTools(snapshot.connectors, snapshot.catalog);
  }
}

function openRegistryEnvDialog(server, plan) {
  const form = document.getElementById("catalog-form");
  form.elements.namedItem("id").value = "";
  document.getElementById("catalog-title").textContent = plan.title || server.title || server.name;
  document.getElementById("catalog-summary").textContent =
    "These values are saved in your keychain. The server stays quarantined until you allow it.";
  const fields = document.getElementById("catalog-fields");
  fields.replaceChildren();
  for (const variable of plan.variables ?? []) {
    if (!variable.required && !variable.secret) continue;
    fields.append(el(`<label class="field">${esc(variable.name)}
      <input name="secret:${esc(variable.name)}" type="${variable.secret ? "password" : "text"}" autocomplete="off" ${variable.required || variable.secret ? "required" : ""} />
      <span class="group-footer">${esc(variable.description || "")}</span>
    </label>`));
  }
  form.dataset.registryName = server.name;
  form.dataset.registryVersion = server.version || "";
  document.getElementById("catalog-dialog").showModal();
}

function renderStatus(doctor, events, status, calls = []) {
  const panel = document.getElementById("panel-status");
  panel.replaceChildren();

  if (doctor.ok) {
    panel.append(
      el(`<div class="group">
        <div class="group-title">Health</div>
        <div class="inset">
          <div class="row">
            <div class="row-main">
              <div class="row-title">System check</div>
              <div class="row-subtitle">SoleMCP ${esc(status.version ?? "")} is running normally.</div>
            </div>
            <div class="row-trailing"><span class="pill ok">Healthy</span></div>
          </div>
        </div>
      </div>`),
    );
  } else {
    const group = el(`<div class="group">
      <div class="group-title">Health</div>
      <div class="inset" data-issues></div>
    </div>`);
    const inset = group.querySelector("[data-issues]");
    for (const issue of doctor.issues ?? []) {
      inset.append(
        el(`<div class="row">
          <div class="row-main">
            <div class="row-title">Needs attention</div>
            <div class="row-subtitle">${esc(humanIssue(issue))}</div>
          </div>
          <div class="row-trailing"><span class="pill warn">Issue</span></div>
        </div>`),
      );
    }
    panel.append(group);
  }

  const hist = el(`<div class="group">
    <div class="group-title">Recent activity</div>
    <div class="inset"></div>
    <p class="group-footer">Secrets are never shown.</p>
  </div>`);
  const inset = hist.querySelector(".inset");
  if (!events.length) {
    inset.append(el(`<div class="empty" style="padding:18px 14px"><p>Nothing yet.</p></div>`));
  } else {
    const ul = el(`<ul class="activity"></ul>`);
    for (const e of events) {
      const when = e.at
        ? new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "—";
      ul.append(el(`<li><time>${esc(when)}</time><span>${esc(humanActivity(e.message))}</span></li>`));
    }
    inset.append(ul);
  }
  panel.append(hist);

  const failed = status.failures ?? [];
  if (failed.length) {
    const group = el(`<div class="group">
      <div class="group-title">Stopped</div>
      <div class="inset" data-failed></div>
      <p class="group-footer">Failed stays down until you reconnect. It does not start itself.</p>
    </div>`);
    const inset = group.querySelector("[data-failed]");
    for (const item of failed) {
      const row = el(`<div class="row">
        <div class="row-main">
          <div class="row-title">${esc(item.slug)}</div>
          <div class="row-subtitle">Failed</div>
        </div>
        <div class="row-trailing"></div>
      </div>`);
      const again = el(`<button type="button" class="btn primary">Reconnect</button>`);
      again.addEventListener("click", () => reconnectConnector(item.slug, again));
      row.querySelector(".row-trailing").append(again);
      inset.append(row);
    }
    panel.append(group);
  }

  const callsGroup = el(`<div class="group">
    <div class="group-title">Recent calls</div>
    <div class="inset" data-calls></div>
    <p class="group-footer">Project, tool, outcome, and duration. Arguments are not stored.</p>
  </div>`);
  const callsInset = callsGroup.querySelector("[data-calls]");
  if (!calls.length) {
    callsInset.append(el(`<div class="empty" style="padding:18px 14px"><p>No calls yet.</p></div>`));
  } else {
    for (const call of calls) {
      const when = call.at
        ? new Date(call.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "—";
      const project = snapshot.projects.find((p) => p.id === call.projectId);
      const projectName = project ? projectLabel(project) : call.projectId || "—";
      callsInset.append(el(`<div class="row">
        <div class="row-main">
          <div class="row-title">${esc(call.tool)}</div>
          <div class="row-subtitle">${esc(projectName)} · ${esc(when)} · ${esc(String(call.durationMs))} ms</div>
        </div>
        <div class="row-trailing"><span class="pill ${call.ok ? "ok" : "warn"}">${call.ok ? "Ok" : "Fail"}</span></div>
      </div>`));
    }
  }
  panel.append(callsGroup);
}

document.querySelectorAll(".sidebar-nav button").forEach((btn) => {
  btn.addEventListener("click", () => goTab(btn.dataset.tab));
});

const form = document.getElementById("add-form");
const transport = form.elements.namedItem("transport");
transport.addEventListener("change", () => {
  const http = transport.value === "http";
  form.querySelectorAll(".http-only").forEach((n) => n.classList.toggle("hidden", !http));
  form.querySelectorAll(".stdio-only").forEach((n) => n.classList.toggle("hidden", http));
});

form.addEventListener("submit", async (ev) => {
  const submitter = ev.submitter;
  if (!submitter || submitter.value !== "ok") return;
  ev.preventDefault();
  const fd = new FormData(form);
  const body = {
    slug: String(fd.get("slug") ?? ""),
    transport: String(fd.get("transport") ?? "stdio"),
  };
  if (body.transport === "stdio") {
    body.argv = String(fd.get("argv") ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!body.argv.length) {
      toast("Enter the command that starts this tool", "bad");
      return;
    }
  } else {
    body.url = String(fd.get("url") ?? "");
    body.sseFallback = true;
    if (!body.url) {
      toast("Enter the service address", "bad");
      return;
    }
  }
  try {
    await api("/api/connectors", { method: "POST", body: JSON.stringify(body) });
    document.getElementById("add-dialog").close();
    form.reset();
    toast("Tool added — allow it when ready");
    await refresh({ force: true });
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "bad");
  }
});

const adoptForm = document.getElementById("adopt-form");
adoptForm.addEventListener("submit", async (ev) => {
  const submitter = ev.submitter;
  if (!submitter || submitter.value !== "ok") return;
  ev.preventDefault();
  const path = String(new FormData(adoptForm).get("path") ?? "").trim();
  if (!path) {
    toast("Enter a folder path", "bad");
    return;
  }
  try {
    await api("/api/adopt", { method: "POST", body: JSON.stringify({ path }) });
    document.getElementById("adopt-dialog").close();
    adoptForm.reset();
    toast("Project folder linked");
    await refresh({ force: true });
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "bad");
  }
});

const linkForm = document.getElementById("link-form");
linkForm.addEventListener("submit", (ev) => {
  if (ev.submitter?.value === "cancel") return;
  ev.preventDefault();
});

const catalogForm = document.getElementById("catalog-form");
catalogForm.addEventListener("submit", async (ev) => {
  const submitter = ev.submitter;
  if (!submitter || submitter.value !== "ok") return;
  ev.preventDefault();
  const fd = new FormData(catalogForm);
  const id = String(fd.get("id") ?? "");
  const secrets = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("secret:") && String(value).trim()) {
      secrets[key.slice("secret:".length)] = String(value);
    }
  }
  const registryName = catalogForm.dataset.registryName || "";
  if (registryName) {
    try {
      const res = await api("/api/registry/install", {
        method: "POST",
        body: JSON.stringify({
          name: registryName,
          version: catalogForm.dataset.registryVersion || undefined,
          secrets,
          projectId: String(fd.get("projectId") ?? "").trim() || undefined,
          accountLabel: String(fd.get("accountLabel") ?? "").trim() || undefined,
        }),
      });
      document.getElementById("catalog-dialog").close();
      catalogForm.reset();
      delete catalogForm.dataset.registryName;
      delete catalogForm.dataset.registryVersion;
      const result = res.result ?? {};
      if (result.status === "needs_env") {
        toast("A required value is still missing", "bad");
        return;
      }
      toast(`${result.title || registryName} added. Allow it on Tools before it can run.`);
      await refresh({ force: true });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    }
    return;
  }
  const body = { id, secrets };
  const path = String(fd.get("path") ?? "").trim();
  const projectId = String(fd.get("projectId") ?? "").trim();
  const accountLabel = String(fd.get("accountLabel") ?? "").trim();
  if (path) body.path = path;
  if (projectId) body.projectId = projectId;
  if (accountLabel) body.accountLabel = accountLabel;
  try {
    await api("/api/catalog/install", { method: "POST", body: JSON.stringify(body) });
    document.getElementById("catalog-dialog").close();
    catalogForm.reset();
    const entry = snapshot.catalog.find((item) => item.id === id) ?? { title: id };
    finishLink(entry, { projectId, accountLabel });
    await refresh({ force: true });
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "bad");
  }
});

setPage("home");

try {
  if (!token) throw new Error("Open this page from Terminal with solemcp ui.");
  await refresh({ force: true });
  setInterval(() => {
    refresh().catch(() => undefined);
  }, 8000);
} catch (err) {
  pill.textContent = "Not signed in";
  pill.className = "status-chip bad";
  document.getElementById("panel-home").replaceChildren(
    el(`<div class="err">${esc(err instanceof Error ? err.message : String(err))}</div>`),
  );
}
