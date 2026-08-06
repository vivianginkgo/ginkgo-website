/*
 * Ginkgo Assessment Builder
 * -------------------------
 * Renders a form for all assessment questions (from builder-data.js), handles
 * dependency show/hide, and generates the backend's assessment JSON — a bare
 * array of { Id, Answer } in the source order, every question present with its
 * default for anything untouched or hidden.
 */
(function () {
  "use strict";

  const QUESTIONS = window.BUILDER_QUESTIONS || [];
  const SECTIONS = window.BUILDER_SECTIONS || [];
  const DAY_OPTS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MIN_OPTS = [50, 100, 150, 200, 250, 300];

  // A footnote shown at the bottom of a section.
  const SECTION_NOTES = {
    "Training schedule": "Choose days based on the minutes per week: 50 = 1 - 3 days, 100 = 2 - 7 days, 150 or 200 = 3 - 7 days, 250 = 4 - 7 days, 300 = 5 - 7 days",
  };

  const byId = {};
  QUESTIONS.forEach(function (q) { byId[q.id] = q; });

  // Only the user's explicit picks live here; anything absent falls back to the
  // question's default. Days are stored as an array; everything else as a string.
  const answers = {};

  const form = document.getElementById("bld-form");
  const useridInput = document.getElementById("bld-userid");

  function esc(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ---- Answer / dependency computation -----------------------------------
  // A dependent question is active only when its parent is active AND the
  // parent's effective answer differs from the parent's default. Parents always
  // precede children (max depth 2), so this recursion is cheap and terminates.
  function isActive(q) {
    if (!q.dep) return true;
    const p = byId[q.dep];
    if (!p) return true;
    if (!isActive(p)) return false;
    return String(effective(p)) !== String(p.def);
  }

  // The output answer for a question — its default when hidden, otherwise the
  // user's pick (validated) or the default.
  function effective(q) {
    if (!isActive(q)) return q.def;
    const v = answers[q.id];
    if (q.type === "number") {
      if (v === undefined || v === "") return q.def;
      let n = parseInt(v, 10);
      if (isNaN(n)) return q.def;
      if (q.min != null && n < q.min) n = q.min;
      if (q.max != null && n > q.max) n = q.max;
      return String(n);
    }
    if (q.type === "days") {
      if (!Array.isArray(v) || v.length === 0) return q.def;
      return DAY_OPTS.filter(function (d) { return v.indexOf(d) !== -1; }).join(",");
    }
    if (v === undefined || v === "") return q.def; // sex / minutes / yesno
    return v;
  }

  // ---- Rendering ---------------------------------------------------------
  function control(q) {
    const v = answers[q.id];
    if (q.type === "number") {
      const cur = v !== undefined ? v : q.def;
      const bounds = (q.min != null ? 'min="' + q.min + '" ' : "") + (q.max != null ? 'max="' + q.max + '" ' : "");
      const unit = q.unit ? " " + esc(q.unit) : "";
      const hint = (q.min != null && q.max != null) ? '<span class="text-[11px] text-stone-400 ml-2 whitespace-nowrap">' + q.min + "–" + q.max + unit + "</span>" : "";
      return '<input type="number" data-qid="' + q.id + '" ' + bounds + 'value="' + esc(cur) +
        '" class="w-24 text-sm border border-stone-300 px-2 py-1 outline-none focus:border-emerald-500">' + hint;
    }
    if (q.type === "yesno") {
      const on = (v !== undefined ? v : q.def) === "Yes";
      return '<label class="inline-flex items-center gap-2 cursor-pointer text-sm text-stone-500">' +
        '<input type="checkbox" data-qid="' + q.id + '"' + (on ? " checked" : "") + ' class="accent-emerald-600 w-4 h-4"> Yes</label>';
    }
    if (q.type === "sex") {
      const cur = v !== undefined ? v : q.def;
      return ["Male", "Female"].map(function (o) {
        return '<label class="inline-flex items-center gap-1 cursor-pointer text-sm text-stone-600 mr-3">' +
          '<input type="radio" name="sex" data-qid="' + q.id + '" value="' + o + '"' + (cur === o ? " checked" : "") + ' class="accent-emerald-600"> ' + o + "</label>";
      }).join("");
    }
    if (q.type === "minutes") {
      const cur = v !== undefined ? v : "";
      return '<select data-qid="' + q.id + '" class="text-sm border border-stone-300 bg-white px-2 py-1 outline-none focus:border-emerald-500">' +
        '<option value=""' + (cur === "" ? " selected" : "") + ">Select…</option>" +
        MIN_OPTS.map(function (m) { return '<option value="' + m + '"' + (String(cur) === String(m) ? " selected" : "") + ">" + m + "</option>"; }).join("") +
        "</select>";
    }
    if (q.type === "days") {
      const sel = Array.isArray(v) ? v : [];
      return '<div class="flex flex-wrap gap-x-3 gap-y-1 mt-1">' + DAY_OPTS.map(function (d) {
        return '<label class="inline-flex items-center gap-1 cursor-pointer text-xs text-stone-600">' +
          '<input type="checkbox" data-qid="' + q.id + '" data-day="' + d + '"' + (sel.indexOf(d) !== -1 ? " checked" : "") + ' class="accent-emerald-600"> ' + d + "</label>";
      }).join("") + "</div>";
    }
    return "";
  }

  function questionRow(q) {
    if (q.type === "days") {
      return '<div class="bld-q py-2 border-b border-stone-100" data-qid="' + q.id + '">' +
        '<div class="text-sm text-stone-700">' + esc(q.text) + "</div>" + control(q) + "</div>";
    }
    return '<div class="bld-q flex items-center justify-between gap-4 py-2 border-b border-stone-100" data-qid="' + q.id + '">' +
      '<label class="text-sm text-stone-700 min-w-0">' + esc(q.text) + "</label>" +
      '<div class="shrink-0 flex items-center">' + control(q) + "</div></div>";
  }

  function render() {
    const bySection = {};
    QUESTIONS.forEach(function (q) { (bySection[q.section] = bySection[q.section] || []).push(q); });

    const html = SECTIONS.filter(function (s) { return bySection[s]; }).map(function (section, idx) {
      const qs = bySection[section];
      let body = "", lastPrompt = null;
      qs.forEach(function (q) {
        // Prompt sub-headers group a run of questions (e.g. knee pain locations).
        if (q.prompt && q.prompt !== lastPrompt) {
          const run = [];
          for (let j = qs.indexOf(q); j < qs.length && qs[j].prompt === q.prompt; j += 1) run.push(qs[j].id);
          body += '<p class="bld-prompt text-xs font-medium text-stone-500 mt-3 mb-1" data-qids="' + run.join(",") + '">' + esc(q.prompt) + "</p>";
          lastPrompt = q.prompt;
        }
        if (!q.prompt) lastPrompt = null;
        body += questionRow(q);
      });
      if (SECTION_NOTES[section]) {
        body += '<p class="text-xs text-stone-500 mt-4 pt-3 border-t border-stone-100">' + esc(SECTION_NOTES[section]) + "</p>";
      }
      return (
        '<details class="group border border-stone-200 mb-3" open>' +
        '<summary class="flex items-center gap-2 cursor-pointer px-5 py-3.5 bg-stone-50 hover:bg-stone-100 select-none">' +
        '<span class="inline-block border-y-[5px] border-y-transparent border-l-[7px] border-l-stone-400 transition-transform group-open:rotate-90"></span>' +
        '<span class="font-semibold text-stone-800">' + esc(section) + "</span></summary>" +
        '<div class="px-5 py-2">' + body + "</div></details>"
      );
    }).join("");

    form.innerHTML = html;
    updateVisibility();
  }

  function updateVisibility() {
    form.querySelectorAll(".bld-q").forEach(function (row) {
      const q = byId[row.getAttribute("data-qid")];
      row.classList.toggle("hidden", !isActive(q));
    });
    form.querySelectorAll(".bld-prompt").forEach(function (ph) {
      const ids = (ph.getAttribute("data-qids") || "").split(",");
      const anyActive = ids.some(function (id) { return byId[id] && isActive(byId[id]); });
      ph.classList.toggle("hidden", !anyActive);
    });
  }

  // ---- Events ------------------------------------------------------------
  function onChange(e) {
    const el = e.target;
    const qid = el.getAttribute && el.getAttribute("data-qid");
    if (!qid) return;
    const q = byId[qid];
    if (q.type === "yesno") answers[qid] = el.checked ? "Yes" : "No";
    else if (q.type === "days") {
      const sel = [];
      form.querySelectorAll('input[data-qid="' + qid + '"]').forEach(function (b) { if (b.checked) sel.push(b.getAttribute("data-day")); });
      answers[qid] = sel;
    } else if (q.type === "number") {
      answers[qid] = el.value;
      // Clamp to the range once the user leaves the field (not mid-typing).
      if (e.type === "change" && el.value !== "") {
        let n = parseInt(el.value, 10);
        if (!isNaN(n)) {
          if (q.min != null && n < q.min) n = q.min;
          if (q.max != null && n > q.max) n = q.max;
          if (String(n) !== el.value) { el.value = String(n); answers[qid] = String(n); }
        }
      }
    } else {
      answers[qid] = el.value; // minutes, sex, text
    }
    updateVisibility();
  }
  form.addEventListener("input", onChange);
  form.addEventListener("change", onChange);

  function download(text, name) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  document.getElementById("bld-generate").addEventListener("click", function () {
    const uid = useridInput.value.trim();
    const err = document.getElementById("bld-userid-error");
    if (!uid) { err.classList.remove("hidden"); useridInput.focus(); return; }
    err.classList.add("hidden");
    const out = QUESTIONS.map(function (q) { return { Id: q.id, Answer: effective(q) }; });
    download(JSON.stringify(out), uid + ".json");
  });

  document.getElementById("bld-reset").addEventListener("click", function () {
    Object.keys(answers).forEach(function (k) { delete answers[k]; });
    render();
  });

  render();
})();
