/* Certificate Generator — Grist custom widget
 * Reads a selected row from a connected Grist table, overlays the mapped
 * values onto a user-supplied certificate template image, and exports a PDF/PNG.
 */

(function () {
  "use strict";

  var DEMO = new URLSearchParams(location.search).has("demo");

  if (window["pdfjs-dist/build/pdf"]) {
    window["pdfjs-dist/build/pdf"].GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  var FIELD_DEFS = [
    { key: "EngineerName", title: "Engineer Name", type: "Text", optional: false, kind: "text" },
    { key: "CourseName", title: "Course / Qualification", type: "Text", optional: false, kind: "text" },
    { key: "CertificateNumber", title: "Certificate Number", type: "Text", optional: true, kind: "text" },
    { key: "IssueDate", title: "Issue Date", type: "Any", optional: true, kind: "text" },
    { key: "ExpiryDate", title: "Expiry Date", type: "Any", optional: true, kind: "text" },
    { key: "Instructor", title: "Instructor / Signatory", type: "Text", optional: true, kind: "text" },
    { key: "Organization", title: "Training Organization", type: "Text", optional: true, kind: "text" },
    { key: "RegulationBasis", title: "Regulation Basis", type: "Text", optional: true, kind: "text" }
  ];

  // Computed overlays: not sourced from a mapped Grist column — derived from the
  // record + a tamper-evident hash, for compliance verification.
  var COMPUTED_FIELD_DEFS = [
    { key: "QRCode", title: "Verification QR Code", kind: "qr", computed: true },
    { key: "AuditTrail", title: "Audit Trail Stamp", kind: "text", computed: true }
  ];

  var ALL_FIELD_DEFS = FIELD_DEFS.concat(COMPUTED_FIELD_DEFS);

  var DEFAULT_FIELD_STYLE = {
    EngineerName: { x: 50, y: 38, fontSize: 46, color: "#10233d", align: "center", weight: "700", font: "Fraunces, Georgia, serif", visible: true },
    CourseName: { x: 50, y: 50, fontSize: 20, color: "#33404f", align: "center", weight: "600", font: "Inter, Arial, sans-serif", visible: true },
    Organization: { x: 50, y: 58, fontSize: 13, color: "#667085", align: "center", weight: "400", font: "Inter, Arial, sans-serif", visible: true },
    IssueDate: { x: 22, y: 86, fontSize: 13, color: "#1a2330", align: "center", weight: "500", font: "Inter, Arial, sans-serif", visible: true },
    ExpiryDate: { x: 22, y: 91, fontSize: 11, color: "#667085", align: "center", weight: "400", font: "Inter, Arial, sans-serif", visible: true },
    Instructor: { x: 78, y: 86, fontSize: 13, color: "#1a2330", align: "center", weight: "500", font: "Inter, Arial, sans-serif", visible: true },
    RegulationBasis: { x: 50, y: 96, fontSize: 9, color: "#98a2b3", align: "center", weight: "400", font: "Inter, Arial, sans-serif", visible: true },
    CertificateNumber: { x: 88, y: 6, fontSize: 10, color: "#98a2b3", align: "right", weight: "500", font: "'Courier New', monospace", visible: true },
    QRCode: { x: 91, y: 84, size: 130, moduleColor: "#10233d", bgColor: "#ffffff", visible: true },
    AuditTrail: { x: 50, y: 99, fontSize: 8, color: "#98a2b3", align: "center", weight: "400", font: "'Courier New', monospace", visible: true }
  };

  var DEMO_RECORD = {
    EngineerName: "Jordan A. Mitchell",
    CourseName: "Part-66 Category B1.1 — Turbine Aeroplane",
    CertificateNumber: "CAA-B11-2026-0417",
    IssueDate: Math.floor(new Date("2026-06-15").getTime() / 1000),
    ExpiryDate: Math.floor(new Date("2029-06-15").getTime() / 1000),
    Instructor: "Gary Luke",
    Organization: "Skyline Aviation Training Ltd.",
    RegulationBasis: "UK CAA Part-66 / Part-147 Compliant"
  };

  // Sample rows for exercising batch generation in demo mode (?demo=1) without
  // a connected Grist table. __rowId mirrors the Grist row id used to key the
  // audit hash / QR payload per certificate.
  var DEMO_RECORDS = [
    Object.assign({ __rowId: 1 }, DEMO_RECORD),
    {
      __rowId: 2, EngineerName: "Amara Chen", CourseName: "Part-66 Category B2 — Avionics",
      CertificateNumber: "EASA-B2-2026-0091", IssueDate: Math.floor(new Date("2026-05-02").getTime() / 1000),
      ExpiryDate: Math.floor(new Date("2029-05-02").getTime() / 1000), Instructor: "Priya Shah",
      Organization: "Skyline Aviation Training Ltd.", RegulationBasis: "EASA Part-66 / Part-147 Compliant"
    },
    {
      __rowId: 3, EngineerName: "Dmitri Kowalski", CourseName: "Part-66 Category A — Mechanical",
      CertificateNumber: "DUAL-A-2026-0212", IssueDate: Math.floor(new Date("2026-04-18").getTime() / 1000),
      ExpiryDate: Math.floor(new Date("2029-04-18").getTime() / 1000), Instructor: "Gary Luke",
      Organization: "Northbridge Technical College", RegulationBasis: "EASA/CAA Dual Approval"
    },
    {
      __rowId: 4, EngineerName: "Fatima Al-Rashid", CourseName: "Part-66 Category B1.3 — Turbine Helicopter",
      CertificateNumber: "CAA-B13-2026-0355", IssueDate: Math.floor(new Date("2026-07-09").getTime() / 1000),
      ExpiryDate: Math.floor(new Date("2029-07-09").getTime() / 1000), Instructor: "Priya Shah",
      Organization: "Northbridge Technical College", RegulationBasis: "UK CAA Part-66 Compliant"
    },
    {
      __rowId: 5, EngineerName: "Owen Fitzgerald", CourseName: "Human Factors Recurrent",
      CertificateNumber: "REC-2026-1180", IssueDate: Math.floor(new Date("2026-08-01").getTime() / 1000),
      ExpiryDate: Math.floor(new Date("2029-08-01").getTime() / 1000), Instructor: "Gary Luke",
      Organization: "Skyline Aviation Training Ltd.", RegulationBasis: "N/A"
    }
  ];

  // Three independently-managed background slots. "default" is the fallback
  // used whenever a record's Regulation Basis text doesn't clearly match
  // EASA or CAA (or when the matching slot has no upload of its own).
  var SLOTS = ["default", "easa", "caa"];
  var SLOT_LABELS = { default: "Default", easa: "EASA", caa: "CAA" };

  function defaultBgSlot() {
    return { bgImage: null, pdfPageNum: null, pdfSource: null };
  }

  function defaultConfig() {
    var fields = {};
    ALL_FIELD_DEFS.forEach(function (f) {
      fields[f.key] = Object.assign({}, DEFAULT_FIELD_STYLE[f.key]);
    });
    return {
      backgrounds: { default: defaultBgSlot(), easa: defaultBgSlot(), caa: defaultBgSlot() },
      bgWidth: 1600,
      bgHeight: 1131,
      fields: fields
    };
  }

  // ---------- Page orientation ----------
  // bgWidth/bgHeight represent the PAGE the certificate is printed on, not the
  // raw pixel size of whatever file was uploaded. This lets a landscape or
  // portrait scan/PDF be fitted (never stretched or cropped) onto whichever
  // page shape the user picks.
  var PAGE_LONG_EDGE = 1600;
  var PAGE_SHORT_EDGE = Math.round(PAGE_LONG_EDGE / Math.SQRT2);

  function pageDimsForOrientation(o) {
    return o === "portrait"
      ? { w: PAGE_SHORT_EDGE, h: PAGE_LONG_EDGE }
      : { w: PAGE_LONG_EDGE, h: PAGE_SHORT_EDGE };
  }

  function currentOrientation() {
    return state.config.bgWidth >= state.config.bgHeight ? "landscape" : "portrait";
  }

  function setOrientation(o) {
    var d = pageDimsForOrientation(o === "portrait" ? "portrait" : "landscape");
    state.config.bgWidth = d.w;
    state.config.bgHeight = d.h;
    if (els.orientation) els.orientation.value = currentOrientation();
    layoutEditorStage();
    positionAllLabels();
    renderPreview();
  }

  function migrateConfig(saved) {
    var base = defaultConfig();
    if (!saved) return base;
    base.bgWidth = saved.bgWidth || base.bgWidth;
    base.bgHeight = saved.bgHeight || base.bgHeight;
    if (saved.backgrounds) {
      SLOTS.forEach(function (slot) {
        if (saved.backgrounds[slot]) {
          base.backgrounds[slot] = Object.assign({}, base.backgrounds[slot], saved.backgrounds[slot]);
        }
      });
    } else if (saved.bgImage || saved.pdfPageNum || saved.pdfSource) {
      // Legacy single-background configs (pre-EASA/CAA slots): migrate the
      // old top-level bgImage/pdfPageNum/pdfSource into the "default" slot
      // so existing saved widget configs keep working unchanged.
      base.backgrounds.default = {
        bgImage: saved.bgImage || null,
        pdfPageNum: saved.pdfPageNum || null,
        pdfSource: saved.pdfSource || null
      };
    }
    if (saved.fields) {
      ALL_FIELD_DEFS.forEach(function (f) {
        if (saved.fields[f.key]) {
          base.fields[f.key] = Object.assign({}, base.fields[f.key], saved.fields[f.key]);
        }
      });
    }
    return base;
  }

  var state = {
    record: null,
    recordId: null,
    config: defaultConfig(),
    selectedFieldKey: null,
    mode: "preview", // 'preview' | 'settings'
    editingSlot: "default", // which background slot Settings is currently editing
    pdfDocs: { default: null, easa: null, caa: null }, // in-memory pdf.js docs per slot (not persisted)
    pdfPageCounts: { default: 0, easa: 0, caa: 0 },
    allRecords: [] // every row currently linked/visible in Grist, mapped to our field keys; used for batch generation
  };

  var els = {};

  function q(id) { return document.getElementById(id); }

  function formatDate(v) {
    if (v == null || v === "") return "";
    if (typeof v === "number") {
      var d = new Date(v * 1000);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      }
    }
    return String(v);
  }

  function getValues() {
    var rec = state.record || {};
    var out = {};
    FIELD_DEFS.forEach(function (f) {
      var v = rec[f.key];
      if (f.key === "IssueDate" || f.key === "ExpiryDate") v = formatDate(v);
      out[f.key] = v == null ? "" : String(v);
    });
    return out;
  }

  function setStatus(text) { els.status.textContent = text; }

  // ---------- Compliance verification: hash + QR ----------

  function simpleHash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  async function sha256Hex(str) {
    try {
      if (window.crypto && window.crypto.subtle && window.isSecureContext) {
        var enc = new TextEncoder().encode(str);
        var buf = await window.crypto.subtle.digest("SHA-256", enc);
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      }
    } catch (e) { /* fall through to non-crypto fallback */ }
    return simpleHash(str) + simpleHash(str.split("").reverse().join(""));
  }

  var auditCache = { key: null, hash: null };

  function currentRecordId() {
    if (DEMO) return "DEMO-0001";
    return state.recordId != null ? String(state.recordId) : "—";
  }

  async function computeAuditInfo(values) {
    var canonical = [
      currentRecordId(), values.CertificateNumber, values.EngineerName,
      values.CourseName, values.IssueDate, values.Organization
    ].join("|");
    if (auditCache.key !== canonical) {
      var hash = await sha256Hex(canonical + "::aerocert-v1");
      auditCache = { key: canonical, hash: hash.slice(0, 10).toUpperCase() };
    }
    var stamp = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    var text = "Verify " + auditCache.hash + " \u00B7 Row " + currentRecordId() + " \u00B7 Generated " + stamp;
    return { hash: auditCache.hash, text: text };
  }

  function buildQrPayload(values, hash) {
    return [
      "AEROCERT VERIFICATION",
      "Certificate: " + (values.CertificateNumber || "N/A"),
      "Name: " + (values.EngineerName || "N/A"),
      "Course: " + (values.CourseName || "N/A"),
      "Org: " + (values.Organization || "N/A"),
      "Issued: " + (values.IssueDate || "N/A"),
      "Expires: " + (values.ExpiryDate || "N/A"),
      "Row: " + currentRecordId(),
      "Hash: " + hash
    ].join("\n");
  }

  var qrModelCache = { key: null, qr: null };

  function getQrModel(text) {
    if (qrModelCache.key === text && qrModelCache.qr) return qrModelCache.qr;
    if (!window.qrcode) return null;
    try {
      var qr = window.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      qrModelCache = { key: text, qr: qr };
      return qr;
    } catch (e) {
      return null;
    }
  }

  function drawQrCode(ctx, text, cx, cy, size, moduleColor, bgColor) {
    var qr = getQrModel(text);
    if (!qr) return false;
    var count = qr.getModuleCount();
    var cell = size / count;
    var left = cx - size / 2, top = cy - size / 2;
    ctx.fillStyle = bgColor || "#ffffff";
    ctx.fillRect(left, top, size, size);
    ctx.fillStyle = moduleColor || "#10233d";
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(left + c * cell, top + r * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }
    }
    return true;
  }

  // ---------- Preview canvas ----------

  // One Image element per background slot, kept loaded/cached so drawOnCanvas
  // can draw synchronously on every preview tick / export without re-decoding.
  var bgImages = {
    default: { el: new Image(), loaded: false },
    easa: { el: new Image(), loaded: false },
    caa: { el: new Image(), loaded: false }
  };

  function loadBgImageForSlot(slot, cb) {
    var src = state.config.backgrounds[slot].bgImage;
    if (!src) {
      bgImages[slot] = { el: new Image(), loaded: false };
      if (cb) cb();
      return;
    }
    var img = new Image();
    img.onload = function () {
      bgImages[slot] = { el: img, loaded: true };
      if (cb) cb();
    };
    img.onerror = function () {
      bgImages[slot] = { el: img, loaded: false };
      if (cb) cb();
    };
    img.src = src;
  }

  function loadAllBgImages(cb) {
    var pending = SLOTS.length;
    var called = false;
    function done() {
      pending--;
      if (pending <= 0 && !called) { called = true; if (cb) cb(); }
    }
    SLOTS.forEach(function (slot) { loadBgImageForSlot(slot, done); });
  }

  // Which uploaded image should be shown behind the field-editing overlay in
  // Settings for a given slot. Falls back to Default (then to any other
  // populated slot) so the field editor always has something to show even
  // while a specific EASA/CAA variant hasn't been uploaded yet — field
  // positions are shared across all three backgrounds.
  function editorBgSrcForSlot(slot) {
    var bgs = state.config.backgrounds;
    if (bgs[slot] && bgs[slot].bgImage) return bgs[slot].bgImage;
    if (bgs.default.bgImage) return bgs.default.bgImage;
    for (var i = 0; i < SLOTS.length; i++) {
      if (bgs[SLOTS[i]].bgImage) return bgs[SLOTS[i]].bgImage;
    }
    return null;
  }

  // ---------- Regulation-basis background matching ----------
  // Matches against the existing free-text RegulationBasis field rather than
  // a dedicated Choice column, so this works with whatever wording a table
  // already has (e.g. "UK CAA Part-66 / Part-147 Compliant").
  function regulationMatch(text) {
    var t = (text || "").toLowerCase();
    return { easa: /easa/.test(t), caa: /caa/.test(t) };
  }

  function resolveBackgroundPick() {
    var rec = state.record || {};
    var basis = rec.RegulationBasis == null ? "" : String(rec.RegulationBasis);
    var m = regulationMatch(basis);
    var bgs = state.config.backgrounds;
    var hasEasa = !!bgs.easa.bgImage;
    var hasCaa = !!bgs.caa.bgImage;
    if (m.easa && m.caa) {
      if (hasEasa && hasCaa) return { blend: true, a: "easa", b: "caa" };
      if (hasEasa) return { blend: false, slot: "easa" };
      if (hasCaa) return { blend: false, slot: "caa" };
      return { blend: false, slot: "default" };
    }
    if (m.easa) return { blend: false, slot: hasEasa ? "easa" : "default" };
    if (m.caa) return { blend: false, slot: hasCaa ? "caa" : "default" };
    return { blend: false, slot: "default" };
  }

  // Fits an image inside the page (contain, never stretching/cropping) at the
  // given opacity — alpha < 1 is how the EASA+CAA "Both" case is crossfaded.
  function drawFittedImage(ctx, w, h, entry, alpha) {
    if (!entry || !entry.loaded || !entry.el.naturalWidth || !entry.el.naturalHeight) return;
    var iw = entry.el.naturalWidth, ih = entry.el.naturalHeight;
    var fitScale = Math.min(w / iw, h / ih);
    var dw = iw * fitScale, dh = ih * fitScale;
    var dx = (w - dw) / 2, dy = (h - dh) / 2;
    var prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(entry.el, dx, dy, dw, dh);
    ctx.globalAlpha = prevAlpha;
  }

  function drawResolvedBackground(ctx, w, h) {
    var pick = resolveBackgroundPick();
    if (pick.blend) {
      drawFittedImage(ctx, w, h, bgImages[pick.a], 1);
      drawFittedImage(ctx, w, h, bgImages[pick.b], 0.5);
    } else {
      drawFittedImage(ctx, w, h, bgImages[pick.slot], 1);
    }
  }

  async function drawOnCanvas(canvas, forExport) {
    var w = state.config.bgWidth, h = state.config.bgHeight;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    drawResolvedBackground(ctx, w, h);
    var values = getValues();
    var audit = await computeAuditInfo(values);

    FIELD_DEFS.forEach(function (f) {
      drawTextField(ctx, w, h, f, values[f.key], forExport);
    });

    var auditStyle = state.config.fields.AuditTrail;
    if (auditStyle && auditStyle.visible !== false) {
      drawTextField(ctx, w, h, COMPUTED_FIELD_DEFS[1], audit.text, true);
    }

    var qrStyle = state.config.fields.QRCode;
    if (qrStyle && qrStyle.visible !== false) {
      var qrText = buildQrPayload(values, audit.hash);
      var qpx = (qrStyle.x / 100) * w;
      var qpy = (qrStyle.y / 100) * h;
      drawQrCode(ctx, qrText, qpx, qpy, qrStyle.size, qrStyle.moduleColor, qrStyle.bgColor);
    }
  }

  function drawTextField(ctx, w, h, f, text, forExport) {
    var style = state.config.fields[f.key];
    if (!style || style.visible === false) return;
    if (!text && !forExport && state.mode !== "preview") text = "{" + f.title + "}";
    if (!text) return;
    var px = (style.x / 100) * w;
    var py = (style.y / 100) * h;
    ctx.font = style.weight + " " + style.fontSize + "px " + style.font;
    ctx.fillStyle = style.color;
    ctx.textAlign = style.align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, px, py);
  }

  async function renderPreview() {
    var hasRecord = state.record != null;
    var hasBg = SLOTS.some(function (slot) { return !!state.config.backgrounds[slot].bgImage; });
    if (!hasBg) {
      els.emptyText.textContent = "Open Layout to upload a certificate template image.";
      els.emptyState.classList.remove("hidden");
      els.canvasWrap.classList.add("hidden");
      updateExportButtons(false);
      return;
    }
    if (!hasRecord) {
      els.emptyText.textContent = DEMO
        ? "Demo mode — showing sample data."
        : "Select a row in the connected Grist table to preview a certificate.";
      if (!DEMO) {
        els.emptyState.classList.remove("hidden");
        els.canvasWrap.classList.add("hidden");
        updateExportButtons(false);
        return;
      }
    }
    els.emptyState.classList.add("hidden");
    els.canvasWrap.classList.remove("hidden");
    await drawOnCanvas(els.canvas, false);
    updateExportButtons(true);
  }

  function updateExportButtons(enabled) {
    els.btnPdf.disabled = !enabled;
    els.btnPng.disabled = !enabled;
  }

  // ---------- Settings / editor ----------

  // Shows/hides the editor-stage image based on whichever background source
  // applies to the slot currently being edited (see editorBgSrcForSlot).
  function refreshEditorStageVisual() {
    var src = editorBgSrcForSlot(state.editingSlot);
    if (src) {
      els.editorEmpty.classList.add("hidden");
      els.editorStage.classList.remove("hidden");
      els.editorBg.src = src;
    } else {
      els.editorEmpty.classList.remove("hidden");
      els.editorStage.classList.add("hidden");
    }
  }

  // Reflects which slot currently has its own upload (dot indicator), which
  // one is being edited, and a status line explaining fallback behavior.
  function updateSlotTabsUI() {
    if (!els.bgSlotTabs) return;
    var bgs = state.config.backgrounds;
    var buttons = els.bgSlotTabs.querySelectorAll(".bg-slot-tab");
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var slot = btn.dataset.slot;
      var hasBg = !!bgs[slot].bgImage;
      btn.classList.toggle("active", slot === state.editingSlot);
      btn.classList.toggle("has-bg", hasBg);
      var thumbImg = btn.querySelector(".bg-slot-thumb img");
      if (thumbImg) {
        if (hasBg) {
          if (thumbImg.src !== bgs[slot].bgImage) thumbImg.src = bgs[slot].bgImage;
          thumbImg.alt = SLOT_LABELS[slot] + " background preview";
        } else {
          thumbImg.removeAttribute("src");
          thumbImg.alt = "";
        }
      }
    }
    if (els.bgSlotStatus) {
      var editing = state.editingSlot;
      if (editing === "default") {
        els.bgSlotStatus.textContent = "Used when Regulation Basis doesn't match EASA or CAA.";
      } else if (bgs[editing].bgImage) {
        els.bgSlotStatus.textContent = SLOT_LABELS[editing] + " background is set \u2014 used when Regulation Basis mentions " + SLOT_LABELS[editing] + ".";
      } else {
        els.bgSlotStatus.textContent = "No " + SLOT_LABELS[editing] + " background set \u2014 falls back to Default.";
      }
    }
  }

  // Syncs the shared PDF-page-picker inputs to whichever slot is being
  // edited right now (each slot keeps its own live pdf.js doc/page count).
  function syncPdfPageGroupUI() {
    var slot = state.editingSlot;
    var doc = state.pdfDocs[slot];
    var count = state.pdfPageCounts[slot];
    if (!els.pdfPageGroup || !els.pdfPageNum || !els.pdfPageTotal) return;
    if (doc && count > 1) {
      els.pdfPageNum.min = 1;
      els.pdfPageNum.max = count;
      els.pdfPageNum.value = clamp(state.config.backgrounds[slot].pdfPageNum || 1, 1, count);
      els.pdfPageTotal.textContent = "of " + count + " pages";
      els.pdfPageGroup.classList.remove("hidden");
    } else {
      els.pdfPageGroup.classList.add("hidden");
    }
  }

  function switchEditingSlot(slot) {
    if (!state.config.backgrounds[slot]) return;
    state.editingSlot = slot;
    updateSlotTabsUI();
    refreshEditorStageVisual();
    syncPdfPageGroupUI();
    updatePdfPageHint();
    layoutEditorStage();
    positionAllLabels();
  }

  function enterSettings() {
    state.mode = "settings";
    els.viewPreview.classList.add("hidden");
    els.viewSettings.classList.remove("hidden");
    if (els.orientation) els.orientation.value = currentOrientation();
    updateSlotTabsUI();
    refreshEditorStageVisual();
    buildFieldList();
    layoutEditorStage();
    positionAllLabels();
    syncPdfPageGroupUI();
    updatePdfPageHint();
  }

  function exitSettings() {
    state.mode = "preview";
    els.viewSettings.classList.add("hidden");
    els.viewPreview.classList.remove("hidden");
    renderPreview();
  }

  function buildFieldList() {
    els.fieldList.innerHTML = "";
    ALL_FIELD_DEFS.forEach(function (f) {
      var style = state.config.fields[f.key];
      var dotColor = style.visible === false ? "#c8ccd1" : (style.color || style.moduleColor || "#d98e2f");
      var chip = document.createElement("div");
      chip.className = "field-chip" + (state.selectedFieldKey === f.key ? " active" : "");
      chip.innerHTML =
        '<span class="dot" style="background:' + dotColor + '"></span>' +
        '<span class="fc-name">' + f.title + "</span>" +
        '<span class="fc-toggle">' + (style.visible === false ? "hidden" : "shown") + "</span>";
      chip.addEventListener("click", function (ev) {
        if (ev.target.classList.contains("fc-toggle")) {
          style.visible = style.visible === false ? true : false;
          buildFieldList();
          positionAllLabels();
          return;
        }
        selectField(f.key);
      });
      els.fieldList.appendChild(chip);
    });
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function updatePositionInputs() {
    var key = state.selectedFieldKey;
    if (!key) return;
    var style = state.config.fields[key];
    if (document.activeElement !== els.fePosX) els.fePosX.value = Math.round(style.x * 100) / 100;
    if (document.activeElement !== els.fePosY) els.fePosY.value = Math.round(style.y * 100) / 100;
  }

  function selectField(key) {
    state.selectedFieldKey = key;
    buildFieldList();
    var def = ALL_FIELD_DEFS.find(function (f) { return f.key === key; });
    var style = state.config.fields[key];
    els.feBlock.style.display = "block";
    els.feTitle.textContent = def.title + " style";
    updatePositionInputs();
    if (def.kind === "qr") {
      els.feTextGroup.classList.add("hidden");
      els.feQrGroup.classList.remove("hidden");
      els.feQrSize.value = style.size;
      els.feQrColor.value = style.moduleColor;
      els.feQrBg.value = style.bgColor;
    } else {
      els.feQrGroup.classList.add("hidden");
      els.feTextGroup.classList.remove("hidden");
      els.feSize.value = style.fontSize;
      els.feColor.value = style.color;
      els.feAlign.value = style.align;
      els.feWeight.value = style.weight;
      els.feFont.value = style.font;
    }
    positionAllLabels();
  }

  // The stage's on-screen box always mirrors the chosen page dimensions
  // (bgWidth/bgHeight), independent of whatever image is fitted inside it —
  // so field positions/sizes scale against the page, not the raw file.
  function layoutEditorStage() {
    var w = state.config.bgWidth, h = state.config.bgHeight;
    if (!w || !h || !els.editorStage) return;
    var maxW = 720, maxH = window.innerHeight * 0.7;
    var scale = Math.min(maxW / w, maxH / h);
    els.editorStage.style.width = Math.round(w * scale) + "px";
    els.editorStage.style.height = Math.round(h * scale) + "px";
  }

  function editorScale() {
    var w = state.config.bgWidth;
    var rectW = els.editorStage && els.editorStage.clientWidth;
    if (!w || !rectW) return 1;
    return rectW / w;
  }

  function positionAllLabels() {
    els.editorFields.innerHTML = "";
    if (!editorBgSrcForSlot(state.editingSlot)) return;
    var scale = editorScale();
    ALL_FIELD_DEFS.forEach(function (f) {
      var style = state.config.fields[f.key];
      var label = document.createElement("div");
      label.className = "field-label" + (state.selectedFieldKey === f.key ? " selected" : "") + (f.kind === "qr" ? " field-label-qr" : "");
      label.style.left = style.x + "%";
      label.style.top = style.y + "%";
      label.style.opacity = style.visible === false ? "0.35" : "1";
      if (f.kind === "qr") {
        var side = Math.max(24, style.size * scale);
        label.style.width = side + "px";
        label.style.height = side + "px";
        label.style.display = "flex";
        label.style.alignItems = "center";
        label.style.justifyContent = "center";
        label.style.fontSize = Math.max(9, Math.min(11, side / 6)) + "px";
        label.style.color = style.moduleColor;
        label.style.background = style.bgColor;
        label.textContent = "QR";
      } else {
        label.style.fontSize = Math.max(8, style.fontSize * scale) + "px";
        label.style.color = style.color;
        label.style.fontFamily = style.font;
        label.style.fontWeight = style.weight;
        label.style.textAlign = style.align;
        label.textContent = "{" + f.title + "}";
      }
      label.dataset.key = f.key;
      label.addEventListener("pointerdown", startDrag);
      els.editorFields.appendChild(label);
    });
  }

  // Dragging uses incremental pointer deltas rather than jumping the field to
  // the cursor position. This means a field never "jumps" the instant you
  // click it, and holding Shift scales movement down for fine adjustment.
  var dragCtx = null;
  var pendingOptions = null; // onOptions payload deferred because a drag was in progress
  var PRECISION_FACTOR = 0.15;

  function startDrag(ev) {
    ev.preventDefault();
    var key = ev.currentTarget.dataset.key;
    // selectField() rebuilds every label element in the DOM (positionAllLabels
    // wipes and recreates them), which detaches ev.currentTarget from the page.
    // Re-fetch the live element afterwards instead of dragging a stale/orphaned
    // reference — dragging the orphan caused the field to appear frozen during
    // the drag and then "jump" to its final position on the next re-render.
    selectField(key);
    var liveEl = els.editorFields.querySelector('.field-label[data-key="' + key + '"]') || ev.currentTarget;
    var rect = els.editorStage.getBoundingClientRect();
    dragCtx = {
      key: key,
      el: liveEl,
      pointerId: ev.pointerId,
      lastClientX: ev.clientX,
      lastClientY: ev.clientY,
      rectW: rect.width,
      rectH: rect.height
    };
    liveEl.classList.add("dragging");
    try { liveEl.setPointerCapture(ev.pointerId); } catch (e) { /* not supported */ }
    document.addEventListener("pointermove", onDrag);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);
  }

  // Re-fetches the live DOM element for the field currently being dragged.
  // A rebuild can happen mid-drag for reasons outside our own click handling
  // (e.g. Grist's onOptions callback firing spontaneously and calling
  // enterSettings -> positionAllLabels), which would silently orphan a
  // cached element reference and reproduce the jump bug. Looking it up fresh
  // on every move keeps the drag glued to whatever element is actually
  // on screen right now.
  function liveDragEl() {
    if (!dragCtx) return null;
    var el = els.editorFields.querySelector('.field-label[data-key="' + dragCtx.key + '"]');
    if (el && el !== dragCtx.el) {
      // The element was replaced since the drag started (or since the last
      // move) — carry the drag-in-progress visual state over to the new node.
      el.classList.add("dragging");
      dragCtx.el = el;
    }
    return el;
  }

  function onDrag(ev) {
    if (!dragCtx) return;
    var el = liveDragEl();
    if (!el) return;
    var factor = ev.shiftKey ? PRECISION_FACTOR : 1;
    var dxPx = ev.clientX - dragCtx.lastClientX;
    var dyPx = ev.clientY - dragCtx.lastClientY;
    dragCtx.lastClientX = ev.clientX;
    dragCtx.lastClientY = ev.clientY;
    var style = state.config.fields[dragCtx.key];
    var x = clamp(style.x + (dxPx / dragCtx.rectW) * 100 * factor, 0, 100);
    var y = clamp(style.y + (dyPx / dragCtx.rectH) * 100 * factor, 0, 100);
    style.x = Math.round(x * 100) / 100;
    style.y = Math.round(y * 100) / 100;
    el.style.left = style.x + "%";
    el.style.top = style.y + "%";
    el.classList.toggle("precision", ev.shiftKey);
    updatePositionInputs();
  }

  function stopDrag() {
    if (dragCtx) {
      var el = liveDragEl();
      if (el) {
        el.classList.remove("dragging");
        el.classList.remove("precision");
      }
    }
    dragCtx = null;
    document.removeEventListener("pointermove", onDrag);
    document.removeEventListener("pointerup", stopDrag);
    document.removeEventListener("pointercancel", stopDrag);
    if (pendingOptions !== null) {
      var opts = pendingOptions;
      pendingOptions = null;
      applyIncomingOptions(opts);
    }
  }

  function applyIncomingOptions(options) {
    state.config = migrateConfig(options && options.certConfig);
    loadAllBgImages(function () { renderPreview(); });
    restoreAllPdfDocs();
    if (state.mode === "settings") enterSettings();
  }

  function nudgeSelected(ev) {
    if (state.mode !== "settings" || !state.selectedFieldKey) return;
    var activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === "INPUT" || activeTag === "SELECT" || activeTag === "TEXTAREA") return;
    var step = ev.shiftKey ? 1 : 0.1;
    var style = state.config.fields[state.selectedFieldKey];
    var moved = true;
    if (ev.key === "ArrowUp") style.y = clamp(style.y - step, 0, 100);
    else if (ev.key === "ArrowDown") style.y = clamp(style.y + step, 0, 100);
    else if (ev.key === "ArrowLeft") style.x = clamp(style.x - step, 0, 100);
    else if (ev.key === "ArrowRight") style.x = clamp(style.x + step, 0, 100);
    else moved = false;
    if (!moved) return;
    ev.preventDefault();
    style.x = Math.round(style.x * 100) / 100;
    style.y = Math.round(style.y * 100) / 100;
    positionAllLabels();
    updatePositionInputs();
  }

  function wireFieldEditorInputs() {
    function applyText() {
      var key = state.selectedFieldKey;
      if (!key) return;
      var style = state.config.fields[key];
      style.fontSize = parseInt(els.feSize.value, 10) || style.fontSize;
      style.color = els.feColor.value;
      style.align = els.feAlign.value;
      style.weight = els.feWeight.value;
      style.font = els.feFont.value;
      positionAllLabels();
      buildFieldList();
    }
    function applyQr() {
      var key = state.selectedFieldKey;
      if (!key) return;
      var style = state.config.fields[key];
      style.size = parseInt(els.feQrSize.value, 10) || style.size;
      style.moduleColor = els.feQrColor.value;
      style.bgColor = els.feQrBg.value;
      positionAllLabels();
      buildFieldList();
    }
    [els.feSize, els.feColor, els.feAlign, els.feWeight, els.feFont].forEach(function (el) {
      el.addEventListener("input", applyText);
      el.addEventListener("change", applyText);
    });
    [els.feQrSize, els.feQrColor, els.feQrBg].forEach(function (el) {
      el.addEventListener("input", applyQr);
      el.addEventListener("change", applyQr);
    });
    function applyPosition() {
      var key = state.selectedFieldKey;
      if (!key) return;
      var style = state.config.fields[key];
      var x = parseFloat(els.fePosX.value);
      var y = parseFloat(els.fePosY.value);
      if (!isNaN(x)) style.x = clamp(x, 0, 100);
      if (!isNaN(y)) style.y = clamp(y, 0, 100);
      positionAllLabels();
    }
    [els.fePosX, els.fePosY].forEach(function (el) {
      el.addEventListener("input", applyPosition);
      el.addEventListener("change", applyPosition);
    });
  }

  // Shared finisher for both raster-image and PDF-rendered uploads: stores the
  // fitted background, snaps the page orientation to match the new file's own
  // aspect (the user can still override it with the orientation selector),
  // and refreshes the editor/preview.
  function applyBgFromCanvas(canvas, mime, quality, slotArg) {
    var slot = slotArg || state.editingSlot;
    var dataUrl = canvas.toDataURL(mime, quality);
    state.config.backgrounds[slot].bgImage = dataUrl;
    setOrientation(canvas.width >= canvas.height ? "landscape" : "portrait");
    if (slot === state.editingSlot) refreshEditorStageVisual();
    loadBgImageForSlot(slot, function () { renderPreview(); });
    updateSlotTabsUI();
  }

  function handleImageUpload(file) {
    var slot = state.editingSlot;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var MAXW = 2000;
        var canvas = document.createElement("canvas");
        var scale = img.naturalWidth > MAXW ? MAXW / img.naturalWidth : 1;
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var quality = file.type === "image/png" ? undefined : 0.88;
        var mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        applyBgFromCanvas(canvas, mime, quality, slot);
      };
      img.onerror = function () {
        alert("Could not read that image. Please try a different file.");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // Fallback status line for the rare case the live picker couldn't be
  // restored from the persisted PDF (e.g. pdf.js hasn't finished loading yet,
  // or the stored source failed to parse) but we still know which page was
  // last used.
  function updatePdfPageHint() {
    if (!els.pdfPageHint) return;
    var slot = state.editingSlot;
    if (state.pdfDocs[slot]) {
      els.pdfPageHint.classList.add("hidden");
      return;
    }
    var pageNum = state.config.backgrounds[slot].pdfPageNum;
    if (pageNum) {
      els.pdfPageHint.textContent = "Background last set from PDF page " + pageNum + ". Upload the PDF again to switch pages.";
      els.pdfPageHint.classList.remove("hidden");
    } else {
      els.pdfPageHint.classList.add("hidden");
    }
  }

  // ---------- PDF byte <-> base64 helpers ----------
  // The original PDF is persisted (as a data URL, alongside the rendered
  // bgImage bitmap) so the page picker keeps working after a reload without
  // re-uploading. pdf.js can detach/consume the buffer it's given, so we
  // always hand it a freshly-decoded copy rather than reusing one.
  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var CHUNK = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(""));
  }

  function dataUrlToUint8Array(dataUrl) {
    var base64 = dataUrl.split(",")[1] || "";
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Rehydrates state.pdfDocs[slot]/state.pdfPageCounts[slot] and the page-
  // picker UI (if this slot is the one being edited) from a persisted
  // config's pdfSource, without touching the already-loaded background
  // image. Called for every slot whenever a config arrives (initial load or
  // a later onOptions update) so each slot's picker is live after a reload.
  function restorePdfDocFromSource(slot) {
    var bg = state.config.backgrounds[slot];
    if (!bg.pdfSource) {
      hidePdfPagePicker(slot);
      if (slot === state.editingSlot) updatePdfPageHint();
      return;
    }
    var pdfjsLib = window["pdfjs-dist/build/pdf"];
    if (!pdfjsLib) {
      // pdf.js hasn't finished loading yet; fall back to the status hint.
      if (slot === state.editingSlot) updatePdfPageHint();
      return;
    }
    var bytes;
    try {
      bytes = dataUrlToUint8Array(bg.pdfSource);
    } catch (err) {
      console.error(err);
      hidePdfPagePicker(slot);
      if (slot === state.editingSlot) updatePdfPageHint();
      return;
    }
    pdfjsLib.getDocument({ data: bytes }).promise
      .then(function (pdf) {
        state.pdfDocs[slot] = pdf;
        state.pdfPageCounts[slot] = pdf.numPages;
        if (slot === state.editingSlot) {
          syncPdfPageGroupUI();
          updatePdfPageHint();
        }
      })
      .catch(function (err) {
        console.error(err);
        hidePdfPagePicker(slot);
        if (slot === state.editingSlot) updatePdfPageHint();
      });
  }

  function restoreAllPdfDocs() {
    SLOTS.forEach(function (slot) { restorePdfDocFromSource(slot); });
  }

  // Renders a single page of the given slot's currently-loaded PDF onto a
  // canvas and applies it as that slot's background. Shared by the initial
  // upload and by the page-picker input, so switching pages later re-renders
  // in place without needing the file to be re-selected. Remembers the
  // chosen page number in state.config so it survives a save/reload and is
  // used to default the next PDF upload to the same page.
  function renderPdfPage(pageNum, slotArg) {
    var slot = slotArg || state.editingSlot;
    var doc = state.pdfDocs[slot];
    if (!doc) return;
    pageNum = clamp(Math.round(pageNum), 1, state.pdfPageCounts[slot]);
    if (slot === state.editingSlot && els.pdfPageNum) els.pdfPageNum.value = pageNum;
    doc.getPage(pageNum)
      .then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var TARGET_LONG_EDGE = 2000;
        var scale = TARGET_LONG_EDGE / Math.max(base.width, base.height);
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
          state.config.backgrounds[slot].pdfPageNum = pageNum;
          applyBgFromCanvas(canvas, "image/jpeg", 0.92, slot);
          if (slot === state.editingSlot) {
            syncPdfPageGroupUI();
            updatePdfPageHint();
          }
        });
      })
      .catch(function (err) {
        console.error(err);
        alert("Could not render that PDF page. Please try a different page or file.");
      });
  }

  // Clears the live in-memory pdf.js document/picker for one slot only —
  // does not touch the persisted config (backgrounds[slot].pdfSource /
  // pdfPageNum), so a restore can still rebuild it from a saved config.
  function hidePdfPagePicker(slot) {
    slot = slot || state.editingSlot;
    state.pdfDocs[slot] = null;
    state.pdfPageCounts[slot] = 0;
    if (slot === state.editingSlot && els.pdfPageGroup) els.pdfPageGroup.classList.add("hidden");
  }

  // Grist stores widget options (including our whole certConfig, now with
  // the PDF embedded) as a JSON blob with practical size limits. Warn early
  // for unusually large files rather than silently failing on save later.
  var PDF_SIZE_WARN_BYTES = 8 * 1024 * 1024;

  function handlePdfUpload(file) {
    var slot = state.editingSlot;
    if (file.size > PDF_SIZE_WARN_BYTES) {
      var proceed = confirm(
        "This PDF is " + Math.round(file.size / 1024 / 1024) + "MB. Storing the full file with the certificate layout may be " +
        "slow to save or hit Grist's storage limits. Continue anyway?"
      );
      if (!proceed) return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var pdfjsLib = window["pdfjs-dist/build/pdf"];
      if (!pdfjsLib) {
        alert("PDF support failed to load. Please try again, or upload a PNG/JPG instead.");
        return;
      }
      var pdfBase64Source = "data:application/pdf;base64," + arrayBufferToBase64(reader.result);
      pdfjsLib.getDocument({ data: reader.result }).promise
        .then(function (pdf) {
          state.pdfDocs[slot] = pdf;
          state.pdfPageCounts[slot] = pdf.numPages;
          state.config.backgrounds[slot].pdfSource = pdfBase64Source;
          // Default to whichever page was remembered from a previous upload,
          // as long as it's still within range of this document.
          var remembered = state.config.backgrounds[slot].pdfPageNum;
          var startPage = (remembered && remembered >= 1 && remembered <= pdf.numPages) ? remembered : 1;
          if (slot === state.editingSlot) syncPdfPageGroupUI();
          renderPdfPage(startPage, slot);
        })
        .catch(function (err) {
          console.error(err);
          hidePdfPagePicker(slot);
          alert("Could not read that PDF. Please try a different file, or upload a PNG/JPG of the first page instead.");
        });
    };
    reader.onerror = function () {
      alert("Could not read that file. Please try again.");
    };
    reader.readAsArrayBuffer(file);
  }

  function handleBgUpload(file) {
    var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    var slot = state.editingSlot;
    if (isPdf) handlePdfUpload(file);
    else {
      hidePdfPagePicker(slot);
      state.config.backgrounds[slot].pdfPageNum = null;
      state.config.backgrounds[slot].pdfSource = null;
      handleImageUpload(file);
      updatePdfPageHint();
    }
  }

  function saveLayout() {
    persistConfig();
    setStatus("Layout saved.");
    setTimeout(function () { updateStatusFromState(); }, 1800);
  }

  function resetLayout() {
    if (!confirm("Reset all field positions and styles to defaults? The template images are kept.")) return;
    var backgrounds = state.config.backgrounds, w = state.config.bgWidth, h = state.config.bgHeight;
    state.config = defaultConfig();
    state.config.backgrounds = backgrounds;
    state.config.bgWidth = w;
    state.config.bgHeight = h;
    state.selectedFieldKey = null;
    els.feBlock.style.display = "none";
    buildFieldList();
    positionAllLabels();
    updatePdfPageHint();
  }

  function removeBg() {
    var slot = state.editingSlot;
    state.config.backgrounds[slot].bgImage = null;
    bgImages[slot] = { el: new Image(), loaded: false };
    hidePdfPagePicker(slot);
    state.config.backgrounds[slot].pdfPageNum = null;
    state.config.backgrounds[slot].pdfSource = null;
    updatePdfPageHint();
    updateSlotTabsUI();
    refreshEditorStageVisual();
    renderPreview();
  }

  // ---------- Export ----------

  async function exportPng() {
    var canvas = document.createElement("canvas");
    await drawOnCanvas(canvas, true);
    var link = document.createElement("a");
    link.download = exportFilename() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function exportPdf() {
    var canvas = document.createElement("canvas");
    await drawOnCanvas(canvas, true);
    var ratio = canvas.width / canvas.height;
    var longEdge = 280;
    var pdfW, pdfH;
    if (ratio >= 1) { pdfW = longEdge; pdfH = longEdge / ratio; }
    else { pdfH = longEdge; pdfW = longEdge * ratio; }
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { alert("PDF library failed to load."); return; }
    var pdf = new jsPDFCtor({
      orientation: ratio >= 1 ? "landscape" : "portrait",
      unit: "mm",
      format: [pdfW, pdfH]
    });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pdfW, pdfH);
    pdf.save(exportFilename() + ".pdf");
  }

  function exportFilename() {
    var v = getValues();
    var base = v.CertificateNumber || v.EngineerName || "certificate";
    return base.replace(/[^a-z0-9\-_]+/gi, "_").slice(0, 60) || "certificate";
  }

  // ---------- Batch export ----------
  // Lets the user pick one field + one of its distinct values, then renders
  // every matching row from state.allRecords (everything currently linked in
  // Grist) into a single combined multi-page PDF, reusing the same
  // drawOnCanvas() pipeline as the single-record export so backgrounds,
  // fields, QR code and audit stamp all resolve exactly as they do on-screen.

  function fieldDefByKey(key) {
    for (var i = 0; i < FIELD_DEFS.length; i++) {
      if (FIELD_DEFS[i].key === key) return FIELD_DEFS[i];
    }
    return null;
  }

  function fieldDisplayValue(rec, fieldDef) {
    var v = rec[fieldDef.key];
    if (fieldDef.key === "IssueDate" || fieldDef.key === "ExpiryDate") v = formatDate(v);
    return v == null ? "" : String(v);
  }

  function populateBatchFieldSelect() {
    if (!els.batchFieldSelect) return;
    els.batchFieldSelect.innerHTML = "";
    FIELD_DEFS.forEach(function (f) {
      var opt = document.createElement("option");
      opt.value = f.key;
      opt.textContent = f.title;
      els.batchFieldSelect.appendChild(opt);
    });
  }

  function populateBatchValueSelect() {
    if (!els.batchValueSelect) return;
    var fieldDef = fieldDefByKey(els.batchFieldSelect.value);
    els.batchValueSelect.innerHTML = "";
    if (!fieldDef) return;
    var seen = {};
    var values = [];
    state.allRecords.forEach(function (rec) {
      var v = fieldDisplayValue(rec, fieldDef);
      if (v && !seen[v]) { seen[v] = true; values.push(v); }
    });
    values.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }); });
    if (!values.length) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No values found";
      els.batchValueSelect.appendChild(opt);
      els.batchValueSelect.disabled = true;
      return;
    }
    els.batchValueSelect.disabled = false;
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      els.batchValueSelect.appendChild(opt);
    });
  }

  function getBatchMatches() {
    var fieldDef = fieldDefByKey(els.batchFieldSelect ? els.batchFieldSelect.value : null);
    var value = els.batchValueSelect ? els.batchValueSelect.value : "";
    if (!fieldDef || !value) return [];
    return state.allRecords.filter(function (rec) { return fieldDisplayValue(rec, fieldDef) === value; });
  }

  function updateBatchMatchCount() {
    if (!els.batchMatchCount) return;
    var matches = getBatchMatches();
    var n = matches.length;
    if (!els.batchValueSelect || !els.batchValueSelect.value) {
      els.batchMatchCount.textContent = "Select a field and value to see how many rows match.";
    } else if (n === 0) {
      els.batchMatchCount.textContent = "No rows match \u2014 try a different field or value.";
    } else {
      els.batchMatchCount.textContent = n + (n === 1 ? " row matches" : " rows match") +
        " \u2014 will produce a " + n + "-page PDF.";
    }
    if (els.btnBatchGenerate) els.btnBatchGenerate.disabled = n === 0;
  }

  function onBatchFieldChange() {
    populateBatchValueSelect();
    updateBatchMatchCount();
  }

  function openBatchModal() {
    if (!state.allRecords.length) {
      alert("No rows are available from the connected table yet.");
      return;
    }
    populateBatchFieldSelect();
    populateBatchValueSelect();
    updateBatchMatchCount();
    if (els.batchProgress) els.batchProgress.classList.add("hidden");
    els.batchModalOverlay.classList.remove("hidden");
  }

  function closeBatchModal() {
    if (state.batchRunning) return;
    els.batchModalOverlay.classList.add("hidden");
  }

  function batchExportFilename(fieldTitle, value, count) {
    var base = "certificates_" + fieldTitle + "_" + value + "_" + count;
    return base.replace(/[^a-z0-9\-_]+/gi, "_").slice(0, 80) || "certificates_batch";
  }

  async function generateBatchPdf() {
    var matches = getBatchMatches();
    if (!matches.length) return;
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { alert("PDF library failed to load."); return; }

    var fieldDef = fieldDefByKey(els.batchFieldSelect.value);
    var value = els.batchValueSelect.value;

    state.batchRunning = true;
    els.btnBatchGenerate.disabled = true;
    els.btnBatchCancel.disabled = true;
    els.batchProgress.classList.remove("hidden");

    var savedRecord = state.record, savedRecordId = state.recordId;
    var pdf = null;
    try {
      for (var idx = 0; idx < matches.length; idx++) {
        els.batchProgress.textContent = "Rendering " + (idx + 1) + " of " + matches.length + "\u2026";
        var rec = matches[idx];
        state.record = rec;
        state.recordId = rec.__rowId != null ? rec.__rowId : null;
        var canvas = document.createElement("canvas");
        await drawOnCanvas(canvas, true);
        var ratio = canvas.width / canvas.height;
        var longEdge = 280;
        var pdfW, pdfH;
        if (ratio >= 1) { pdfW = longEdge; pdfH = longEdge / ratio; } else { pdfH = longEdge; pdfW = longEdge * ratio; }
        var orientation = ratio >= 1 ? "landscape" : "portrait";
        var imgData = canvas.toDataURL("image/jpeg", 0.92);
        if (!pdf) {
          pdf = new jsPDFCtor({ orientation: orientation, unit: "mm", format: [pdfW, pdfH] });
        } else {
          pdf.addPage([pdfW, pdfH], orientation);
        }
        pdf.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH);
      }
      pdf.save(batchExportFilename(fieldDef ? fieldDef.title : "batch", value, matches.length) + ".pdf");
      state.batchRunning = false;
      closeBatchModal();
    } finally {
      state.record = savedRecord;
      state.recordId = savedRecordId;
      renderPreview();
      state.batchRunning = false;
      els.btnBatchGenerate.disabled = false;
      els.btnBatchCancel.disabled = false;
      els.batchProgress.classList.add("hidden");
    }
  }

  // ---------- Persistence ----------

  var demoConfigMemory = null;

  function persistConfig() {
    if (DEMO) {
      demoConfigMemory = state.config;
      return;
    }
    if (window.grist && window.grist.setOption) {
      window.grist.setOption("certConfig", state.config);
    }
  }

  function updateStatusFromState() {
    if (DEMO) { setStatus("Demo mode — layout kept in memory for this session (not saved)."); return; }
    if (!window.grist) { setStatus("Grist API unavailable."); return; }
    if (state.record) {
      var v = getValues();
      setStatus("Connected — showing: " + (v.EngineerName || "selected row"));
    } else {
      setStatus("Connected to Grist — select a row to preview a certificate.");
    }
  }

  // ---------- Wiring ----------

  function cacheEls() {
    els.status = q("status-text");
    els.emptyState = q("empty-state");
    els.emptyText = q("empty-text");
    els.canvasWrap = q("canvas-wrap");
    els.canvas = q("cert-canvas");
    els.viewPreview = q("view-preview");
    els.viewSettings = q("view-settings");
    els.btnSettings = q("btn-settings");
    els.emptySettingsBtn = q("empty-settings-btn");
    els.btnPng = q("btn-png");
    els.btnPdf = q("btn-pdf");
    els.orientation = q("page-orientation");
    els.bgSlotTabs = q("bg-slot-tabs");
    els.bgSlotStatus = q("bg-slot-status");
    els.bgUpload = q("bg-upload");
    els.btnRemoveBg = q("btn-remove-bg");
    els.pdfPageGroup = q("pdf-page-group");
    els.pdfPageNum = q("pdf-page-num");
    els.pdfPageTotal = q("pdf-page-total");
    els.pdfPageHint = q("pdf-page-hint");
    els.fieldList = q("field-list");
    els.feBlock = q("field-editor-block");
    els.feTitle = q("field-editor-title");
    els.fePosX = q("fe-pos-x");
    els.fePosY = q("fe-pos-y");
    els.feSize = q("fe-size");
    els.feColor = q("fe-color");
    els.feAlign = q("fe-align");
    els.feWeight = q("fe-weight");
    els.feFont = q("fe-font");
    els.feTextGroup = q("fe-text-group");
    els.feQrGroup = q("fe-qr-group");
    els.feQrSize = q("fe-qr-size");
    els.feQrColor = q("fe-qr-color");
    els.feQrBg = q("fe-qr-bg");
    els.editorEmpty = q("editor-empty");
    els.editorStage = q("editor-stage");
    els.editorBg = q("editor-bg");
    els.editorFields = q("editor-fields");
    els.btnResetLayout = q("btn-reset-layout");
    els.btnSaveLayout = q("btn-save-layout");
    els.btnBatch = q("btn-batch");
    els.batchModalOverlay = q("batch-modal-overlay");
    els.batchFieldSelect = q("batch-field-select");
    els.batchValueSelect = q("batch-value-select");
    els.batchMatchCount = q("batch-match-count");
    els.batchProgress = q("batch-progress");
    els.btnBatchCancel = q("btn-batch-cancel");
    els.btnBatchGenerate = q("btn-batch-generate");
  }

  function wireEvents() {
    els.btnSettings.addEventListener("click", enterSettings);
    els.emptySettingsBtn.addEventListener("click", enterSettings);
    els.btnPng.addEventListener("click", exportPng);
    els.btnPdf.addEventListener("click", exportPdf);
    els.bgUpload.addEventListener("change", function (ev) {
      if (ev.target.files && ev.target.files[0]) handleBgUpload(ev.target.files[0]);
      ev.target.value = "";
    });
    if (els.orientation) {
      els.orientation.addEventListener("change", function () {
        setOrientation(els.orientation.value);
      });
    }
    els.btnRemoveBg.addEventListener("click", removeBg);
    if (els.bgSlotTabs) {
      var slotButtons = els.bgSlotTabs.querySelectorAll(".bg-slot-tab");
      for (var si = 0; si < slotButtons.length; si++) {
        slotButtons[si].addEventListener("click", function (ev) {
          switchEditingSlot(ev.currentTarget.dataset.slot);
        });
      }
    }
    if (els.pdfPageNum) {
      els.pdfPageNum.addEventListener("change", function () {
        renderPdfPage(parseInt(els.pdfPageNum.value, 10) || 1);
      });
    }
    els.btnResetLayout.addEventListener("click", resetLayout);
    els.btnSaveLayout.addEventListener("click", function () {
      saveLayout();
      exitSettings();
    });
    wireFieldEditorInputs();
    window.addEventListener("resize", function () {
      if (state.mode === "settings") { layoutEditorStage(); positionAllLabels(); }
    });
    document.addEventListener("keydown", nudgeSelected);

    if (els.btnBatch) els.btnBatch.addEventListener("click", openBatchModal);
    if (els.btnBatchCancel) els.btnBatchCancel.addEventListener("click", closeBatchModal);
    if (els.batchFieldSelect) els.batchFieldSelect.addEventListener("change", onBatchFieldChange);
    if (els.batchValueSelect) els.batchValueSelect.addEventListener("change", updateBatchMatchCount);
    if (els.btnBatchGenerate) els.btnBatchGenerate.addEventListener("click", generateBatchPdf);
    if (els.batchModalOverlay) {
      els.batchModalOverlay.addEventListener("click", function (ev) {
        if (ev.target === els.batchModalOverlay) closeBatchModal();
      });
    }
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && els.batchModalOverlay && !els.batchModalOverlay.classList.contains("hidden")) {
        closeBatchModal();
      }
    });
  }

  function init() {
    cacheEls();
    wireEvents();

    if (DEMO) {
      state.config = migrateConfig(demoConfigMemory);
      state.record = DEMO_RECORD;
      state.allRecords = DEMO_RECORDS;
      loadAllBgImages(function () { renderPreview(); });
      restoreAllPdfDocs();
      updateStatusFromState();
      renderPreview();
      return;
    }

    if (!window.grist) {
      setStatus("This widget is designed to run inside Grist as a Custom Widget.");
      return;
    }

    window.grist.ready({
      columns: FIELD_DEFS.map(function (f) {
        return { name: f.key, title: f.title, type: f.type, optional: f.optional };
      }),
      requiredAccess: "read table"
    });

    window.grist.onOptions(function (options) {
      // Grist can deliver this callback at any time — including while the
      // user is mid-drag on a field (e.g. an echo of our own save, another
      // collaborator, or a reconnect). Applying it right then would both
      // rebuild the DOM under the drag and overwrite the in-progress
      // position with the last-saved value, which looks like a jump. Defer
      // it until the drag finishes instead of discarding unsaved movement.
      if (dragCtx) {
        pendingOptions = options;
        return;
      }
      applyIncomingOptions(options);
    });

    window.grist.onRecord(function (record, mappings) {
      state.recordId = record ? record.id : null;
      state.record = window.grist.mapColumnNames(record, mappings) || null;
      updateStatusFromState();
      renderPreview();
    });

    // Keeps state.allRecords in sync with every row currently linked/visible
    // in the connected Grist view (respects Grist's own filters/sort), for
    // the batch-generate feature. Independent of the single-record selection
    // used for the on-screen preview above.
    window.grist.onRecords(function (records, mappings) {
      state.allRecords = (records || []).map(function (r) {
        var mapped = window.grist.mapColumnNames(r, mappings) || {};
        mapped.__rowId = r.id;
        return mapped;
      });
    });

    setStatus("Connected to Grist — select a row to preview a certificate.");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
