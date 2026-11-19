// dsh-swarm pane (browser half). Plain JS on the app's own React, no build step.
// Modelled on Antigravity's Swarm UI: a right-sidebar page with Board, Members and Graph tabs,
// a header button that opens it, and auto-open when a swarm starts. It follows the coordinator or any of its workers.
// Reads only session data the app already keeps (subagentCatalog, tokenUsage, contextPressure, modelSelection,
// agentPreset, subagentTiming, turnOutline, summary timestamps). Writes nothing.
window.__ModuleLoader__.load({
  id: "dsh-swarm",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;

    const TAB_ID = "dsh-swarm/pane";
    const KIND = "swarm";
    const CHAT_PREFIX = "dsh-resource://subagentchat/session/";
    // OpenCode Zen list prices, deepseek-v4.1-flash, USD per 1M tokens (checked 2026-11-17). Go itself is a flat plan.
    const PRICE = { input: 0.30, cacheRead: 0.006, cacheWrite: 0.30, output: 1.20 };
    const REFRESH_MS = 4000;
    // A running member with no logged event, or one tool call open, for this long is shown as stalled. The host's
    // swarmVitals projection supplies the times (lib/index.js); the LLM stream itself is cut off after 300 s idle.
    const STALL_MS = 5 * 60 * 1000;
    const COORD = "coordinator";

    // ------------------------------------------------------------------ styles
    const CSS = `
.dsw-swarm{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px}
.dsw-swarm *{box-sizing:border-box}
.dsw-top{flex:none;padding:12px 16px 0}
.dsw-titlerow{display:flex;align-items:center;gap:10px}
.dsw-title{flex:1;min-width:0;margin:0;font-size:15px;line-height:22px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsw-live{flex:none;display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsw-meter{display:flex;align-items:center;gap:8px;margin:6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums;flex-wrap:wrap}
.dsw-meter b{color:var(--dsw-alias-label-secondary);font-weight:500}
.dsw-bar{width:64px;height:4px;border-radius:2px;background:var(--dsw-alias-fill-l1,rgba(127,127,127,.18));overflow:hidden}
.dsw-bar>i{display:block;height:100%;background:var(--dsw-alias-state-success-primary)}
.dsw-bar>i[data-s=warn]{background:var(--dsw-alias-state-warn-primary)}
.dsw-bar>i[data-s=fail]{background:var(--dsw-alias-state-error-primary)}
.dsw-tabs{display:flex;gap:18px;margin:10px 0 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsw-tabs button{padding:6px 0 8px;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;cursor:pointer}
.dsw-tabs button .c{margin-left:5px;font-variant-numeric:tabular-nums}
.dsw-tabs button[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary)}
.dsw-body{flex:1;min-height:0;overflow-y:auto;padding:10px 16px 24px}
.dsw-tools{display:flex;gap:8px;margin:0 0 8px}
.dsw-search{flex:1;min-width:0;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-fill-l1,transparent);color:inherit;font:inherit;font-size:13px}
.dsw-select{flex:none;max-width:42%;height:30px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:12px}
.dsw-search:focus-visible,.dsw-select:focus-visible,.dsw-tabs button:focus-visible,.dsw-mem:focus-visible,.dsw-hbtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,currentColor);outline-offset:1px}
.dsw-dot{flex:none;display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.dsw-dot[data-s=working]{background:var(--dsw-alias-state-business-primary);animation:dsw-pulse 1.4s ease-in-out infinite}
.dsw-dot[data-s=live]{background:var(--dsw-alias-state-success-primary)}
.dsw-dot[data-s=pass],.dsw-dot[data-s=done]{background:var(--dsw-alias-state-success-primary)}
.dsw-dot[data-s=fail]{background:var(--dsw-alias-state-error-primary)}
.dsw-dot[data-s=stopped]{background:var(--dsw-alias-state-warn-primary)}
.dsw-dot[data-s=stalled]{background:var(--dsw-alias-state-warn-primary);animation:dsw-pulse 1.4s ease-in-out infinite}
@keyframes dsw-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.dsw-dot[data-s=working],.dsw-dot[data-s=stalled]{animation:none}}
.dsw-word{font-size:12px;font-weight:500}
.dsw-word[data-s=working]{color:var(--dsw-alias-state-business-primary)}
.dsw-word[data-s=pass],.dsw-word[data-s=done]{color:var(--dsw-alias-state-success-primary)}
.dsw-word[data-s=fail]{color:var(--dsw-alias-state-error-primary)}
.dsw-word[data-s=stopped],.dsw-word[data-s=stalled]{color:var(--dsw-alias-state-warn-primary)}
.dsw-av{position:relative;flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:8px;color:#fff;font-size:12px;font-weight:700;letter-spacing:.02em}
.dsw-av .dsw-dot{position:absolute;right:-2px;bottom:-2px;width:9px;height:9px;box-shadow:0 0 0 2px var(--dsw-alias-bg-base,#1a1a1a)}
.dsw-post{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsw-post .main{flex:1;min-width:0}
.dsw-post .hd{display:flex;align-items:baseline;gap:6px}
.dsw-post .who{font-weight:600}
.dsw-post .to{flex:1;min-width:0;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsw-post .no{flex:none;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,monospace);font-size:11px}
.dsw-post .txt{margin:3px 0 0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.dsw-tag{display:inline-block;margin-right:6px;padding:0 6px;border-radius:var(--dsw-radius-sm);font-size:11px;font-weight:700;line-height:17px}
.dsw-tag[data-s=pass]{color:var(--dsw-alias-state-success-primary);border:1px solid currentColor}
.dsw-tag[data-s=fail]{color:var(--dsw-alias-state-error-primary);border:1px solid currentColor}
.dsw-group{margin:14px 0 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.dsw-group button{padding:0;border:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer}
.dsw-mem{display:flex;gap:10px;width:100%;padding:10px 8px;margin:0 -8px;width:calc(100% + 16px);border:0;border-radius:var(--dsw-radius-md);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsw-mem[data-static]{cursor:default}
@media (hover:hover){.dsw-mem:not([data-static]):hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dsw-mem .main{flex:1;min-width:0}
.dsw-mem .hd{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.dsw-mem .who{font-weight:600}
.dsw-mem .to{color:var(--dsw-alias-label-tertiary)}
.dsw-mem .model{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,monospace);font-size:11px;white-space:nowrap}
.dsw-mem .desc{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsw-mem .last{margin-top:2px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsw-mem .meta{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.dsw-mem .stall{margin-top:2px;color:var(--dsw-alias-state-warn-primary);font-size:12px;font-weight:500}
.dsw-mem .err{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsw-mem .err[data-hot]{color:var(--dsw-alias-state-error-primary)}
.dsw-tbtn{flex:none;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.dsw-tbtn[aria-pressed=true]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4,currentColor)}
.dsw-tbtn:focus-visible,.dsw-replay input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,currentColor);outline-offset:1px}
.dsw-replay{display:flex;align-items:center;gap:6px;margin:0 0 6px}
.dsw-replay .dsw-tbtn{width:30px;padding:0}
.dsw-replay .dsw-tbtn.live{width:auto;padding:0 10px}
.dsw-replay input[type=range]{flex:1;min-width:60px}
.dsw-graph svg{display:block;width:100%;max-width:560px;height:auto;margin:0 auto}
.dsw-graph .graph-role{fill:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.dsw-graph .edge{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-linecap:round;opacity:.55}
.dsw-graph svg[data-dense] .edge{opacity:.4}
.dsw-graph svg .edge[data-hot]{stroke:var(--dsw-alias-state-business-primary);opacity:1}
.dsw-graph .node rect{fill:var(--dsw-alias-bg-layer-1,#222);stroke:var(--dsw-alias-border-l3,#555)}
.dsw-graph .node[data-hot] rect{stroke:var(--dsw-alias-state-business-primary);stroke-width:2}
.dsw-graph .node[data-coord] rect{stroke-dasharray:3 3}
.dsw-graph .node-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;line-height:16px}
.dsw-graph .node[data-s=stopped] .node-name{text-decoration:line-through;color:var(--dsw-alias-label-tertiary)}
.dsw-graph .node-meta{display:flex;align-items:center;justify-content:space-between;gap:3px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}
.dsw-graph .node-count{padding:0 4px;border-radius:4px;background:var(--dsw-alias-fill-l1,rgba(127,127,127,.18));font-variant-numeric:tabular-nums}
.dsw-graph .replay-post{min-width:0;overflow-wrap:anywhere}
.dsw-legend{margin:0 0 8px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsw-empty{padding:16px 0;color:var(--dsw-alias-label-secondary)}
.dsw-note{margin:12px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsw-hbtn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:0;border-radius:var(--dsw-radius-md);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
@media (hover:hover){.dsw-hbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
`;
    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="dsh-swarm"]') === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-swarm";
      tag.dataset.pluginCss = "dsh-swarm";
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ------------------------------------------------------------------ data
    function catalogEntries(raw) {
      const list = Array.isArray(raw) ? raw : raw && raw.head && Array.isArray(raw.head.values) ? raw.head.values : [];
      return list.map((e) => ({
        id: e.id || e.childId,
        name: e.name || e.id || e.childId,
        label: e.label || "",
        mode: e.mode || "unknown",
        createdAt: e.childCreatedAt || e.createdAt || 0,
      })).filter((e) => e.id);
    }
    function totals(usage) {
      const t = usage && (usage.totals || usage);
      if (!t || typeof t.outputTokens !== "number") return null;
      return {
        input: t.uncachedInputTokens || 0, cacheRead: t.cacheReadTokens || 0,
        cacheWrite: t.cacheWriteTokens || 0, output: t.outputTokens || 0,
      };
    }
    function costOf(t) {
      if (!t) return 0;
      return (t.input * PRICE.input + t.cacheRead * PRICE.cacheRead + t.cacheWrite * PRICE.cacheWrite + t.output * PRICE.output) / 1e6;
    }
    function tokensOf(t) { return t ? t.input + t.cacheRead + t.cacheWrite + t.output : 0; }
    function verdictOf(text) {
      // The verifier puts PASS or FAIL on its first line ("PASS", "**FAIL**", "VERDICT: PASS").
      const first = (text || "").trim().split(/\n/)[0].slice(0, 80);
      const m = /\b(PASS|FAIL)\b/.exec(first);
      return m ? m[1] : null;
    }
    function catalogOf(projections, id) {
      const p = projections[id];
      return catalogEntries(p && p.values && p.values.subagentCatalog);
    }
    // The pane follows the conversation on screen: a worker's chat resolves to its coordinator.
    function resolveRoot(sessionId, projections, byId) {
      if (catalogOf(projections, sessionId).length) return sessionId;
      const s = byId[sessionId];
      const parent = s && (s.parentId || s.parentSessionId);
      return parent || sessionId;
    }
    // The host's swarmVitals view: { lastEventAt, lastError, openSince, openTool, waiting } (lib/index.js), or null.
    function vitalsOf(raw) {
      return raw && typeof raw === "object" && typeof raw.lastEventAt === "number" ? raw : null;
    }
    // Stall rule: a running member that has logged nothing for STALL_MS, or whose oldest open tool call is older than
    // STALL_MS. A member blocked on purpose (wait_agent, ask_user_question: vit.waiting) is not stalled. activeSince
    // (subagentTiming.active.since) keeps a standing member that was just woken from reading as silent for hours.
    function stallOf(vit, running, now, activeSince) {
      if (!vit || !running || vit.waiting) return null;
      if (vit.openSince && now - vit.openSince > STALL_MS) return { kind: "tool", tool: vit.openTool || "tool", ms: now - vit.openSince };
      const last = Math.max(vit.lastEventAt || 0, activeSince || 0);
      if (last && now - last > STALL_MS) return { kind: "silent", tool: "", ms: now - last };
      return null;
    }
    function agent(id, vals, summary, entry, now) {
      const pv = (summary && summary.projectionValues) || {};
      const usage = totals(vals.tokenUsage || pv.tokenUsage);
      const sel = (vals.modelSelection && vals.modelSelection.lastUsed) || null;
      const preset = vals.agentPreset || pv.agentPreset || "";
      const timing = vals.subagentTiming || pv.subagentTiming || null;
      // The browser receives turnOutline as the plain entry array; the host cache stores { turns, draft }.
      const to = vals.turnOutline;
      const turns = Array.isArray(to) ? to : (to && Array.isArray(to.turns) ? to.turns : []);
      const name = entry ? entry.name : COORD;
      const role = /verifier/i.test(preset) || /^verifier/i.test(name) ? "verifier"
        : /monitor/i.test(preset) || /^monitor/i.test(name) ? "monitor" : entry ? "worker" : COORD;
      const reports = turns.map((t) => t.response || "").filter(Boolean);
      const last = reports.length ? reports[reports.length - 1] : "";
      const running = summary ? summary.running === true : false;
      const completed = !!(timing && timing.lastTurnCompleted);
      const verdict = role === "verifier" ? verdictOf(last) : null;
      const vitals = vitalsOf(vals.swarmVitals);
      const stall = entry ? stallOf(vitals, running, now, timing && timing.active ? timing.active.since : 0) : null;
      let status = "starting";
      if (stall) status = "stalled";
      else if (running) status = "working";
      else if (verdict === "FAIL") status = "fail";
      else if (verdict === "PASS") status = "pass";
      else if (completed || (!entry && (reports.length || usage))) status = "done";
      else if (summary && entry) status = "stopped";
      const ms = timing && entry ? (timing.settledMs || 0) + (timing.active ? Math.max(0, Date.now() - timing.active.since) : 0) : null;
      return {
        id, name, role, entry, usage, cost: costOf(usage), tokens: tokensOf(usage),
        model: sel ? sel.model : "", effort: sel ? sel.reasoningEffort : "",
        ctx: vals.contextPressure || null, turns, last, running, verdict, status, ms,
        stall, lastError: vitals && vitals.lastError ? vitals.lastError : null,
        createdAt: entry ? entry.createdAt : 0, updatedAt: (summary && summary.updatedAt) || 0,
        label: entry ? entry.label : "",
      };
    }
    // Board posts. DeepSeek keeps no shared board, so the posts are rebuilt from what each agent recorded:
    // the brief (catalog label, at the child's start), follow-ups the coordinator sent (later turns), each report
    // (turn responses), and the coordinator's final SWARM DONE answer. Only briefs carry an exact time (the child's
    // start). Reports are ordered by start + the agent's active working time; the summary's updatedAt is not a
    // last-activity time (observed in DSH session logs), so it is not used.
    function buildPosts(lead, members) {
      const posts = [];
      for (const a of members) {
        const start = a.createdAt || 0;
        const end = start + (a.ms || 0);
        posts.push({ from: COORD, to: [a.name], text: a.label || "(brief)", at: start, exact: !!start, kind: "brief", member: a.name });
        const n = a.turns.length;
        a.turns.forEach((t, i) => {
          const at = n <= 1 ? end : start + ((end - start) * (i + 1)) / n;
          // A follow-up sits just before the report it caused; with no time span the stable sort keeps this order.
          if (i > 0) posts.push({ from: COORD, to: [a.name], text: "Follow-up sent (fix request or question).", at: at - (end - start) / (2 * n), exact: false, kind: "followup", member: a.name });
          if (!t.response) return;
          posts.push({
            from: a.name, to: [COORD], text: t.response, at, exact: false, kind: "report", member: a.name,
            verdict: a.role === "verifier" ? verdictOf(t.response) : null,
          });
        });
      }
      if (lead.last && /^\W*SWARM DONE/i.test(lead.last)) {
        posts.push({ from: COORD, to: ["you"], text: lead.last.replace(/^\W*SWARM DONE\W*/i, ""), at: Infinity, exact: false, kind: "done", member: COORD });
      }
      posts.sort((x, y) => x.at - y.at);
      posts.forEach((p, i) => { p.no = i + 1; });
      return posts;
    }
    // The real board: the host's swarmBoard projection lists every post a session received, with its exact time.
    // Merging the coordinator's and every member's lists gives the whole board. Returns null when no session has it
    // (an older app run without dsh-swarm 0.3), so the caller falls back to buildPosts.
    function realPosts(rootId, lead, members, projections) {
      const boards = [[rootId, COORD]].concat(members.map((a) => [a.id, a.name]))
        .map(([id, name]) => [name, projections[id] && projections[id].values && projections[id].values.swarmBoard]);
      if (!boards.some(([, b]) => Array.isArray(b))) return null;
      const nameOf = { [rootId]: COORD, parent: COORD, you: "you" };
      for (const a of members) nameOf[a.id] = a.name;
      const roleOf = (n) => (n === COORD ? COORD : (members.find((a) => a.name === n) || {}).role);
      const posts = [];
      for (const [to, list] of boards) {
        for (const p of Array.isArray(list) ? list : []) {
          const from = nameOf[p.from] || (p.from ? p.from.slice(0, 8) : "?");
          posts.push({
            from, to: [to], text: p.text, at: p.at, exact: true, kind: p.kind, member: from === COORD ? to : from,
            verdict: p.kind === "report" && roleOf(from) === "verifier" ? verdictOf(p.text) : null,
          });
        }
      }
      if (lead.last && /^\W*SWARM DONE/i.test(lead.last)) {
        posts.push({ from: COORD, to: ["you"], text: lead.last.replace(/^\W*SWARM DONE\W*/i, ""), at: Infinity, exact: false, kind: "done", member: COORD });
      }
      posts.sort((x, y) => x.at - y.at);
      posts.forEach((p, i) => { p.no = i + 1; });
      return posts;
    }
    function buildModel(sessionId, projections, byId, now) {
      if (typeof now !== "number") now = Date.now();
      const rootId = resolveRoot(sessionId, projections, byId);
      const rootVals = (projections[rootId] && projections[rootId].values) || {};
      const rootSummary = byId[rootId];
      const preset = rootVals.agentPreset || (rootSummary && rootSummary.projectionValues && rootSummary.projectionValues.agentPreset) || "";
      const entries = catalogEntries(rootVals.subagentCatalog);
      const lead = agent(rootId, rootVals, rootSummary, null, now);
      const members = entries.map((e) => agent(e.id, (projections[e.id] && projections[e.id].values) || {}, byId[e.id], e, now));
      const all = [lead].concat(members);
      const title = (rootSummary && (rootSummary.title || rootSummary.displayTitle)) || (typeof rootVals.title === "string" ? rootVals.title : "") || "Swarm";
      const real = realPosts(rootId, lead, members, projections);
      const posts = real || buildPosts(lead, members);
      for (const a of all) {
        const mine = posts.filter((p) => p.from === a.name);
        a.lastPost = mine.length ? mine[mine.length - 1] : null;
      }
      return {
        rootId, title, preset, isSwarm: preset === "swarm-lead" || members.length > 0, entries, lead, members, posts, realBoard: !!real,
        cost: all.reduce((s, a) => s + a.cost, 0), tokens: all.reduce((s, a) => s + a.tokens, 0),
        running: members.filter((a) => a.running).length, leadRunning: lead.running,
        stalled: members.filter((a) => a.stall).length, now,
      };
    }

    // ------------------------------------------------------------------ format
    function fmtTok(n) {
      if (n < 1000) return String(n);
      if (n < 1e6) return (n / 1000 >= 100 ? Math.round(n / 1000) : Math.round(n / 100) / 10) + "k";
      return Math.round(n / 1e5) / 10 + "M";
    }
    function fmtCost(c) { return c < 0.01 ? "<$0.01" : "$" + c.toFixed(c < 1 ? 3 : 2); }
    function fmtMs(ms) {
      if (ms == null) return "";
      const s = Math.round(ms / 1000);
      return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
    }
    function fmtTime(at) {
      if (!at || !isFinite(at)) return "";
      try { return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (_e) { return ""; }
    }
    const WORD = { working: "Working", stalled: "Stalled", pass: "PASS", fail: "FAIL", done: "Done", stopped: "Stopped", starting: "Starting" };
    // Report previews are markdown; drop the markup characters so posts read as plain text.
    function plain(text) { return (text || "").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim(); }
    const PALETTE = ["#c2410c", "#7c3aed", "#0f766e", "#2563eb", "#be185d", "#4d7c0f", "#b45309", "#0369a1"];
    function colorOf(name, role) {
      if (role === COORD || name === COORD) return "#a16207";
      if (role === "verifier") return "#1d4ed8";
      if (role === "monitor") return "#52525b";
      if (name === "you") return "#3f3f46";
      let x = 0;
      for (let i = 0; i < name.length; i++) x = (x * 31 + name.charCodeAt(i)) >>> 0;
      return PALETTE[x % PALETTE.length];
    }
    function initials(name) {
      const parts = name.replace(/^worker-/, "").split(/[-_\s]+/).filter(Boolean);
      return ((parts[0] || name)[0] + (parts[1] ? parts[1][0] : (parts[0] || "")[1] || "")).toUpperCase();
    }

    // ------------------------------------------------------------------ pieces
    function Dot({ s }) { return h("span", { className: "dsw-dot", "data-s": s, "aria-hidden": true }); }
    function Avatar({ name, role, status }) {
      return h("span", { className: "dsw-av", style: { background: colorOf(name, role) }, "aria-hidden": true },
        initials(name), status ? h(Dot, { s: status }) : null);
    }

    function Top({ m, tab, setTab }) {
      const live = m.running > 0 || m.leadRunning;
      const c = m.lead.ctx;
      const used = c ? c.pressureTokens || c.surfaceTokens || 0 : 0;
      const win = c ? c.contextWindow || 0 : 0;
      const pct = win ? Math.min(100, (used / win) * 100) : 0;
      const ps = pct >= 80 ? "fail" : pct >= 50 ? "warn" : "ok";
      const tabs = [["board", "Board", m.posts.length], ["members", "Members", m.members.length + 1], ["graph", "Graph", null]];
      return h("div", { className: "dsw-top" },
        h("div", { className: "dsw-titlerow" },
          h("h2", { className: "dsw-title", title: m.title }, m.title),
          h("span", { className: "dsw-live" }, h(Dot, { s: live ? "live" : "idle" }), live ? "Live" : "Finished")),
        h("div", { className: "dsw-meter" },
          h("span", null, "Coordinator context ", h("b", null, c ? fmtTok(used) : "–"), win ? " / " + fmtTok(win) : ""),
          win ? h("span", { className: "dsw-bar", role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(pct), "aria-label": "Coordinator context used" },
            h("i", { style: { width: Math.max(2, pct).toFixed(1) + "%" }, "data-s": ps })) : null,
          win ? h("span", null, pct.toFixed(0) + "%" + (ps === "fail" ? " · compact now" : ps === "warn" ? " · compact soon" : "")) : null,
          h("span", null, "· Session ", h("b", null, fmtCost(m.cost)), " · " + fmtTok(m.tokens) + " tok")),
        h("div", { className: "dsw-tabs", role: "tablist" }, tabs.map(([id, label, count]) =>
          h("button", { key: id, type: "button", role: "tab", "aria-selected": tab === id, onClick: () => setTab(id) },
            label, count != null ? h("span", { className: "c" }, count) : null))));
    }

    function Board({ m }) {
      const [q, setQ] = React.useState("");
      const [who, setWho] = React.useState("");
      const [follow, setFollow] = React.useState(true);
      const endRef = React.useRef(null);
      const names = [COORD].concat(m.members.map((a) => a.name));
      const roleOf = (n) => (n === COORD ? COORD : (m.members.find((a) => a.name === n) || {}).role);
      const ql = q.trim().toLowerCase();
      const shown = m.posts.filter((p) => (!who || p.from === who || p.to.indexOf(who) >= 0)
        && (!ql || (p.from + " " + p.to.join(" ") + " " + p.text).toLowerCase().indexOf(ql) >= 0));
      // Follow: keep the newest post in view as posts arrive (Antigravity's Follow switch).
      React.useEffect(() => {
        if (follow && endRef.current && endRef.current.scrollIntoView) endRef.current.scrollIntoView({ block: "end" });
      }, [follow, shown.length]);
      return h("div", null,
        h("div", { className: "dsw-tools" },
          h("input", { className: "dsw-search", type: "search", placeholder: "Search", "aria-label": "Search posts", value: q, onChange: (e) => setQ(e.target.value) }),
          h("select", { className: "dsw-select", "aria-label": "Filter by member", value: who, onChange: (e) => setWho(e.target.value) },
            h("option", { value: "" }, "All members"),
            names.map((n) => h("option", { key: n, value: n }, "@" + n))),
          h("button", { type: "button", className: "dsw-tbtn", "aria-pressed": follow, onClick: () => setFollow((v) => !v), title: "Keep the newest post in view" }, "Follow")),
        m.realBoard ? null : h("p", { className: "dsw-note", style: { margin: "0 0 6px" } }, "This run predates the live board: posts are rebuilt from the agents' reports and their order is estimated."),
        shown.length === 0 ? h("div", { className: "dsw-empty" }, m.posts.length ? "No posts match." : "Nothing posted yet.") : null,
        shown.map((p) => h("div", { key: p.no, className: "dsw-post" },
          h(Avatar, { name: p.from, role: roleOf(p.from) }),
          h("div", { className: "main" },
            h("div", { className: "hd" },
              h("span", { className: "who" }, "@" + p.from),
              h("span", { className: "to" }, "→ " + p.to.map((t) => "@" + t).join(" ")),
              h("span", { className: "no" }, "#" + p.no + (p.exact && fmtTime(p.at) ? " · " + fmtTime(p.at) : ""))),
            h("p", { className: "txt" },
              p.verdict ? h("span", { className: "dsw-tag", "data-s": p.verdict === "PASS" ? "pass" : "fail" }, p.verdict) : null,
              p.kind === "done" ? "[done] " : "", plain(p.text))))),
        h("div", { ref: endRef, "aria-hidden": true }));
    }

    function errLine(e, now) {
      const kind = e.kind === "tool" ? (e.tool ? e.tool + " failed" : "tool failed") : e.kind === "llm" ? "model call retried" : "turn failed";
      const text = [e.code, plain(e.message)].filter(Boolean).join(": ");
      return fmtMs(Math.max(0, now - e.at)) + " ago · " + kind + (text ? " · " + text : "");
    }
    function MemberRow({ a, rootId, openAside, now }) {
      const addr = a.entry ? { parentSessionId: rootId, childSessionId: a.id, mode: a.entry.mode } : null;
      const model = [a.model, a.effort].filter(Boolean).join(" · ") + (a.lastPost ? " · #" + a.lastPost.no : "");
      const meta = [a.tokens ? fmtTok(a.tokens) + " tok" : "", fmtMs(a.ms), a.cost ? fmtCost(a.cost) : ""].filter(Boolean).join(" · ");
      const desc = a.role === COORD ? "Coordinator: splits the task, briefs workers and verifiers, judges the results" : a.label;
      const props = addr
        ? { type: "button", className: "dsw-mem", onClick: () => openAside(addr), title: "Open " + a.name + "'s conversation" }
        : { className: "dsw-mem", "data-static": "" };
      return h(addr ? "button" : "div", props,
        h(Avatar, { name: a.name, role: a.role, status: a.status }),
        h("div", { className: "main" },
          h("div", { className: "hd" },
            h("span", { className: "who" }, "@" + a.name),
            h("span", { className: "dsw-word", "data-s": a.status }, a.role === COORD && a.status === "done" ? "Coordinator" : WORD[a.status] || a.status),
            a.lastPost ? h("span", { className: "to" }, "→ " + a.lastPost.to.map((t) => "@" + t).join(" ")) : null,
            model ? h("span", { className: "model" }, model) : null),
          desc ? h("div", { className: "desc", title: desc }, desc) : null,
          h("div", { className: "last" }, a.lastPost ? plain(a.lastPost.text) : a.running ? "Working, no posts yet" : "No posts yet"),
          a.stall ? h("div", { className: "stall" }, a.stall.kind === "tool"
            ? "No result from " + a.stall.tool + " for " + fmtMs(a.stall.ms) : "No activity for " + fmtMs(a.stall.ms)) : null,
          a.lastError ? h("div", { className: "err", "data-hot": now - a.lastError.at < STALL_MS ? "" : undefined, title: a.lastError.message },
            "Last error " + errLine(a.lastError, now)) : null,
          meta ? h("div", { className: "meta" }, meta) : null));
    }

    function Members({ m, rootId, openAside }) {
      const [q, setQ] = React.useState("");
      const [showRetired, setShowRetired] = React.useState(false);
      const ql = q.trim().toLowerCase();
      const match = (a) => !ql || (a.name + " " + a.label + " " + a.role).toLowerCase().indexOf(ql) >= 0;
      const active = m.members.filter((a) => a.running && match(a));
      const standing = m.members.filter((a) => !a.running && a.status !== "stopped" && match(a));
      const retired = m.members.filter((a) => !a.running && a.status === "stopped" && match(a));
      const row = (a) => h(MemberRow, { key: a.id, a, rootId, openAside, now: m.now });
      return h("div", null,
        h("div", { className: "dsw-tools" },
          h("input", { className: "dsw-search", type: "search", placeholder: "Search members", "aria-label": "Search members", value: q, onChange: (e) => setQ(e.target.value) })),
        match(m.lead) ? row(m.lead) : null,
        active.length ? h("div", { className: "dsw-group" }, "Active " + active.length) : null,
        active.map(row),
        standing.length ? h("div", { className: "dsw-group" }, "Standing by " + standing.length) : null,
        standing.map(row),
        retired.length ? h("div", { className: "dsw-group" },
          h("button", { type: "button", "aria-expanded": showRetired, onClick: () => setShowRetired((v) => !v) }, (showRetired ? "▾ " : "▸ ") + "Retired " + retired.length)) : null,
        showRetired ? retired.map(row) : null);
    }

    function Graph({ m }) {
      const total = m.posts.length;
      const [at, setAt] = React.useState(null); // null = Live
      const [playing, setPlaying] = React.useState(false);
      const [W, setWidth] = React.useState(344);
      const svg = React.useRef(null);
      const arrow = React.useId();
      React.useEffect(() => {
        const el = svg.current;
        const measure = () => { if (el.clientWidth > 0) setWidth(el.clientWidth); };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
      }, []);
      const upto = at == null ? total : Math.min(at, total);
      React.useEffect(() => {
        if (!playing) return undefined;
        const iv = setInterval(() => {
          setAt((cur) => {
            const next = (cur == null ? 0 : cur) + 1;
            if (next >= total) { setPlaying(false); return null; }
            return next;
          });
        }, 700);
        return () => clearInterval(iv);
      }, [playing, total]);
      const shown = m.posts.slice(0, upto);
      const hot = upto > 0 && at != null ? shown[upto - 1] : null;
      const timed = shown.filter((p) => p.exact && isFinite(p.at));
      const span = timed.length > 1 ? timed[timed.length - 1].at - timed[0].at : 0;
      const hotRecipients = new Set(hot ? hot.to : []);
      const n = m.members.length;
      const inset = 3, nodeH = 38, columnGap = 12, rowGap = 12;
      const cols = Math.max(1, Math.min(4, Math.floor((W - 2 * inset + columnGap) / (96 + columnGap))));
      const nodeW = (W - 2 * inset - (cols - 1) * columnGap) / cols;
      const leadW = Math.min(150, W - 2 * inset);
      const pos = new Map();
      const place = (name, status, x, y, w) => pos.set(name, { name, status, x, y, w, fromLead: 0, toLead: 0, peers: new Map() });
      place(COORD, m.leadRunning ? "working" : "done", W / 2, inset + nodeH / 2, leadW);
      const groups = [
        ["Workers", m.members.filter((a) => a.role === "worker")],
        ["Verifiers", m.members.filter((a) => a.role === "verifier")],
        ["Others", m.members.filter((a) => a.role !== "worker" && a.role !== "verifier")],
      ];
      let y = inset + nodeH + 10;
      const headings = [];
      for (const [label, members] of groups) {
        if (!members.length) continue;
        headings.push(h("text", { key: label, className: "graph-role", x: inset, y: y + 12 }, label + " · " + members.length));
        y += 20;
        members.forEach((a, i) => {
          const inRow = Math.min(cols, members.length - Math.floor(i / cols) * cols);
          const emptyWidth = n <= 6 ? (cols - inRow) * (nodeW + columnGap) / 2 : 0;
          const x = inset + emptyWidth + nodeW / 2 + (i % cols) * (nodeW + columnGap);
          place(a.name, a.status, x, y + nodeH / 2 + Math.floor(i / cols) * (nodeH + rowGap), nodeW);
        });
        y += Math.ceil(members.length / cols) * (nodeH + rowGap) + 4;
      }
      // Coordinator traffic dominates most runs. Keep it on the cards and reserve arrows for peers.
      for (const p of shown) for (const t of p.to) {
        const a = pos.get(p.from), b = pos.get(t);
        if (!a || !b || a === b || t === "you") continue;
        if (a.name === COORD) b.fromLead++;
        else if (b.name === COORD) a.toLead++;
        else a.peers.set(b, (a.peers.get(b) || 0) + 1);
      }
      const edges = [], hotEdges = [];
      for (const a of pos.values()) for (const [b, count] of a.peers) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const start = Math.min((a.w / 2 + 2) / Math.abs(dx), (nodeH / 2 + 2) / Math.abs(dy));
        const end = Math.min((b.w / 2 + 2) / Math.abs(dx), (nodeH / 2 + 2) / Math.abs(dy));
        const offset = b.peers.has(a) ? 3 / Math.hypot(dx, dy) : 0;
        const ox = -dy * offset, oy = dx * offset;
        const active = hot && a.name === hot.from && hotRecipients.has(b.name);
        (active ? hotEdges : edges).push(h("path", {
          key: JSON.stringify([a.name, b.name]), className: "edge", "data-hot": active ? "" : undefined,
          d: "M" + (a.x + dx * start + ox) + "," + (a.y + dy * start + oy) +
            " L" + (b.x - dx * end + ox) + "," + (b.y - dy * end + oy),
          strokeWidth: active ? 2 : Math.min(2.5, 1 + count * 0.2),
          markerEnd: "url(#" + arrow + (active ? "-hot" : "") + ")",
        }, h("title", null, a.name + " → " + b.name + " · " + count + (count === 1 ? " post" : " posts"))));
      }
      const nodes = Array.from(pos.values(), ({ name, status: s, x, y, w, fromLead, toLead }) => {
        const coord = name === COORD;
        const status = WORD[s] || s;
        const title = name + " · " + status + (coord ? "" : " · " + fromLead + " from coordinator, " + toLead + " to coordinator");
        return h("g", {
          key: name, className: "node", role: "img", "aria-label": title, "data-s": s,
          "data-coord": coord ? "" : undefined, "data-hot": hot && (hot.from === name || hotRecipients.has(name)) ? "" : undefined,
          transform: "translate(" + (x - w / 2) + "," + (y - nodeH / 2) + ")",
        },
        h("title", null, title),
        h("rect", { width: w, height: nodeH, rx: 7 }),
        h("circle", { cx: 11, cy: 12, r: 3.5, fill: s === "working" ? "var(--dsw-alias-state-business-primary)" : s === "fail" ? "var(--dsw-alias-state-error-primary)" : s === "stopped" || s === "stalled" ? "var(--dsw-alias-state-warn-primary)" : "var(--dsw-alias-state-success-primary)" }),
        h("foreignObject", { x: 20, y: 3, width: Math.max(0, w - 26), height: 32 },
          h("div", null,
            h("span", { className: "node-name" }, name),
            h("span", { className: "node-meta" }, status, coord ? null : h("span", { className: "node-count" }, fromLead + toLead)))));
      });
      const marker = (id, fill) => h("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, markerUnits: "userSpaceOnUse", orient: "auto" },
        h("path", { d: "M0,0 L10,5 L0,10 z", fill }));
      const step = (d) => { setPlaying(false); setAt((cur) => { const v = (cur == null ? total : cur) + d; return v >= total ? null : Math.max(0, v); }); };
      return h("div", { className: "dsw-graph" },
        h("div", { className: "dsw-replay" },
          h("button", { type: "button", className: "dsw-tbtn", "aria-label": "First post", onClick: () => { setPlaying(false); setAt(0); } }, "⏮"),
          h("button", { type: "button", className: "dsw-tbtn", "aria-label": "Previous post", onClick: () => step(-1) }, "‹"),
          h("button", { type: "button", className: "dsw-tbtn", "aria-label": playing ? "Pause" : "Play", "aria-pressed": playing,
            onClick: () => { if (!playing && at == null) setAt(0); setPlaying((v) => !v); } }, playing ? "❚❚" : "▶"),
          h("button", { type: "button", className: "dsw-tbtn", "aria-label": "Next post", onClick: () => step(1) }, "›"),
          h("input", { type: "range", min: 0, max: total, value: upto, "aria-label": "Replay position",
            onChange: (e) => { setPlaying(false); const v = Number(e.target.value); setAt(v >= total ? null : v); } }),
          h("button", { type: "button", className: "dsw-tbtn live", "aria-pressed": at == null, onClick: () => { setPlaying(false); setAt(null); } },
            h(Dot, { s: at == null ? "live" : "idle" }), " Live")),
        h("div", { className: "dsw-meter", style: { margin: "0 0 6px" } },
          h("span", null, h("b", null, upto + (at == null ? "" : " of " + total) + " posts"), span ? " over " + fmtMs(span) : "", " between " + (n + 1) + " members"),
          hot ? h("span", { className: "replay-post" }, "· #" + hot.no + " @" + hot.from + " → " + hot.to.map((t) => "@" + t).join(" ") + (hot.exact && fmtTime(hot.at) ? " · " + fmtTime(hot.at) : "")) : null),
        h("p", { className: "dsw-legend" }, "Badge = coordinator posts · Arrow = peer message · Dashed = coordinator · Struck-through = stopped"),
        h("svg", { ref: svg, viewBox: "0 0 " + W + " " + y, role: "group", "aria-label": "Who messaged whom in this swarm", "data-dense": n > 12 ? "" : undefined },
          h("defs", null, marker(arrow, "var(--dsw-alias-label-tertiary)"), marker(arrow + "-hot", "var(--dsw-alias-state-business-primary)")),
          edges, hotEdges, headings, nodes));
    }

    function SwarmPane(props) {
      const { sessionId, useSessions, refresh, openAside } = props;
      const projections = useSessions((s) => s.projectionsBySession);
      const byId = useSessions((s) => s.byId);
      const [tab, setTab] = React.useState("board");
      const [ticks, tick] = React.useState(0);
      // ticks is a dependency: a stalled member logs nothing, so no projection changes, yet "no activity for N min" must age.
      const m = React.useMemo(() => buildModel(sessionId, projections || {}, byId || {}), [sessionId, projections, byId, ticks]);
      React.useEffect(() => {
        let alive = true;
        const run = () => { if (alive) { refresh(sessionId).catch(() => {}); tick((x) => x + 1); } };
        run();
        const iv = setInterval(run, REFRESH_MS);
        return () => { alive = false; clearInterval(iv); };
      }, [sessionId]);
      if (!m.isSwarm) {
        return h("div", { className: "dsw-swarm" }, h("div", { className: "dsw-body" },
          h("div", { className: "dsw-empty" }, "No swarm in this session. Pick the Swarm mode, then give it a task: the coordinator splits it, and its workers and verifiers show up here.")));
      }
      return h("div", { className: "dsw-swarm", "data-swarm-pane": "" },
        h(Top, { m, tab, setTab }),
        h("div", { className: "dsw-body" },
          tab === "board" ? h(Board, { m }) : tab === "members" ? h(Members, { m, rootId: m.rootId, openAside }) : h(Graph, { m }),
          h("p", { className: "dsw-note" }, "Cost uses OpenCode's pay-as-you-go prices for deepseek-v4.1-flash ($0.30 in, $0.006 cached, $1.20 out per 1M); flat-rate plans use quota instead.")));
    }

    // Header button: shown on swarm sessions; opens the pane, and opens it once by itself when workers start.
    const autoOpened = new Set();
    function HeaderButton(props) {
      const { sessionId, useSessions, openPane } = props;
      const projections = useSessions((s) => s.projectionsBySession);
      const byId = useSessions((s) => s.byId);
      const [ticks, setTicks] = React.useState(0);
      React.useEffect(() => {
        const iv = setInterval(() => setTicks((x) => x + 1), 15000);
        return () => clearInterval(iv);
      }, []);
      const m = React.useMemo(() => buildModel(sessionId, projections || {}, byId || {}), [sessionId, projections, byId, ticks]);
      React.useEffect(() => {
        if (m.running > 0 && !autoOpened.has(m.rootId)) { autoOpened.add(m.rootId); openPane(); }
      }, [m.running, m.rootId]);
      if (!m.isSwarm) return null;
      const s = m.stalled ? "stalled" : m.running ? "working" : m.members.some((a) => a.status === "fail") ? "fail" : m.members.length ? "pass" : "starting";
      return h("button", { type: "button", className: "dsw-hbtn", onClick: openPane, title: "Open the Swarm pane", "data-swarm-button": "" },
        h(Dot, { s }), m.running ? "Swarm · " + m.running + " working" + (m.stalled ? " · " + m.stalled + " stalled" : "") : "Swarm");
    }

    // ------------------------------------------------------------------ wiring
    function chatAddress(addr) {
      const q = new URLSearchParams({ parent: addr.parentSessionId, mode: addr.mode });
      return CHAT_PREFIX + encodeURIComponent(addr.childSessionId) + "?" + q;
    }
    exports.inject = ["slots", "sessions", "sidebarRight", "sidebarRightTabs"];
    exports.apply = function apply(ctx) {
      const refresh = async (sessionId) => {
        await ctx.sessions.refreshProjections(sessionId);
        let st = ctx.sessions.list.getSnapshot();
        const rootId = resolveRoot(sessionId, st.projectionsBySession, st.byId);
        if (rootId !== sessionId) { await ctx.sessions.refreshProjections(rootId); st = ctx.sessions.list.getSnapshot(); }
        for (const e of catalogOf(st.projectionsBySession, rootId)) {
          const p = st.projectionsBySession[e.id];
          const sum = st.byId[e.id];
          // refreshProjections reads once (it returns at once when ready: manager.ts refreshProjections, the 'ready' early
          // return); live sessions update through the app's host-wide control stream (control.ts onEventChanged ->
          // manager.ts handleControlFrame), which also delivers the frames of a member's final events. So a member that
          // stopped since the last refresh is already complete, and a second read here would be a no-op.
          if (p && p.state === "ready" && !(sum && sum.running)) continue;
          await ctx.sessions.refreshProjections(e.id).catch(() => {});
        }
      };
      const openAside = (addr) => {
        ctx.sidebarRight.openResource(chatAddress(addr), { kind: "subagentchat", preferNewPane: true });
      };
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID, kind: KIND, priority: "extension", keepMounted: true, title: () => "Swarm",
        guide: [{ id: "swarm", order: 40, title: () => "Swarm", description: () => "Board, members and graph of this swarm" }],
      }), "dsh-swarm: tab type");
      ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
        name: "sidebar.right.pane.tab", key: TAB_ID,
        inject: () => ({ refresh, openAside }),
      }, SwarmPane)), "dsh-swarm: pane body");
      ctx.effect(() => ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
        name: "conversation.session.header.actions", id: "dsh-swarm", order: 15,
        inject: (sessionId) => ({
          openPane: () => {
            try { ctx.sidebarRight.openTabIn(sessionId, KIND); } catch (_e) { ctx.sidebarRight.openTab(KIND); }
          },
        }),
      }, HeaderButton)), "dsh-swarm: header button");
    };
    exports.SwarmPane = SwarmPane;
    exports.buildModel = buildModel;
    return module.exports;
  },
});
