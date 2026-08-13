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
  const files = []; // { name, data|null, error|null, attrs }
  let activeData = null;
  let activeIndex = -1; // index into `files` currently being viewed
  let activeTab = "assessment"; // preserved across file switches
  let hideUnselected = true; // assessment "hide unselected" checkbox state
  const filterState = {}; // filterKey -> value ("" / "Yes" / "No" / {min,max} / text)
  let sortState = { col: "name", dir: 1 }; // file list sort
  let filtersOpen = false; // whether the Filters panel is expanded
  let fileSearch = ""; // filename search text
  let filePage = 0; // current page of the file list

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

  // Summary scores hidden from the overview panel.
  const HIDDEN_SUMMARY_SCORES = { Safety: true, Time: true };

  // ---- File filtering config ---------------------------------------------
  const Q_AGE = "183b3e5b-2341-4e6f-88fe-323c8f4701cb";
  const Q_SEX = "ab6d9072-a298-4954-9287-f22d3f3ce44f";
  const Q_PREGNANT_WEEKS = "c4a8b328-98e1-40b3-a09f-ace967f34de8";
  const Q_MINUTES = "1b455c25-c89b-42f8-9043-edeff82362ad";
  // Derived filter keys (not real question ids).
  const F_BMI = "_bmi";
  const F_PREGNANT = "_pregnant";
  // Questions never offered as filters: height/weight (represented by BMI), the
  // training-days picker, and the three questions that read as follow-ups.
  const FILTER_EXCLUDE_IDS = {};
  [
    BMI_HEIGHT_ID,
    BMI_WEIGHT_ID,
    "f1a0b5d4-2c3e-4b8c-9a6f-7d0e5f1a2b7b", // Choose {0}-{1} days you'd like to exercise
    "def92796-61da-4ca0-809f-b4dfaa4e74bd", // Does it hurt to raise your left arm?
    "60644586-5cfc-4558-a912-c51f457a7f0e", // Does it hurt to raise your right arm?
    "48dede34-2dea-4c93-914c-af6b0724f3ec", // Are you receiving cancer treatment?
    "a84856a8-1752-4c5e-aeaf-20928eff1647", // Fitness level
  ].forEach(function (id) { FILTER_EXCLUDE_IDS[id] = true; });
  // Weekly training minutes come in fixed steps.
  const MINUTES_OPTIONS = [50, 100, 150, 200, 250, 300];
  // Subsections (by number) that get their own sub-heading in the filter panel.
  const FILTER_SUBHEADINGS = { "5.17": "Symptoms" };
  // The hip questions share one subsection and collapse into a single filter.
  const HIPS_SUB = "4.18";

  // Fitness indicators questions we keep; the rest are dropped from the display.
  const Q_FIT_LEVEL = "a84856a8-1752-4c5e-aeaf-20928eff1647";
  const Q_LEFT_LEG_BAL = "ad7b1f79-ec38-4567-8683-254da0bf2e07";
  const Q_RIGHT_LEG_BAL = "b85b682e-465c-4e9b-972a-985d72845ad6";
  // Derived filter keys for the two fitness filters.
  const F_FITLEVEL = "_fitlevel";        // reads the "Fitness level" question
  const F_BALANCELEVEL = "_balancelevel"; // prescription SummaryResult.Balance (0–100)

  // Sections removed from the assessment display entirely.
  const ASSESSMENT_HIDE_SECTIONS = { Balance: true };
  // Sections whose questions are never offered as filters.
  const FILTER_EXCLUDE_SECTIONS = { Balance: true, "Fitness indicators": true };
  // Display-label overrides for the assessment panel (question id -> label).
  const ASSESSMENT_LABEL_OVERRIDES = {
    "f1a0b5d4-2c3e-4b8c-9a6f-7d0e5f1a2b7b": "Days per week",
  };

  // How many files to list per page.
  const FILE_PAGE_SIZE = 25;

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
  const filesPanel = document.getElementById("sim-files");
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

  function num(v) {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  // Round a slider's upper bound up to a clean number (83 -> 90, 29.3 -> 30).
  // Falls back to 10 so a field where every file reads 0 still gets a usable
  // slider rather than a degenerate 0–0 one.
  function niceCeil(v) {
    if (!v || v <= 0) return 10;
    if (v <= 10) return Math.ceil(v);
    if (v <= 50) return Math.ceil(v / 5) * 5;
    return Math.ceil(v / 10) * 10;
  }

  // ---- File attributes ---------------------------------------------------
  // Flatten one file's assessment answers into { byId, sex, age, bmi, pregnant }
  // so filtering and the file table can read them cheaply.
  function fileAttrs(data) {
    const byId = {};
    const items = data && Array.isArray(data.AssessmentDataItems) ? data.AssessmentDataItems : [];
    items.forEach(function (it) { byId[String(it.Id).toLowerCase()] = resolveAnswer(it.Answer); });
    const height = num(byId[BMI_HEIGHT_ID]);
    const weight = num(byId[BMI_WEIGHT_ID]);
    // Rounded to 1dp so filtering matches the value shown in the table.
    const rawBmi = height && weight && height > 0 ? weight / Math.pow(height / 100, 2) : null;
    const bmi = rawBmi == null ? null : Math.round(rawBmi * 10) / 10;
    const weeks = num(byId[Q_PREGNANT_WEEKS]);
    const sr = data && data.Prescription && data.Prescription.SummaryResult;
    const balanceLevel = sr && typeof sr.Balance === "number" ? sr.Balance : null;
    return {
      byId: byId,
      sex: byId[Q_SEX] != null ? String(byId[Q_SEX]) : "",
      age: num(byId[Q_AGE]),
      bmi: bmi,
      pregnant: weeks == null ? null : weeks > 0,
      balanceLevel: balanceLevel,
    };
  }

  // ---- Filter definitions ------------------------------------------------
  // Built from SIM_QUESTIONS: main questions only (answer-option children and
  // the excluded follow-ups are skipped), plus derived BMI and Pregnant.
  // Control type is inferred from the values present across loaded files.
  function buildFilterDefs() {
    const loaded = files.filter(function (f) { return f.data && f.attrs; });
    // Distinct answers, de-duplicated case-insensitively — files differ on
    // capitalisation (e.g. "female" vs "Female"), which would otherwise show up
    // as two separate options. The first letter is capitalised for display.
    const valuesFor = function (id) {
      const seen = {};
      loaded.forEach(function (f) {
        const v = f.attrs.byId[id];
        if (v === undefined || v === null || String(v).trim() === "") return;
        const raw = String(v).trim();
        const k = raw.toLowerCase();
        if (!seen[k]) seen[k] = raw.charAt(0).toUpperCase() + raw.slice(1);
      });
      return Object.keys(seen).map(function (k) { return seen[k]; });
    };

    const defs = [];
    Object.keys(QUESTIONS).forEach(function (id) {
      const m = QUESTIONS[id];
      if (m.g) return;                        // answer-option child ("follow-up")
      if (FILTER_EXCLUDE_IDS[id]) return;     // explicitly excluded
      if (FILTER_EXCLUDE_SECTIONS[m.s]) return; // whole section excluded
      if (id === Q_PREGNANT_WEEKS) return;    // replaced by derived Pregnant
      defs.push({ key: id, id: id, label: m.t, section: m.s, sub: m.sub,
        subsection: FILTER_SUBHEADINGS[m.sub] || null, order: m.o });
    });

    // Derived filters: BMI sits just after age, Pregnant just after sex.
    const ageOrder = (QUESTIONS[Q_AGE] || {}).o || 0;
    const sexOrder = (QUESTIONS[Q_SEX] || {}).o || ageOrder + 1;
    defs.push({ key: F_BMI, id: null, label: "BMI", section: "Basic Info", subsection: null, order: ageOrder + 0.1, type: "range" });
    defs.push({ key: F_PREGNANT, id: null, label: "Pregnant", section: "Basic Info", subsection: null, order: sexOrder + 0.1, type: "yesno" });
    // Fitness indicators keep only two filters: Fitness level and Balance level.
    defs.push({ key: F_FITLEVEL, id: Q_FIT_LEVEL, label: "Fitness level", section: "Fitness indicators", subsection: null, order: 12.0, type: "range" });
    defs.push({ key: F_BALANCELEVEL, id: null, label: "Balance level", section: "Fitness indicators", subsection: null, order: 12.1, type: "range" });

    defs.forEach(function (d) {
      if (d.type) return; // already fixed (derived)
      if (d.key === Q_AGE) { d.type = "range"; return; }
      if (d.key === Q_MINUTES) { d.type = "choice"; d.choices = MINUTES_OPTIONS.map(String); return; }
      const vals = valuesFor(d.id);
      const allYesNo = vals.length > 0 && vals.every(function (v) { return /^(yes|no)$/i.test(v.trim()); });
      const allNumeric = vals.length > 0 && vals.every(function (v) { return num(v) !== null; });
      if (allYesNo) d.type = "yesno";
      else if (allNumeric) d.type = d.section === "Injury report" ? "presence" : "range";
      else if (vals.length) { d.type = "choice"; d.choices = vals.sort(); }
      // No file carries this answer yet — fall back to the section's usual shape.
      else if (d.section === "Injury report") d.type = "presence";
      else if (d.section === "Fitness indicators") d.type = "range";
      else d.type = "yesno";
    });

    // Slider bounds for numeric filters: 0 up to the highest value across the
    // loaded files, rounded to a clean number. Recomputed whenever files change.
    defs.forEach(function (d) {
      if (d.type !== "range") return;
      let hi = 0;
      loaded.forEach(function (f) {
        const v = num(attrValue(f.attrs, d));
        if (v != null && v > hi) hi = v;
      });
      d.min = 0;
      d.max = niceCeil(hi);
      d.step = d.key === F_BMI ? 0.5 : 1;
    });

    const combined = combineInjuryDefs(defs);
    combined.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    return combined;
  }

  // Injury report reads better combined: Left/Right pairs become one filter with
  // Left / Right / Any, and the hip questions fold into a single "Hips" filter
  // with one option each. Questions with no side (Neck, Lower back…) stay as-is.
  function combineInjuryDefs(defs) {
    const injury = defs.filter(function (d) { return d.section === "Injury report"; });
    if (!injury.length) return defs;
    const out = defs.filter(function (d) { return d.section !== "Injury report"; });

    const cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    const hips = [], rest = [];
    injury.forEach(function (d) { (d.sub === HIPS_SUB ? hips : rest).push(d); });

    // Pair up "Left x" / "Right x" by their shared base name; anything without a
    // side stays a plain checkbox.
    const singles = [], pairDefs = [], pairs = {}, pairOrder = [];
    rest.forEach(function (d) {
      const m = /^(left|right)\s+(.+)$/i.exec(d.label || "");
      if (!m) { singles.push(d); return; }
      const side = m[1].toLowerCase(), base = m[2].trim().toLowerCase();
      if (!pairs[base]) { pairs[base] = { label: m[2].trim(), order: d.order, sides: {} }; pairOrder.push(base); }
      pairs[base].sides[side] = d;
      pairs[base].order = Math.min(pairs[base].order, d.order);
    });
    pairOrder.forEach(function (base) {
      const p = pairs[base], L = p.sides.left, R = p.sides.right;
      if (!L || !R) { if (L) singles.push(L); if (R) singles.push(R); return; } // unpaired
      pairDefs.push({
        key: "inj-" + base.replace(/\s+/g, "-"), id: null, label: cap(p.label),
        section: "Injury report", subsection: null, order: p.order, type: "group",
        options: [
          { v: "left", l: "Left", ids: [L.id] },
          { v: "right", l: "Right", ids: [R.id] },
        ],
      });
    });

    // Lay the section out in shape-consistent blocks: the plain checkboxes
    // first, then the Left/Right pairs, then Hips as its own subsection.
    let seq = injury.reduce(function (mn, d) { return Math.min(mn, d.order || 0); }, Infinity);
    singles.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    singles.forEach(function (d) { d.order = (seq += 0.001); d.block = "checks"; out.push(d); });
    pairDefs.forEach(function (d) { d.order = (seq += 0.001); d.block = "pairs"; out.push(d); });

    if (hips.length) {
      out.push({
        key: "inj-hips", id: null, label: "Hips", section: "Injury report",
        subsection: "Hips", hideLabel: true, order: (seq += 0.001), type: "group",
        options: hips.map(function (d) {
          // "Left side hip" -> "Left side" (the subsection is already Hips).
          const l = String(d.label).replace(/\bhips?\b/i, "").replace(/\s+/g, " ").trim();
          return { v: d.id, l: cap(l || d.label), ids: [d.id] };
        }),
      });
    }
    return out;
  }

  // The value a given filter reads off one file.
  function attrValue(attrs, d) {
    if (d.key === F_BMI) return attrs.bmi;
    if (d.key === F_PREGNANT) return attrs.pregnant == null ? null : (attrs.pregnant ? "Yes" : "No");
    if (d.key === F_BALANCELEVEL) return attrs.balanceLevel;
    return attrs.byId[d.id];
  }

  // Is a stored filter value actually constraining anything?
  function filterIsActive(v) {
    if (v === undefined || v === null || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return (v.min !== "" && v.min != null) || (v.max !== "" && v.max != null);
    return true;
  }

  // Does a file's attributes satisfy every active filter? Different filters AND
  // together; multiple selections within one filter OR together.
  function matchesFilters(attrs, defs) {
    return defs.every(function (d) {
      const state = filterState[d.key];
      if (!filterIsActive(state)) return true;
      const selected = Array.isArray(state) ? state : [state];

      // Combined injury filter: match if any question behind any selected
      // option has a non-zero value.
      if (d.type === "group") {
        return selected.some(function (v) {
          let opt = null;
          (d.options || []).forEach(function (o) { if (String(o.v) === String(v)) opt = o; });
          if (!opt) return false;
          return opt.ids.some(function (qid) {
            const n = num(attrs.byId[qid]);
            return n !== null && n !== 0;
          });
        });
      }

      const value = attrValue(attrs, d);

      if (d.type === "range") {
        if (typeof state !== "object") return true;
        const n = num(value);
        if (state.min !== "" && state.min != null && (n === null || n < Number(state.min))) return false;
        if (state.max !== "" && state.max != null && (n === null || n > Number(state.max))) return false;
        return true;
      }
      if (d.type === "presence") {
        const n = num(value);
        if (state === "none") return n === 0;
        if (state === "has") return n !== null && n !== 0;
        return true;
      }
      if (d.type === "yesno") {
        const s = value == null ? "" : String(value).trim().toLowerCase();
        return s === String(state).toLowerCase();
      }
      // choice — any selected value matches, compared case-insensitively since
      // files vary on capitalisation.
      if (value == null) return false;
      const v = String(value).trim().toLowerCase();
      return selected.some(function (s) { return v === String(s).trim().toLowerCase(); });
    });
  }

  function activeFilterCount() {
    return Object.keys(filterState).filter(function (k) { return filterIsActive(filterState[k]); }).length;
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
    for (const file of incoming) {
      const entry = await readFile(file);
      if (entry.data) entry.attrs = fileAttrs(entry.data);
      files.push(entry);
    }
    // Select the first newly-added file that is valid and passes the filters.
    const defs = buildFilterDefs();
    let selectIndex = -1;
    for (let i = firstNewIndex; i < files.length; i += 1) {
      if (!files[i].error && matchesFilters(files[i].attrs, defs)) { selectIndex = i; break; }
    }
    if (selectIndex === -1) {
      const visible = visibleIndexes(defs);
      selectIndex = visible.length ? visible[0] : firstNewIndex;
    }
    renderFilesPanel();
    selectFile(selectIndex);
    updateControls();
  }

  function updateControls() {
    clearBtn.disabled = files.length === 0;
  }

  // Indexes of files passing the current filters, in current sort order.
  function visibleIndexes(defs) {
    const idx = [];
    files.forEach(function (f, i) {
      if (f.error) return;              // errored files are listed separately
      if (matchesFilters(f.attrs, defs)) idx.push(i);
    });
    const dir = sortState.dir;
    idx.sort(function (a, b) {
      const fa = files[a], fb = files[b];
      let va, vb;
      if (sortState.col === "name") { va = fa.name.toLowerCase(); vb = fb.name.toLowerCase(); }
      else if (sortState.col === "sex") { va = (fa.attrs.sex || "").toLowerCase(); vb = (fb.attrs.sex || "").toLowerCase(); }
      else { va = fa.attrs[sortState.col]; vb = fb.attrs[sortState.col]; } // age | bmi
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // blanks last regardless of direction
      if (vb == null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return idx;
  }

  // ---- Files panel (filters + file list) ---------------------------------
  // The filter controls are rendered once and then left alone; only the results
  // (counts, badges, file list) refresh as filters change. That stops the panel
  // collapsing and keeps the caret in a field while you type.
  // Multi-select checkbox group. Selections OR together; nothing ticked means no
  // filter (so ticking every option is the same as leaving them all clear).
  function checkGroup(key, opts, cur) {
    const sel = Array.isArray(cur) ? cur : (cur == null || cur === "" ? [] : [cur]);
    return '<div class="flex flex-wrap items-center gap-x-3 gap-y-1">' +
      opts.map(function (o) {
        return '<label class="inline-flex items-center gap-1 text-xs text-stone-600 cursor-pointer">' +
          '<input type="checkbox" data-filter="' + esc(key) + '" data-multi="1" value="' + esc(o.v) + '"' +
          (sel.indexOf(o.v) !== -1 ? " checked" : "") + ' class="accent-emerald-600"> ' + esc(o.l) + "</label>";
      }).join("") + "</div>";
  }

  function filterControl(d) {
    const st = filterState[d.key];
    if (d.type === "range") {
      // Two stacked native range inputs. A handle parked at either end means
      // "unbounded", so a later file beyond the current max still matches.
      const top = d.max != null ? d.max : 100;
      const step = d.step || 1;
      const lo = st && st.min !== "" && st.min != null ? Math.max(0, Math.min(Number(st.min), top)) : 0;
      const hi = st && st.max !== "" && st.max != null ? Math.max(lo, Math.min(Number(st.max), top)) : top;
      const pct = function (v) { return top > 0 ? (v / top) * 100 : 0; };
      const inp = function (bound, value) {
        return '<input type="range" class="sim-range-input" data-filter="' + esc(d.key) + '" data-bound="' + bound +
          '" min="0" max="' + top + '" step="' + step + '" value="' + value + '">';
      };
      return (
        '<div data-range="' + esc(d.key) + '">' +
        '<div class="relative h-5 flex items-center">' +
        '<div class="absolute inset-x-0 h-1 bg-stone-200"></div>' +
        '<div class="absolute h-1 bg-emerald-500" data-range-fill style="left:' + pct(lo) + "%;width:" + (pct(hi) - pct(lo)) + '%"></div>' +
        inp("min", lo) + inp("max", hi) +
        "</div>" +
        '<div class="text-[11px] text-stone-500" data-range-readout>' + lo + " &ndash; " + hi + (hi >= top ? "+" : "") + "</div>" +
        "</div>"
      );
    }
    if (d.type === "group") {
      return checkGroup(d.key, (d.options || []).map(function (o) { return { v: o.v, l: o.l }; }), st);
    }
    return checkGroup(d.key, (d.choices || []).map(function (c) { return { v: c, l: c }; }), st);
  }

  // One grid cell per filter. Yes/No and injury filters collapse to a single
  // inline checkbox — ticked means Yes (or "has an injury value above 0"),
  // unticked means Any — which saves a lot of space.
  function filterCell(d) {
    if (d.type === "yesno" || d.type === "presence") {
      const val = d.type === "presence" ? "has" : "Yes";
      const on = filterState[d.key] === val;
      return '<label class="flex items-start gap-2 text-xs text-stone-600 cursor-pointer py-0.5">' +
        '<input type="checkbox" data-filter="' + esc(d.key) + '" value="' + val + '"' + (on ? " checked" : "") +
        ' class="accent-emerald-600 mt-0.5 shrink-0"><span>' + esc(d.label) + "</span></label>";
    }
    // hideLabel: the def already sits under a matching subsection heading.
    if (d.hideLabel) return "<div>" + filterControl(d) + "</div>";
    return '<div><label class="block text-xs font-medium text-stone-500 mb-1">' + esc(d.label) + "</label>" + filterControl(d) + "</div>";
  }

  function renderFilesPanel() {
    if (files.length === 0) { filesPanel.innerHTML = ""; return; }
    const defs = buildFilterDefs();

    // Group filters by section, in the assessment section order.
    const bySection = {};
    defs.forEach(function (d) { (bySection[d.section] = bySection[d.section] || []).push(d); });
    const order = [];
    SECTIONS.forEach(function (s) { if (bySection[s]) order.push(s); });
    Object.keys(bySection).forEach(function (s) { if (order.indexOf(s) === -1) order.push(s); });

    const grid = function (list) {
      return '<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">' + list.map(filterCell).join("") + "</div>";
    };
    // Defs carrying a `block` marker get their own grid, so each grid holds one
    // shape of control (all checkboxes, or all radio groups) and lines up neatly.
    const gridBlocks = function (list) {
      const blocks = [];
      let cur = null;
      list.forEach(function (d) {
        const name = d.block || "";
        if (!cur || cur.name !== name) { cur = { name: name, items: [] }; blocks.push(cur); }
        cur.items.push(d);
      });
      return blocks.map(function (b, i) {
        return i ? '<div class="mt-3">' + grid(b.items) + "</div>" : grid(b.items);
      }).join("");
    };

    const groups = order.map(function (section) {
      const ds = bySection[section];
      // Split off any labelled subsections (e.g. Symptoms) so they get their own
      // sub-heading instead of running on from the rest of the section.
      const main = ds.filter(function (d) { return !d.subsection; });
      const subNames = [], subBuckets = {};
      ds.forEach(function (d) {
        if (!d.subsection) return;
        if (!subBuckets[d.subsection]) { subBuckets[d.subsection] = []; subNames.push(d.subsection); }
        subBuckets[d.subsection].push(d);
      });
      let body = main.length ? gridBlocks(main) : "";
      subNames.forEach(function (name) {
        body += '<h5 class="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mt-4 mb-2">' + esc(name) + "</h5>" + grid(subBuckets[name]);
      });
      return (
        "<div>" +
        '<h4 class="text-xs font-bold uppercase tracking-wide text-stone-400 mb-2 pb-1 border-b border-stone-100">' +
        esc(section) + ' <span data-badge="' + esc(section) + '" class="ml-1 font-semibold text-emerald-700"></span></h4>' +
        body + "</div>"
      );
    }).join("");

    filesPanel.innerHTML =
      '<section class="bg-white border border-stone-200 shadow-sm p-6 mb-8">' +
      '<div class="flex items-center justify-between gap-4 mb-4">' +
      '<h3 class="text-lg font-bold text-stone-900">Files</h3>' +
      '<div class="flex items-center gap-3 text-sm text-stone-500">' +
      '<span id="sim-showing"></span>' +
      '<button type="button" id="sim-clear-filters" class="text-sm font-semibold text-emerald-700 hover:text-emerald-800 hidden"></button>' +
      "</div></div>" +
      '<details id="sim-filters" class="group border border-stone-200 mb-5"' + (filtersOpen ? " open" : "") + ">" +
      '<summary class="flex items-center gap-2 cursor-pointer px-4 py-2.5 bg-stone-50 hover:bg-stone-100 select-none">' +
      '<span class="inline-block border-y-[5px] border-y-transparent border-l-[7px] border-l-stone-400 transition-transform group-open:rotate-90"></span>' +
      '<span class="text-sm font-semibold text-stone-800">Filters</span>' +
      '<span id="sim-filter-count" class="text-xs text-stone-400"></span></summary>' +
      '<div class="p-4 space-y-5">' + groups + "</div></details>" +
      '<div class="mb-3">' +
      '<input id="sim-file-search" type="text" placeholder="Search file names…" value="' + esc(fileSearch) + '" ' +
      'class="w-full sm:w-72 text-sm border border-stone-300 px-3 py-1.5 outline-none focus:border-emerald-500">' +
      "</div>" +
      '<div id="sim-file-list"></div></section>';

    updateFilesResults();
  }

  // Refresh only what depends on filters / search / sort / selection.
  function updateFilesResults() {
    if (files.length === 0) return;
    const defs = buildFilterDefs();
    const visible = visibleIndexes(defs);
    // Filename search narrows the list only (it doesn't change which file is viewed).
    const q = fileSearch.trim().toLowerCase();
    const matched = q ? visible.filter(function (i) { return files[i].name.toLowerCase().indexOf(q) !== -1; }) : visible;
    const totalValid = files.filter(function (f) { return !f.error; }).length;
    const errored = files.filter(function (f) { return f.error; });
    const activeCount = activeFilterCount();

    // Paginate.
    const totalPages = Math.max(1, Math.ceil(matched.length / FILE_PAGE_SIZE));
    if (filePage >= totalPages) filePage = totalPages - 1;
    if (filePage < 0) filePage = 0;
    const pageStart = filePage * FILE_PAGE_SIZE;
    const pageItems = matched.slice(pageStart, pageStart + FILE_PAGE_SIZE);

    const showing = document.getElementById("sim-showing");
    if (showing) showing.textContent = "Showing " + matched.length + " of " + totalValid;

    const clearEl = document.getElementById("sim-clear-filters");
    if (clearEl) {
      clearEl.textContent = "Clear filters (" + activeCount + ")";
      clearEl.classList.toggle("hidden", activeCount === 0);
    }
    const countEl = document.getElementById("sim-filter-count");
    if (countEl) countEl.textContent = activeCount ? activeCount + " active" : "";

    // Per-section active counts.
    filesPanel.querySelectorAll("[data-badge]").forEach(function (el) {
      const section = el.getAttribute("data-badge");
      const n = defs.filter(function (d) {
        return d.section === section && filterIsActive(filterState[d.key]);
      }).length;
      el.textContent = n ? "(" + n + ")" : "";
    });

    // File list — filename only, so selecting one can't reflow other columns.
    const listEl = document.getElementById("sim-file-list");
    if (!listEl) return;
    const arrow = sortState.dir === 1 ? "▲" : "▼";
    const rows = pageItems.map(function (i) {
      const on = i === activeIndex;
      return '<div data-file="' + i + '" class="flex items-center justify-between gap-2 px-4 py-2 text-sm cursor-pointer border-t border-stone-100 ' +
        (on ? "bg-emerald-50 font-semibold text-emerald-800" : "text-stone-800 hover:bg-stone-50") + '">' +
        '<span class="truncate">' + esc(files[i].name) + "</span>" +
        '<button type="button" data-remove="' + i + '" title="Remove this file" aria-label="Remove ' + esc(files[i].name) + '" ' +
        'class="shrink-0 w-5 h-5 leading-none flex items-center justify-center text-stone-400 hover:text-red-600 hover:bg-red-50">&times;</button>' +
        "</div>";
    }).join("");
    const btn = 'class="px-3 py-1 text-sm font-semibold border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"';
    const pager = totalPages > 1
      ? '<div class="flex items-center justify-between gap-2 px-4 py-2 border-t border-stone-200 text-sm bg-stone-50">' +
        '<button type="button" data-page="prev" ' + (filePage === 0 ? "disabled " : "") + btn + ">Prev</button>" +
        '<span class="text-stone-500">Page ' + (filePage + 1) + " of " + totalPages + "</span>" +
        '<button type="button" data-page="next" ' + (filePage >= totalPages - 1 ? "disabled " : "") + btn + ">Next</button>" +
        "</div>"
      : "";
    listEl.innerHTML =
      (matched.length
        ? '<div class="border border-stone-200">' +
          '<div data-sort="name" class="px-4 py-2 bg-stone-50 text-sm font-semibold text-stone-500 cursor-pointer select-none hover:text-stone-800">File <span class="text-emerald-600">' + arrow + "</span></div>" +
          rows + pager + "</div>"
        : '<p class="text-sm text-stone-500 border border-dashed border-stone-300 px-4 py-6 text-center">No files match' + (q ? " your search" : " the current filters") + ".</p>") +
      (errored.length
        ? '<p class="text-xs text-red-600 mt-3">' + errored.length + " file(s) couldn't be read: " + esc(errored.map(function (f) { return f.name; }).join(", ")) + "</p>"
        : "");
  }

  function resetFilterControls() {
    filesPanel.querySelectorAll("[data-filter]").forEach(function (el) {
      if (el.type === "checkbox" || el.type === "radio") el.checked = false;
      else if (el.type === "range") el.value = el.getAttribute("data-bound") === "min" ? el.min : el.max;
      else el.value = "";
    });
    filesPanel.querySelectorAll("[data-range]").forEach(function (w) { syncRange(w); });
  }

  // Select a file to view (and keep the list highlight in sync).
  function selectFile(index) {
    activeIndex = index;
    renderFile(index);
    updateFilesResults();
  }

  // Drop one file from the list. Indexes shift, and the slider bounds are
  // derived from the loaded set, so the whole panel is rebuilt afterwards.
  function removeFile(index) {
    if (index < 0 || index >= files.length) return;
    files.splice(index, 1);
    if (activeIndex === index) activeIndex = -1;
    else if (activeIndex > index) activeIndex -= 1;

    if (files.length === 0) {
      activeIndex = -1;
      activeData = null;
      renderFilesPanel();
      updateControls();
      showEmptyState();
      return;
    }

    renderFilesPanel();
    const visible = visibleIndexes(buildFilterDefs());
    if (visible.indexOf(activeIndex) === -1) {
      if (visible.length) {
        selectFile(visible[0]);
      } else {
        activeIndex = -1;
        activeData = null;
        output.innerHTML =
          '<div class="text-center py-16 px-6 bg-white border border-dashed border-stone-300">' +
          '<p class="text-stone-500 font-medium">No files match the current filters.</p></div>';
      }
    }
    updateControls();
  }

  // Re-apply filters after a control changes; keep the viewed file if it still
  // matches, otherwise fall back to the first visible one.
  function onFiltersChanged() {
    filePage = 0; // a changed filter set makes the old page number meaningless
    const defs = buildFilterDefs();
    const visible = visibleIndexes(defs);
    if (visible.indexOf(activeIndex) === -1) {
      if (visible.length) { selectFile(visible[0]); return; }
      activeIndex = -1;
      activeData = null;
      output.innerHTML =
        '<div class="text-center py-16 px-6 bg-white border border-dashed border-stone-300">' +
        '<p class="text-stone-500 font-medium">No files match the current filters.</p></div>';
    }
    updateFilesResults();
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
    return (
      '<section class="bg-white border border-stone-200 shadow-sm p-8 mb-6">' +
      '<h2 class="text-xl font-bold text-stone-900 leading-tight">' + esc(data.UserId || "Simulation result") + "</h2>" +
      '<p class="text-sm text-stone-500 mb-6">Personalized exercise prescription</p>' +
      '<dl class="grid grid-cols-2 sm:grid-cols-3 gap-5">' +
      statBlock("Program length", esc(days) + " days") +
      statBlock("Begins", esc(formatDate(p.BeginDate))) +
      statBlock("Last modified", esc(formatDate(p.ModifiedAt))) +
      "</dl></section>"
    );
  }

  // ---- Summary scores ----------------------------------------------------
  function summaryCard(summary) {
    const order = ["Fitness", "Intensity", "Difficulty", "Balance"];
    const keys = order
      .filter((k) => k in summary)
      .concat(Object.keys(summary).filter((k) => order.indexOf(k) === -1 && !HIDDEN_SUMMARY_SCORES[k]));
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
      '<li class="bg-stone-50 px-4 py-3 border border-stone-100">' +
      '<p class="text-sm font-medium text-stone-800">' + esc(ex.Name || "Exercise #" + (ex.Id != null ? ex.Id : "?")) + sideBadge + "</p>" +
      tags + "</li>"
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
      const id = String(it.Id).toLowerCase();
      const m = QUESTIONS[id] || {};
      return {
        id: id,
        section: m.s || "Other",
        sub: m.sub || "_" + id, // ungrouped items get a unique key
        order: typeof m.o === "number" ? m.o : 1e9,
        group: m.g || null,
        prompt: m.p || null,
        text: ASSESSMENT_LABEL_OVERRIDES[id] || m.t || String(it.Id),
        answer: resolveAnswer(it.Answer),
      };
    });

    // Bucket by section, dropping sections that are hidden from the display.
    const bySection = {};
    resolved.forEach(function (r) {
      if (ASSESSMENT_HIDE_SECTIONS[r.section]) return;
      (bySection[r.section] = bySection[r.section] || []).push(r);
    });

    // Fitness indicators: keep only "Fitness level", then "MET value" and a
    // "Balance level" set with the leg balances as its sub-values. MET value and
    // Balance level are computed prescription figures, not assessment answers.
    if (bySection["Fitness indicators"]) {
      const fit = bySection["Fitness indicators"];
      const rowFor = function (qid) { return fit.filter(function (r) { return r.id === qid; })[0]; };
      const fitLevel = rowFor(Q_FIT_LEVEL);
      const left = rowFor(Q_LEFT_LEG_BAL);
      const right = rowFor(Q_RIGHT_LEG_BAL);
      const sr = activeData && activeData.Prescription && activeData.Prescription.SummaryResult;
      const bal = sr && typeof sr.Balance === "number" ? sr.Balance : null;
      const met = activeData && activeData.Prescription && activeData.Prescription.MetabolicEquivalentOfTaskResult;
      const metValue = met && typeof met.PrescriptionAverageMETValue === "number" ? met.PrescriptionAverageMETValue : null;
      const rebuilt = [];
      if (fitLevel) { fitLevel.order = 1; fitLevel.sub = "3.fit"; fitLevel.group = null; fitLevel.prompt = null; rebuilt.push(fitLevel); }
      if (metValue != null) {
        rebuilt.push({ id: null, section: "Fitness indicators", sub: "3.met", order: 1.5, group: null, prompt: null, text: "MET value", answer: metValue.toFixed(1) });
      }
      const legs = [];
      [left, right].forEach(function (r, i) {
        if (!r) return;
        r.order = 3 + i; r.group = null; r.prompt = null;
        r.sub = bal != null ? "3.bal" : "3.leg" + i; // grouped under Balance level when we have a score
        legs.push(r);
      });
      if (bal != null && legs.length) {
        rebuilt.push({ id: null, section: "Fitness indicators", sub: "3.bal", order: 2, group: null, prompt: null, text: "Balance level", answer: bal });
      }
      legs.forEach(function (r) { rebuilt.push(r); });
      bySection["Fitness indicators"] = rebuilt;
    }

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

      // Section badge counts only "selected" answers (anything that isn't No or
      // 0), counted on the post-merge items so arthritis pain values count once.
      const selectedCount = blocks.reduce(function (n, b) {
        return n + b.items.filter(function (r) { return isSelected(r.answer); }).length;
      }, 0);

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
        '<span class="text-xs font-semibold text-stone-600 bg-stone-200 px-2 py-0.5">' + selectedCount + "</span>" +
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

  // ---- Files panel events ------------------------------------------------
  // Filter controls: selects fire "change", number inputs fire "input".
  // Keep the two handles from crossing, then repaint the fill and readout.
  function syncRange(wrap, moved) {
    const mn = wrap.querySelector('[data-bound="min"]');
    const mx = wrap.querySelector('[data-bound="max"]');
    if (!mn || !mx) return;
    let lo = Number(mn.value), hi = Number(mx.value);
    if (lo > hi) {
      if (moved === mn) { hi = lo; mx.value = String(hi); }
      else { lo = hi; mn.value = String(lo); }
    }
    const top = Number(mn.max) || 1;
    const fill = wrap.querySelector("[data-range-fill]");
    if (fill) {
      fill.style.left = (lo / top) * 100 + "%";
      fill.style.width = ((hi - lo) / top) * 100 + "%";
    }
    const out = wrap.querySelector("[data-range-readout]");
    if (out) out.textContent = lo + " – " + hi + (hi >= top ? "+" : "");
  }

  function readFilterControl(el) {
    const key = el.getAttribute("data-filter");
    const bound = el.getAttribute("data-bound");
    if (bound) {
      const wrap = el.closest ? el.closest("[data-range]") : null;
      if (wrap) {
        const mn = wrap.querySelector('[data-bound="min"]');
        const mx = wrap.querySelector('[data-bound="max"]');
        const lo = Number(mn.value), hi = Number(mx.value), top = Number(mn.max);
        // Handles parked at either end mean "no bound on that side".
        filterState[key] = { min: lo <= 0 ? "" : lo, max: hi >= top ? "" : hi };
        return;
      }
      const cur = typeof filterState[key] === "object" && filterState[key] && !Array.isArray(filterState[key])
        ? filterState[key] : { min: "", max: "" };
      cur[bound] = el.value;
      filterState[key] = cur;
      return;
    }
    if (el.getAttribute("data-multi")) {
      const sel = [];
      filesPanel.querySelectorAll('input[data-filter="' + key + '"][data-multi]').forEach(function (x) {
        if (x.checked) sel.push(x.value);
      });
      if (sel.length) filterState[key] = sel; else delete filterState[key];
      return;
    }
    if (el.type === "checkbox") {
      if (el.checked) filterState[key] = el.value; else delete filterState[key];
      return;
    }
    filterState[key] = el.value;
  }

  filesPanel.addEventListener("change", function (e) {
    const el = e.target.closest ? e.target.closest("[data-filter]") : null;
    if (!el) return;
    readFilterControl(el);
    onFiltersChanged();
  });

  // Sliders fire continuously while dragging: repaint immediately, but debounce
  // the (more expensive) re-filter so the list doesn't thrash.
  let rangeTimer = null;
  let searchTimer = null;
  filesPanel.addEventListener("input", function (e) {
    if (e.target && e.target.id === "sim-file-search") {
      fileSearch = e.target.value;
      filePage = 0;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(updateFilesResults, 120);
      return;
    }
    const el = e.target.closest ? e.target.closest("[data-filter][data-bound]") : null;
    if (!el) return;
    const wrap = el.closest("[data-range]");
    if (wrap) syncRange(wrap, el);
    readFilterControl(el);
    clearTimeout(rangeTimer);
    rangeTimer = setTimeout(onFiltersChanged, 120);
  });

  filesPanel.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    if (e.target.closest("#sim-clear-filters")) {
      Object.keys(filterState).forEach(function (k) { delete filterState[k]; });
      resetFilterControls();
      onFiltersChanged();
      return;
    }
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) {
      filePage += pageBtn.getAttribute("data-page") === "next" ? 1 : -1;
      updateFilesResults();
      return;
    }
    const th = e.target.closest("[data-sort]");
    if (th) {
      const col = th.getAttribute("data-sort");
      if (sortState.col === col) sortState.dir *= -1;
      else sortState = { col: col, dir: 1 };
      updateFilesResults();
      return;
    }
    // Checked before the row itself so the × doesn't also select the file.
    const rm = e.target.closest("[data-remove]");
    if (rm) { removeFile(parseInt(rm.getAttribute("data-remove"), 10)); return; }
    const row = e.target.closest("[data-file]");
    if (row) selectFile(parseInt(row.getAttribute("data-file"), 10));
  });

  // Remember whether the Filters panel is open so rebuilds keep it that way.
  filesPanel.addEventListener("toggle", function (e) {
    if (e.target && e.target.id === "sim-filters") filtersOpen = e.target.open;
  }, true);

  // ---- Wire up -----------------------------------------------------------
  fileInput.addEventListener("change", function () { handleFiles(this.files); this.value = ""; });
  clearBtn.addEventListener("click", function () {
    files.length = 0;
    activeIndex = -1;
    fileSearch = "";
    filePage = 0;
    Object.keys(filterState).forEach(function (k) { delete filterState[k]; });
    renderFilesPanel();
    updateControls();
    showEmptyState();
  });

  updateControls();
})();
