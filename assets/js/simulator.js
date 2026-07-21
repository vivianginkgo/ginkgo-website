/*
 * Ginkgo Simulator
 * -----------------
 * Client-side only. Lets a user load one or more simulation-result JSON files,
 * pick which one to view via a selector, and renders a tailored, human-readable
 * view of the prescription: overview, summary scores, the day-by-day program,
 * and the assessment answers (mapped via simulator-data.js).
 *
 * No server, no persistence: loaded files live in the `files` array below and
 * are gone on refresh.
 */
(function () {
  "use strict";

  // ---- State -------------------------------------------------------------
  const files = []; // { name, data|null, error|null }
  let activeData = null;
  let activeTab = "assessment"; // preserved across file switches
  let hideUnselected = false; // assessment "hide unselected" checkbox state

  const MAX_FILE_BYTES = 25 * 1024 * 1024;

  const QUESTIONS = window.SIM_QUESTIONS || {};
  const ANSWERS = window.SIM_ANSWERS || {};
  const SECTIONS = window.SIM_SECTIONS || [];

  // Presentation tweaks for the assessment section:
  // Subsections (keyed by SubSection number) that lead with a synthetic header
  // row at the main size; every real question below then renders as a follow-up.
  const SET_HEADERS = { "4.18": "Hips", "5.17": "Symptoms" };
  // Sections whose set questions all render at the same size (no follow-up
  // shrinking). Empty now that Fitness indicators has no subsections, but kept
  // as a hook — add a section name here to flatten its sets.
  const FLAT_SECTIONS = {};

  // "Hide unselected" behaviour (checkbox in the assessment header):
  // Sections whose rows are never hidden.
  const ALWAYS_SHOW_SECTIONS = { "Fitness indicators": true };
  // Subsections (by number) never hidden — the medical-conditions symptoms set.
  const ALWAYS_SHOW_SUBS = { "5.17": true };
  // When a section's hideable rows all collapse to nothing, show this summary
  // line instead (only while the checkbox is checked).
  const EMPTY_SECTION_LINE = { "Injury report": "No injuries", "Medical conditions": "No medical conditions" };

  // Basic Info gets a computed BMI row (not present in the JSON). Height/weight
  // come from these assessment question ids.
  const BMI_HEIGHT_ID = "18f57667-7e89-4ad3-9db9-7c88c068452a";
  const BMI_WEIGHT_ID = "cca2f629-db44-4ba5-8904-2f2091ed4f3c";

  // Exercise AreasOfFocus code -> human label (from 'Area of focus' sheet).
  const AREA_OF_FOCUS = {
    1: "Chest", 2: "Shoulder", 3: "Thigh (back)", 4: "Thigh (front)", 5: "Butt",
    6: "Thigh (inner)", 7: "Abs (side)", 8: "Abs (front)", 9: "Upper arm (front)",
    10: "Upper arm (back)", 11: "Foot", 12: "Calf", 13: "Shin", 14: "Neck",
    15: "Forearm (back)", 16: "Forearm (front)", 17: "Lower back", 18: "Lats",
    19: "Upper trap", 20: "Upper back", 21: "Hip flexors", 22: "Serratus anterior",
  };

  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ---- DOM refs ----------------------------------------------------------
  const fileInput = document.getElementById("sim-file-input");
  const clearBtn = document.getElementById("sim-clear-btn");
  const selectorWrap = document.getElementById("sim-selector-wrap");
  const fileSelect = document.getElementById("sim-file-select");
  const output = document.getElementById("sim-output");

  // ---- Helpers -----------------------------------------------------------
  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function uniqueName(baseName) {
    let name = baseName, n = 2;
    const taken = new Set(files.map((f) => f.name));
    while (taken.has(name)) { name = baseName + " (" + n + ")"; n += 1; }
    return name;
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  // ---- File intake -------------------------------------------------------
  function readFile(file) {
    return new Promise((resolve) => {
      if (file.size > MAX_FILE_BYTES) {
        resolve({ name: uniqueName(file.name), data: null,
          error: "File is too large (" + (file.size / (1024 * 1024)).toFixed(1) + " MB). Limit is 25 MB." });
        return;
      }
      const reader = new FileReader();
      reader.onload = function () {
        const text = String(reader.result || "");
        if (text.trim() === "") { resolve({ name: uniqueName(file.name), data: null, error: "File is empty." }); return; }
        try { resolve({ name: uniqueName(file.name), data: JSON.parse(text), error: null }); }
        catch (e) { resolve({ name: uniqueName(file.name), data: null, error: "Invalid JSON: " + (e && e.message ? e.message : "could not parse.") }); }
      };
      reader.onerror = function () { resolve({ name: uniqueName(file.name), data: null, error: "Could not read this file." }); };
      reader.readAsText(file);
    });
  }

  async function handleFiles(fileList) {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    const firstNewIndex = files.length;
    for (const file of incoming) files.push(await readFile(file));
    rebuildSelector();
    let selectIndex = -1;
    for (let i = firstNewIndex; i < files.length; i += 1) { if (!files[i].error) { selectIndex = i; break; } }
    if (selectIndex === -1) selectIndex = firstNewIndex;
    fileSelect.value = String(selectIndex);
    renderFile(selectIndex);
    updateControls();
  }

  // ---- Selector ----------------------------------------------------------
  function rebuildSelector() {
    fileSelect.innerHTML = "";
    files.forEach((f, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = f.error ? f.name + " (error)" : f.name;
      fileSelect.appendChild(opt);
    });
  }

  function updateControls() {
    const hasFiles = files.length > 0;
    selectorWrap.classList.toggle("hidden", !hasFiles);
    clearBtn.disabled = !hasFiles;
  }

  // ---- Render dispatch ---------------------------------------------------
  function renderFile(index) {
    const entry = files[index];
    if (!entry) { showEmptyState(); return; }
    if (entry.error) { activeData = null; output.innerHTML = errorCard(entry.name, entry.error); return; }
    activeData = entry.data;
    output.innerHTML = renderTailored(entry.data);
    applyStickyOffset();
    if (entry.data && entry.data.Prescription && Array.isArray(entry.data.Prescription.DailySchedules)) selectDay(0);
  }

  // Pin the sticky day strip just below the (also-sticky) site nav.
  function applyStickyOffset() {
    const nav = document.querySelector("nav");
    const strip = output.querySelector(".sim-day-strip");
    if (strip) strip.style.top = (nav ? nav.offsetHeight : 72) + "px";
  }

  function showEmptyState() {
    activeData = null;
    output.innerHTML =
      '<div class="text-center py-20 px-6 bg-white border border-dashed border-stone-300">' +
      '<p class="text-stone-500 font-medium">No files loaded yet.</p>' +
      '<p class="text-stone-400 text-sm mt-1">Choose one or more JSON files above to get started.</p></div>';
  }

  function errorCard(name, message) {
    return (
      '<div class="bg-white border border-red-200 shadow-sm p-8">' +
      '<p class="font-semibold text-stone-900">' + esc(name) + "</p>" +
      '<p class="text-red-600 text-sm mt-1">' + esc(message) + "</p></div>"
    );
  }

  // ---- Tailored view -----------------------------------------------------
  // Layout: overview + summary scores are always visible; a tab bar below them
  // switches between the Assessment answers and the Prescription (28-day program).
  function renderTailored(data) {
    if (!data || typeof data !== "object") return errorCard("Unexpected format", "This file isn't a simulation-result object.");
    const p = data.Prescription || {};
    const assessment = Array.isArray(data.AssessmentDataItems) ? assessmentCard(data.AssessmentDataItems) : '<p class="text-stone-500">No assessment data in this file.</p>';
    const program = Array.isArray(p.DailySchedules) ? programCard(p.DailySchedules) : '<p class="text-stone-500">No program data in this file.</p>';
    return (
      overviewCard(data, p) +
      (p.SummaryResult ? summaryCard(p.SummaryResult) : "") +
      tabBar(activeTab) +
      '<div data-panel="assessment"' + (activeTab === "assessment" ? "" : ' class="hidden"') + ">" + assessment + "</div>" +
      '<div data-panel="prescription"' + (activeTab === "prescription" ? "" : ' class="hidden"') + ">" + program + "</div>"
    );
  }

  function tabBar(active) {
    function tab(id, label) {
      const on = active === id;
      const cls = on
        ? "border-emerald-600 text-emerald-700"
        : "border-transparent text-stone-500 hover:text-stone-800";
      return '<button type="button" data-tab="' + id + '" class="sim-tab px-5 py-3 text-sm font-semibold border-b-2 -mb-px ' + cls + ' transition-colors">' + label + "</button>";
    }
    return '<div class="flex gap-2 border-b border-stone-200 mb-6">' + tab("assessment", "Assessment") + tab("prescription", "Prescription") + "</div>";
  }

  function selectTab(id) {
    activeTab = id;
    output.querySelectorAll("[data-panel]").forEach(function (pnl) {
      pnl.classList.toggle("hidden", pnl.getAttribute("data-panel") !== id);
    });
    output.querySelectorAll(".sim-tab").forEach(function (btn) {
      const on = btn.getAttribute("data-tab") === id;
      btn.classList.toggle("border-emerald-600", on);
      btn.classList.toggle("text-emerald-700", on);
      btn.classList.toggle("border-transparent", !on);
      btn.classList.toggle("text-stone-500", !on);
    });
  }

  function statBlock(label, value) {
    return (
      '<div><dt class="text-xs font-semibold uppercase tracking-wide text-stone-400">' + esc(label) + "</dt>" +
      '<dd class="text-stone-900 font-semibold mt-0.5">' + value + "</dd></div>"
    );
  }

  function overviewCard(data, p) {
    const days = Array.isArray(p.DailySchedules) ? p.DailySchedules.length : 0;
    const bc = p.BcActivated
      ? '<span class="inline-flex items-center text-emerald-700 bg-emerald-50 px-2 py-0.5 text-xs font-semibold">Balance Challenge on</span>'
      : '<span class="inline-flex items-center text-stone-500 bg-stone-100 px-2 py-0.5 text-xs font-semibold">Balance Challenge off</span>';
    const shortId = p.Id ? String(p.Id).split("-")[0] : "—";
    return (
      '<section class="bg-white border border-stone-200 shadow-sm p-8 mb-6">' +
      '<h2 class="text-xl font-bold text-stone-900 leading-tight">' + esc(data.UserId || "Simulation result") + "</h2>" +
      '<p class="text-sm text-stone-500 mb-6">Personalized exercise prescription</p>' +
      '<dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">' +
      statBlock("Program length", esc(days) + " days") +
      statBlock("Sets", esc(p.Sets != null ? p.Sets : "—")) +
      statBlock("Begins", esc(formatDate(p.BeginDate))) +
      statBlock("Last modified", esc(formatDate(p.ModifiedAt))) +
      statBlock("Prescription", '<span class="font-mono text-sm" title="' + esc(p.Id || "") + '">' + esc(shortId) + "</span>") +
      "</dl><div class=\"mt-5\">" + bc + "</div></section>"
    );
  }

  // ---- Summary scores ----------------------------------------------------
  function summaryCard(summary) {
    const order = ["Fitness", "Intensity", "Difficulty", "Balance", "Safety", "Time"];
    const keys = order.filter((k) => k in summary).concat(Object.keys(summary).filter((k) => order.indexOf(k) === -1));
    return (
      '<section class="bg-white border border-stone-200 shadow-sm p-8 mb-6">' +
      '<h3 class="text-lg font-bold text-stone-900 mb-6">Summary scores</h3>' +
      '<div class="grid sm:grid-cols-2 gap-x-10 gap-y-5">' + keys.map((k) => scoreBar(k, summary[k])).join("") + "</div></section>"
    );
  }

  function scoreColor(v) {
    if (typeof v !== "number") return "bg-stone-300";
    if (v >= 80) return "bg-emerald-600";
    if (v >= 50) return "bg-emerald-400";
    if (v >= 30) return "bg-amber-400";
    return "bg-red-400";
  }

  function scoreBar(label, value) {
    const num = typeof value === "number" ? value : parseFloat(value);
    const pct = isNaN(num) ? 0 : Math.max(0, Math.min(100, num));
    return (
      '<div><div class="flex items-baseline justify-between mb-1.5">' +
      '<span class="text-sm font-semibold text-stone-700">' + esc(label) + "</span>" +
      '<span class="text-sm font-bold text-stone-900">' + esc(isNaN(num) ? value : num) + '<span class="text-stone-400 font-normal">/100</span></span></div>' +
      '<div class="h-2.5 bg-stone-100 overflow-hidden">' +
      '<div class="h-full ' + scoreColor(num) + '" style="width:' + pct + '%"></div></div></div>'
    );
  }

  // ---- Program (daily schedules) -----------------------------------------
  function programCard(schedules) {
    const buttons = schedules.map(function (s, i) {
      const count = (s.WarmUp || []).length + (s.Training || []).length + (s.CoolDown || []).length;
      const rest = count === 0;
      return (
        '<button type="button" data-day="' + i + '" ' +
        'class="sim-day-btn shrink-0 px-3.5 py-2 text-sm font-semibold border transition-colors ' +
        (rest ? "text-stone-400 " : "text-stone-600 ") +
        'border-stone-200 hover:border-emerald-400 hover:text-emerald-700">Day ' + (i + 1) + "</button>"
      );
    }).join("");
    return (
      '<section class="bg-white border border-stone-200 shadow-sm p-8 mb-6">' +
      '<h3 class="text-lg font-bold text-stone-900 mb-5">' + schedules.length + "-day program</h3>" +
      // Sticky day strip: pins while scrolling the exercise list, scoped to this
      // section (releases at the end of the program). Flat with a bottom border
      // spanning the full width of the program box (-mx-8 offsets the p-8). Its
      // top offset is set to the nav height in applyStickyOffset().
      '<div class="sim-day-strip sticky z-20 bg-white border-b border-stone-200 -mx-8 px-8 py-3" style="top:72px">' +
      '<div class="flex gap-2 overflow-x-auto">' + buttons + "</div></div>" +
      '<div id="sim-day-detail"></div></section>'
    );
  }

  function chip(label, value) {
    return (
      '<div class="bg-stone-50 px-3 py-2 border border-stone-100 min-w-[7rem]">' +
      '<div class="text-[11px] font-semibold uppercase tracking-wide text-stone-400">' + esc(label) + "</div>" +
      '<div class="text-stone-800 font-semibold text-sm">' + value + "</div></div>"
    );
  }

  function dayDetail(s, index) {
    const chips =
      chip("Duration", esc(s.Duration != null ? s.Duration + " min" : "—")) +
      chip("Rest", esc(s.RestSeconds != null ? s.RestSeconds + "s" : "—"));
    const groups = exerciseGroup("Warm Up", s.WarmUp) + exerciseGroup("Training", s.Training) + exerciseGroup("Cool Down", s.CoolDown);
    const total = (s.WarmUp || []).length + (s.Training || []).length + (s.CoolDown || []).length;
    const body = total === 0 ? '<p class="text-stone-500 italic mt-4">Rest day — no exercises scheduled.</p>' : groups;
    return (
      '<div class="pt-6">' +
      '<h4 class="font-bold text-stone-900 mb-4">Day ' + (index + 1) + "</h4>" +
      '<div class="flex flex-wrap gap-3 mb-6">' + chips + "</div>" + body + "</div>"
    );
  }

  function exerciseGroup(title, list) {
    if (!Array.isArray(list) || list.length === 0) return "";
    return (
      '<div class="mb-6 last:mb-0">' +
      '<div class="flex items-center gap-2 mb-3">' +
      '<h5 class="text-sm font-bold uppercase tracking-wide text-stone-500">' + esc(title) + "</h5>" +
      '<span class="text-xs text-stone-400">(' + list.length + ")</span></div>" +
      '<ul class="space-y-2">' + list.map(exerciseRow).join("") + "</ul></div>"
    );
  }

  function exerciseRow(ex) {
    const meta = [];
    if (ex.RepetitionsPerSet != null) meta.push(esc(ex.RepetitionsPerSet) + "×");
    if (ex.HoldTime) meta.push(esc(ex.HoldTime) + "s hold");
    if (ex.Plyometric) meta.push("plyometric");
    const metaHtml = meta.length ? '<span class="text-xs font-medium text-stone-500 whitespace-nowrap">' + meta.join(" · ") + "</span>" : "";

    // Side badge from BalancingPosition: 1 = Left, 2 = Right, 0/other = none.
    const side = ex.BalancingPosition === 1 ? "L" : ex.BalancingPosition === 2 ? "R" : "";
    const sideBadge = side ? '<span class="ml-2 inline-block text-[11px] font-bold text-stone-500 border border-stone-300 px-1 leading-tight">' + side + "</span>" : "";

    // Area-of-focus tags (emerald) — distinct colour from the grey equipment tags.
    const areaTags = (Array.isArray(ex.AreasOfFocus) ? ex.AreasOfFocus : [])
      .filter(function (n) { return n !== 0 && AREA_OF_FOCUS[n]; })
      .map(function (n) { return '<span class="inline-block text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5">' + esc(AREA_OF_FOCUS[n]) + "</span>"; })
      .join("");
    const equipTags = (Array.isArray(ex.Equipments) ? ex.Equipments : [])
      .map(function (e) { return '<span class="inline-block text-[11px] bg-stone-100 text-stone-600 px-2 py-0.5">' + esc(e && e.Name ? e.Name : e) + "</span>"; })
      .join("");
    const tags = (areaTags || equipTags) ? '<div class="mt-1.5 flex flex-wrap gap-1.5">' + areaTags + equipTags + "</div>" : "";

    return (
      '<li class="flex items-start justify-between gap-4 bg-stone-50 px-4 py-3 border border-stone-100">' +
      '<div class="min-w-0"><p class="text-sm font-medium text-stone-800">' + esc(ex.Name || "Exercise #" + (ex.Id != null ? ex.Id : "?")) + sideBadge + "</p>" +
      tags + "</div>" + metaHtml + "</li>"
    );
  }

  // ---- Assessment answers ------------------------------------------------
  function resolveAnswer(raw) {
    if (typeof raw === "string" && GUID_RE.test(raw)) return ANSWERS[raw.toLowerCase()] || raw;
    return raw;
  }

  function normLabel(s) { return String(s).trim().toLowerCase(); }

  // A single table row: question on the left, answer on the right.
  // opts.bg    — background class (zebra for standalone rows, one solid colour per set).
  // opts.small — follow-up question: same size as everything else, just a lighter
  //              question colour. The value on the right is unaffected.
  function tRow(question, answer, opts) {
    opts = opts || {};
    const bg = opts.bg || "bg-white";
    const qCls = opts.small ? "text-sm text-stone-500" : "text-sm text-stone-700";
    return (
      '<div class="flex items-start justify-between gap-4 px-5 py-2.5 ' + bg + '">' +
      '<dt class="' + qCls + ' min-w-0 pr-4">' + esc(question) + "</dt>" +
      '<dd class="text-sm font-semibold text-stone-900 text-right shrink-0 max-w-[45%]">' +
      (answer === "" || answer == null ? "" : esc(answer)) + "</dd></div>"
    );
  }

  // Fold the "Pain impact" list into the matching "Arthritis" body-part rows
  // (show each part's numeric pain impact instead of its Yes/No), dropping the
  // separate pain-impact list. Returns a (possibly) new items array.
  function mergeArthritis(items) {
    if (!items.some(function (r) { return r.group === "Pain impact"; })) return items;
    const painByLabel = {};
    items.forEach(function (r) { if (r.group === "Pain impact") painByLabel[normLabel(r.text)] = r.answer; });
    return items
      .filter(function (r) { return r.group !== "Pain impact"; })
      .map(function (r) {
        if (r.group === "Arthritis" && painByLabel.hasOwnProperty(normLabel(r.text))) {
          const copy = {}; for (const k in r) copy[k] = r[k];
          copy.answer = painByLabel[normLabel(r.text)];
          return copy;
        }
        return r;
      });
  }

  // A run of standalone questions — zebra striped (white / light grey), all at
  // the normal type size. `ctx.i` is a running index kept continuous so the
  // stripe rhythm carries across the section.
  function renderRunBlock(items, ctx) {
    let html = "";
    items.forEach(function (r) {
      html += tRow(r.text, r.answer, { bg: ctx.i++ % 2 === 1 ? "bg-stone-50" : "bg-white" });
    });
    return '<div class="divide-y divide-stone-100">' + html + "</div>";
  }

  // One subsection set — the whole set acts as a single unit in the zebra
  // sequence: every row shares one colour (no internal alternation) that
  // continues the stripe from the row above, and the set consumes one stripe
  // step so the row after it flips. The first question keeps the normal size;
  // following questions are smaller so they read as follow-ups to that main
  // question. Prompts (e.g. "Which part(s)...?") render as a row with no answer.
  function renderSetBlock(items, ctx) {
    const bg = ctx.i++ % 2 === 1 ? "bg-stone-50" : "bg-white";
    const sub = items.length ? items[0].sub : null;
    const flat = items.length ? !!FLAT_SECTIONS[items[0].section] : false;
    const headerLabel = SET_HEADERS[sub];
    let html = "", ri = 0, lastPrompt = null;

    // The first rendered row is the "main" question (normal size); the rest are
    // follow-ups (smaller) — unless the section is flat (all the same size).
    function row(question, answer) {
      html += tRow(question, answer, { bg: bg, small: !flat && ri > 0 });
      ri++;
    }

    // Optional synthetic header row (main size); turns every real question below
    // it into a follow-up.
    if (headerLabel) row(headerLabel, "");

    items.forEach(function (r) {
      if (r.prompt && r.prompt !== lastPrompt) { row(r.prompt, ""); lastPrompt = r.prompt; }
      if (!r.prompt) lastPrompt = null;
      row(r.text, r.answer);
    });
    return '<div class="divide-y divide-stone-100">' + html + "</div>";
  }

  // An answer counts as "unselected" when it is "No" or numeric zero.
  function isSelected(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    if (s === "" || s === "no") return false;
    if (/^-?\d+(\.\d+)?$/.test(s) && parseFloat(s) === 0) return false;
    return true;
  }

  // Whether a subsection set should be shown when hiding unselected answers.
  // Follow-ups follow their parent: a real-parent set keys off its first row;
  // a synthetic-header set (e.g. Hips) shows if any of its rows is selected.
  function setSelected(items, sub, section) {
    if (ALWAYS_SHOW_SECTIONS[section] || ALWAYS_SHOW_SUBS[sub]) return true;
    if (SET_HEADERS[sub]) return items.some(function (r) { return isSelected(r.answer); });
    return items.length ? isSelected(items[0].answer) : false;
  }

  function noItemsLine(text) {
    return '<div class="px-5 py-3 text-sm text-stone-500">' + esc(text) + "</div>";
  }

  // BMI = weight(kg) / height(m)^2, from the raw assessment items. Height is in cm.
  function computeBMI(items) {
    let h = null, w = null;
    items.forEach(function (it) {
      const id = String(it.Id).toLowerCase();
      if (id === BMI_HEIGHT_ID) h = parseFloat(it.Answer);
      if (id === BMI_WEIGHT_ID) w = parseFloat(it.Answer);
    });
    if (!h || !w || h <= 0 || w <= 0) return null;
    const m = h / 100;
    return w / (m * m);
  }

  function assessmentCard(items) {
    // Resolve every item to its mapped metadata.
    const resolved = items.map(function (it) {
      const m = QUESTIONS[String(it.Id).toLowerCase()] || {};
      return {
        section: m.s || "Other",
        sub: m.sub || "_" + String(it.Id), // ungrouped items get a unique key
        order: typeof m.o === "number" ? m.o : 1e9,
        group: m.g || null,
        prompt: m.p || null,
        text: m.t || String(it.Id),
        answer: resolveAnswer(it.Answer),
      };
    });

    // Bucket by section.
    const bySection = {};
    resolved.forEach(function (r) { (bySection[r.section] = bySection[r.section] || []).push(r); });

    // Append a computed BMI row to the end of Basic Info (not present in JSON).
    const bmi = computeBMI(items);
    if (bmi != null && bySection["Basic Info"]) {
      const maxOrder = bySection["Basic Info"].reduce(function (mx, r) { return Math.max(mx, r.order); }, 0);
      bySection["Basic Info"].push({
        section: "Basic Info", sub: "_bmi", order: maxOrder + 1,
        group: null, prompt: null, text: "BMI", answer: bmi.toFixed(1),
      });
    }

    // Section order: SIM_SECTIONS first, then extras, "Other" last.
    const seen = {}, orderedSections = [];
    SECTIONS.forEach(function (s) { if (bySection[s]) { orderedSections.push(s); seen[s] = true; } });
    Object.keys(bySection).forEach(function (s) { if (!seen[s] && s !== "Other") orderedSections.push(s); });
    if (bySection["Other"]) orderedSections.push("Other");

    const sections = orderedSections.map(function (section, idx) {
      const rows = bySection[section].slice().sort(function (a, b) { return a.order - b.order; });

      // Split into consecutive subsection groups.
      const groups = [];
      let cur = null;
      rows.forEach(function (r) {
        if (!cur || cur.sub !== r.sub) { cur = { sub: r.sub, items: [] }; groups.push(cur); }
        cur.items.push(r);
      });

      // Build blocks: runs of standalone questions flow together; each multi-item
      // subsection is its own block. Blocks are divided by a stronger rule so a
      // set reads as grouped rows (lines above and below) — no accent or indent.
      const blocks = [];
      let run = null;
      groups.forEach(function (g) {
        const gi = mergeArthritis(g.items);
        if (gi.length === 1 && !gi[0].group && !gi[0].prompt) {
          if (!run) { run = []; blocks.push({ type: "run", items: run }); }
          run.push(gi[0]);
        } else {
          run = null;
          blocks.push({ type: "set", items: gi });
        }
      });
      // Render blocks, applying the "hide unselected" filter. Runs drop their
      // unselected rows; sets are shown or hidden as a whole (follow-ups follow
      // their parent). Zebra (ctx) only counts rows that actually render.
      const alwaysShowSection = !!ALWAYS_SHOW_SECTIONS[section];
      const ctx = { i: 0 };
      const parts = [];
      let anyVisible = false, anyNonExemptVisible = false, symptomsIdx = -1;

      blocks.forEach(function (b) {
        if (b.type === "run") {
          let its = b.items;
          if (hideUnselected && !alwaysShowSection) its = its.filter(function (r) { return isSelected(r.answer); });
          if (its.length === 0) return;
          parts.push(renderRunBlock(its, ctx));
          anyVisible = true; anyNonExemptVisible = true;
        } else {
          const its = b.items; // already arthritis-merged
          const sub = its.length ? its[0].sub : null;
          const exempt = !!(ALWAYS_SHOW_SUBS[sub] || alwaysShowSection);
          if (hideUnselected && !setSelected(its, sub, section)) return;
          if (ALWAYS_SHOW_SUBS[sub]) symptomsIdx = parts.length; // position of the symptoms set
          parts.push(renderSetBlock(its, ctx));
          anyVisible = true;
          if (!exempt) anyNonExemptVisible = true;
        }
      });

      // Summary line when a section's hideable rows collapse to nothing.
      if (hideUnselected && EMPTY_SECTION_LINE[section]) {
        if (section === "Medical conditions") {
          if (!anyNonExemptVisible) parts.splice(symptomsIdx >= 0 ? symptomsIdx : parts.length, 0, noItemsLine(EMPTY_SECTION_LINE[section]));
        } else if (!anyVisible) {
          parts.push(noItemsLine(EMPTY_SECTION_LINE[section]));
        }
      }

      const body = parts.length
        ? '<div class="divide-y divide-stone-100 border-b border-stone-100">' + parts.join("") + "</div>"
        : "";

      return (
        '<details class="group border border-stone-200"' + (idx === 0 ? " open" : "") + ">" +
        '<summary class="flex items-center gap-3 cursor-pointer px-5 py-4 bg-stone-50 hover:bg-stone-100 transition-colors select-none border-stone-200 group-open:border-b">' +
        '<span class="inline-block border-y-[5px] border-y-transparent border-l-[7px] border-l-stone-400 transition-transform group-open:rotate-90"></span>' +
        '<span class="text-base font-bold text-stone-900">' + esc(section) + "</span>" +
        '<span class="text-xs font-semibold text-stone-600 bg-stone-200 px-2 py-0.5">' + bySection[section].length + "</span>" +
        "</summary>" +
        body + "</details>"
      );
    }).join("");

    return (
      '<section class="bg-white border border-stone-200 shadow-sm p-8">' +
      '<div class="flex items-center justify-between gap-4 mb-1">' +
      '<h3 class="text-lg font-bold text-stone-900">Assessment answers</h3>' +
      '<label class="flex items-center gap-2 text-sm text-stone-600 cursor-pointer select-none shrink-0">' +
      '<input type="checkbox" id="sim-hide-unselected" class="w-4 h-4 accent-emerald-600 cursor-pointer"' + (hideUnselected ? " checked" : "") + ">" +
      "hide unselected</label></div>" +
      '<p class="text-sm text-stone-500 mb-5">' + items.length + " responses that shaped this prescription.</p>" +
      '<div class="space-y-3">' + sections + "</div></section>"
    );
  }

  // ---- Day selection (event delegation) ----------------------------------
  function selectDay(index, scrollToTop) {
    if (!activeData || !activeData.Prescription) return;
    const schedules = activeData.Prescription.DailySchedules;
    if (!Array.isArray(schedules) || !schedules[index]) return;
    const detail = document.getElementById("sim-day-detail");
    if (detail) detail.innerHTML = dayDetail(schedules[index], index);
    output.querySelectorAll(".sim-day-btn").forEach(function (btn) {
      const active = parseInt(btn.getAttribute("data-day"), 10) === index;
      btn.classList.toggle("bg-emerald-600", active);
      btn.classList.toggle("text-white", active);
      btn.classList.toggle("border-emerald-600", active);
    });
    // On an explicit day change, scroll the new day's list up to just below the
    // pinned strip so every day starts at Warm Up.
    if (scrollToTop && detail) {
      const nav = document.querySelector("nav");
      const strip = output.querySelector(".sim-day-strip");
      const offset = (nav ? nav.offsetHeight : 72) + (strip ? strip.offsetHeight : 0) + 12;
      const y = detail.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  }

  output.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    const dayBtn = e.target.closest("[data-day]");
    if (dayBtn) { selectDay(parseInt(dayBtn.getAttribute("data-day"), 10), true); return; }
    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) selectTab(tabBtn.getAttribute("data-tab"));
  });

  // "Hide unselected" checkbox — re-render the assessment panel, preserving
  // which sections were expanded.
  output.addEventListener("change", function (e) {
    if (!e.target || e.target.id !== "sim-hide-unselected") return;
    hideUnselected = e.target.checked;
    const panel = output.querySelector('[data-panel="assessment"]');
    if (!panel || !activeData || !Array.isArray(activeData.AssessmentDataItems)) return;
    const open = new Set();
    panel.querySelectorAll("details[open]").forEach(function (d) {
      const t = d.querySelector("summary span.text-base");
      if (t) open.add(t.textContent.trim());
    });
    panel.innerHTML = assessmentCard(activeData.AssessmentDataItems);
    panel.querySelectorAll("details").forEach(function (d) {
      const t = d.querySelector("summary span.text-base");
      if (t) d.open = open.has(t.textContent.trim());
    });
  });

  // ---- Wire up -----------------------------------------------------------
  fileInput.addEventListener("change", function () { handleFiles(this.files); this.value = ""; });
  fileSelect.addEventListener("change", function () { renderFile(parseInt(this.value, 10)); });
  clearBtn.addEventListener("click", function () { files.length = 0; rebuildSelector(); updateControls(); showEmptyState(); });

  updateControls();
})();
