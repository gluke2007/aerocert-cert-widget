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

  function defaultConfig() {
    var fields = {};
    ALL_FIELD_DEFS.forEach(function (f) {
      fields[f.key] = Object.assign({}, DEFAULT_FIELD_STYLE[f.key]);
    });
    return { bgImage: null, bgWidth: 1600, bgHeight: 1131, fields: fields };
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
    base.bgImage = saved.bgImage || null;
    base.bgWidth = saved.bgWidth || base.bgWidth;
    base.bgHeight = saved.bgHeight || base.bgHeight;
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
    mode: "preview" // 'preview' | 'settings'
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

  var bgImgEl = new Image();
  var bgImgLoaded = false;

  function loadBgImage(cb) {
    if (!state.config.bgImage) { bgImgLoaded = false; if (cb) cb(); return; }
    bgImgEl = new Image();
    bgImgEl.onload = function () {
      bgImgLoaded = true;
      if (cb) cb();
    };
    bgImgEl.onerror = function () {
      bgImgLoaded = false;
      if (cb) cb();
    };
    bgImgEl.src = state.config.bgImage;
  }

  async function drawOnCanvas(canvas, forExport) {
    var w = state.config.bgWidth, h = state.config.bgHeight;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    // Fit the uploaded template inside the chosen page (contain), never
    // stretching or cropping it, so switching orientation never distorts it.
    if (bgImgLoaded && bgImgEl.naturalWidth && bgImgEl.naturalHeight) {
      var iw = bgImgEl.naturalWidth, ih = bgImgEl.naturalHeight;
      var fitScale = Math.min(w / iw, h / ih);
      var dw = iw * fitScale, dh = ih * fitScale;
      var dx = (w - dw) / 2, dy = (h - dh) / 2;
      ctx.drawImage(bgImgEl, dx, dy, dw, dh);
    }
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
    var hasBg = !!state.config.bgImage;
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

  function enterSettings() {
    state.mode = "settings";
    els.viewPreview.classList.add("hidden");
    els.viewSettings.classList.remove("hidden");
    if (els.orientation) els.orientation.value = currentOrientation();
    if (state.config.bgImage) {
      els.editorEmpty.classList.add("hidden");
      els.editorStage.classList.remove("hidden");
      els.editorBg.src = state.config.bgImage;
    } else {
      els.editorEmpty.classList.remove("hidden");
      els.editorStage.classList.add("hidden");
    }
    buildFieldList();
    layoutEditorStage();
    positionAllLabels();
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
    if (!state.config.bgImage) return;
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
    loadBgImage(function () { renderPreview(); });
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
  function applyBgFromCanvas(canvas, mime, quality) {
    var dataUrl = canvas.toDataURL(mime, quality);
    state.config.bgImage = dataUrl;
    setOrientation(canvas.width >= canvas.height ? "landscape" : "portrait");
    els.editorEmpty.classList.add("hidden");
    els.editorStage.classList.remove("hidden");
    els.editorBg.src = dataUrl;
    loadBgImage(function () { renderPreview(); });
  }

  function handleImageUpload(file) {
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
        applyBgFromCanvas(canvas, mime, quality);
      };
      img.onerror = function () {
        alert("Could not read that image. Please try a different file.");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function handlePdfUpload(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var pdfjsLib = window["pdfjs-dist/build/pdf"];
      if (!pdfjsLib) {
        alert("PDF support failed to load. Please try again, or upload a PNG/JPG instead.");
        return;
      }
      pdfjsLib.getDocument({ data: reader.result }).promise
        .then(function (pdf) { return pdf.getPage(1); })
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
            applyBgFromCanvas(canvas, "image/jpeg", 0.92);
          });
        })
        .catch(function (err) {
          console.error(err);
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
    if (isPdf) handlePdfUpload(file);
    else handleImageUpload(file);
  }

  function saveLayout() {
    persistConfig();
    setStatus("Layout saved.");
    setTimeout(function () { updateStatusFromState(); }, 1800);
  }

  function resetLayout() {
    if (!confirm("Reset all field positions and styles to defaults? The template image is kept.")) return;
    var bg = state.config.bgImage, w = state.config.bgWidth, h = state.config.bgHeight;
    state.config = defaultConfig();
    state.config.bgImage = bg;
    state.config.bgWidth = w;
    state.config.bgHeight = h;
    state.selectedFieldKey = null;
    els.feBlock.style.display = "none";
    buildFieldList();
    positionAllLabels();
  }

  function removeBg() {
    state.config.bgImage = null;
    bgImgLoaded = false;
    els.editorEmpty.classList.remove("hidden");
    els.editorStage.classList.add("hidden");
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
    els.bgUpload = q("bg-upload");
    els.btnRemoveBg = q("btn-remove-bg");
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
  }

  function init() {
    cacheEls();
    wireEvents();

    if (DEMO) {
      state.config = migrateConfig(demoConfigMemory);
      state.record = DEMO_RECORD;
      loadBgImage(function () { renderPreview(); });
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

    setStatus("Connected to Grist — select a row to preview a certificate.");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
