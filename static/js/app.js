/* =========================================================================
 * TerraCORE IDE — ตัวควบคุมหน้าเว็บ
 * ========================================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    blockPane: $("blockPane"),
    previewPane: $("previewPane"),
    codePane: $("codePane"),
    blocklyDiv: $("blocklyDiv"),
    previewCode: $("previewCode").firstElementChild,
    previewGutter: $("previewGutter"),
    codeHl: $("codeHl"),
    codeHlInner: $("codeHl").firstElementChild,
    codeGutter: $("codeGutter"),
    codeInput: $("codeInput"),
    tabBlock: $("tabBlock"),
    tabCode: $("tabCode"),
    btnToCode: $("btnToCode"),
    btnResync: $("btnResync"),
    detachBadge: $("detachBadge"),
    projectName: $("projectName"),
    btnWiring: $("btnWiring"),
    btnProjectMenu: $("btnProjectMenu"),
    btnMore: $("btnMore"),
    btnUpload: $("btnUpload"),
    btnUploadLabel: $("btnUploadLabel"),
    btnSave: $("btnSave"),
    statusSave: $("statusSave"),
    statusBlocks: $("statusBlocks"),
    statusLines: $("statusLines"),
    modal: $("modal"),
    modalTitle: $("modalTitle"),
    modalBody: $("modalBody"),
    modalOk: $("modalOk"),
    modalCancel: $("modalCancel"),
    menu: $("menu"),
    toast: $("toast"),
    flashModal: $("flashModal"),
    flashClose: $("flashClose"),
    flashDone: $("flashDone"),
    flashSteps: $("flashSteps"),
    flashProgressBar: $("flashProgressBar"),
    flashPercent: $("flashPercent"),
    flashStatus: $("flashStatus"),
    flashResult: $("flashResult"),
    flashDashboardUrl: $("flashDashboardUrl"),
    flashOpenDashboard: $("flashOpenDashboard"),
    flashError: $("flashError"),
  };

  const state = {
    project: null,
    projects: [],
    mode: "block",
    codeDirty: false, // โค้ดถูกแก้ด้วยมือ = หลุดการซิงก์กับบล็อก
    code: "",
    loading: false, // กัน event ตอนโหลดไปสั่งบันทึกซ้ำ
    saveTimer: null,
    savedSig: null, // ลายเซ็นของสถานะที่บันทึกไปแล้ว ใช้กันบันทึกซ้ำโดยไม่จำเป็น
    dashboard: null,
    flashActive: false,
  };

  let workspace = null;

  /* ------------------------------------------------------------------ API */
  async function api(path, options) {
    const res = await fetch(
      path,
      Object.assign({ headers: { "Content-Type": "application/json" } }, options)
    );
    if (!res.ok) {
      let msg = "คำขอล้มเหลว (" + res.status + ")";
      try {
        msg = (await res.json()).error || msg;
      } catch (e) {
        /* ไม่ใช่ JSON ก็ใช้ข้อความเดิม */
      }
      throw new Error(msg);
    }
    return res.json();
  }

  /* ------------------------------------------------------------- Blockly */
  function initBlockly() {
    // หมวดมาตรฐานของ Blockly กำหนดสีด้วยค่า hue — ดันความเข้มให้เท่ากับ
    // สีหมวดของ TerraCORE เพื่อให้ทั้งกล่องเครื่องมือดูเป็นชุดเดียวกันบนพื้นขาว
    const colour = Blockly.utils && Blockly.utils.colour;
    if (colour && colour.setHsvSaturation) {
      colour.setHsvSaturation(0.62);
      colour.setHsvValue(0.66);
    }

    const theme = Blockly.Theme.defineTheme("terracore-light", {
      base: Blockly.Themes.Classic,
      componentStyles: {
        workspaceBackgroundColour: "#ffffff",
        toolboxBackgroundColour: "#ffffff",
        toolboxForegroundColour: "#3d434f",
        flyoutBackgroundColour: "#fafbfc",
        flyoutForegroundColour: "#6e757e",
        flyoutOpacity: 1,
        scrollbarColour: "#c9ced6",
        scrollbarOpacity: 0.9,
        insertionMarkerColour: "#14161c",
        insertionMarkerOpacity: 0.35,
        markerColour: "#5b4be8",
        cursorColour: "#5b4be8",
      },
      fontStyle: {
        family: '"IBM Plex Sans Thai", "Noto Sans Thai", Thonburi, sans-serif',
        size: 12,
      },
    });

    workspace = Blockly.inject(els.blocklyDiv, {
      toolbox: window.TERRACORE_TOOLBOX,
      theme: theme,
      renderer: "geras",
      grid: { spacing: 26, length: 2, colour: "#e4e7eb", snap: true },
      zoom: {
        controls: true,
        wheel: false,
        startScale: 0.95,
        minScale: 0.5,
        maxScale: 2,
        scaleSpeed: 1.1,
      },
      move: { scrollbars: true, drag: true, wheel: true },
      trashcan: true,
      sounds: false,
    });

    workspace.addChangeListener(function (ev) {
      if (state.loading || ev.isUiEvent) return;
      const copilot = window.TerraCoreCopilot;
      // การสร้าง/เก็บ ghost ไม่ใช่การแก้ไขของผู้ใช้ ต้องไม่ทำให้บันทึกหรือ
      // สร้างโค้ดใหม่ ไม่งั้นแค่แสดงข้อเสนอก็เขียนทับฐานข้อมูลแล้ว
      if (copilot.isMutating()) return;
      // พอบล็อกจริงเปลี่ยน ข้อเสนอเดิมอาจไม่ตรงกับของใหม่แล้ว เก็บทิ้งก่อน
      if (copilot.isShowing()) copilot.dismiss();
      refreshCode();
      scheduleSave();
      copilot.schedule();
    });

    window.TerraCoreCopilot.init({
      workspace: workspace,
      // เสนอเฉพาะตอนอยู่โหมด Block และโค้ดยังผูกกับบล็อกอยู่
      isBusy: function () {
        return state.loading || state.mode !== "block" || state.codeDirty;
      },
      onApplied: function (title) {
        refreshCode();
        scheduleSave();
        toast("วางบล็อกแล้ว — " + title);
      },
    });

    window.addEventListener("resize", function () {
      if (state.mode === "block") Blockly.svgResize(workspace);
    });
  }

  /* --------------------------------------------------- แปลงบล็อก -> โค้ด */
  function refreshCode() {
    // ระหว่างมีข้อเสนอค้างอยู่ โครงบล็อกถูกจัดชั่วคราวเพื่อโชว์ ghost
    // (ชนิดครอบถึงกับย้ายบล็อกจริงเข้าไปอยู่ในตัวครอบ) โค้ดที่ได้ตอนนี้จึงไม่ใช่
    // โค้ดของโปรแกรมจริง — คงโค้ดเดิมไว้จนกว่าจะยืนยันหรือปิดข้อเสนอ
    if (window.TerraCoreCopilot.isShowing()) {
      updateStatus();
      return;
    }
    if (!state.codeDirty) {
      state.code = blockCode();
      renderPreview();
      if (state.mode === "code") setEditorValue(state.code);
    }
    updateStatus();
  }

  function blockCode() {
    return window.TerraCoreBlocks.generate(workspace, {
      name: els.projectName.value || "ไม่มีชื่อ",
    });
  }

  function renderPreview() {
    const code = state.codeDirty ? blockCode() : state.code;
    els.previewCode.innerHTML = window.TerraCoreHL.highlight(code);
    els.previewGutter.textContent = window.TerraCoreHL.lineNumbers(code);
  }

  /* ------------------------------------------------------- ตัวแก้ไขโค้ด */
  function setEditorValue(code) {
    els.codeInput.value = code;
    paintEditor();
  }

  function paintEditor() {
    const code = els.codeInput.value;
    // เติม \n ท้ายไว้ เพื่อให้บรรทัดสุดท้ายที่ว่างยังถูกวาด
    els.codeHlInner.innerHTML = window.TerraCoreHL.highlight(code) + "\n";
    els.codeGutter.textContent = window.TerraCoreHL.lineNumbers(code);
    syncScroll();
  }

  function syncScroll() {
    els.codeHl.scrollTop = els.codeInput.scrollTop;
    els.codeHl.scrollLeft = els.codeInput.scrollLeft;
    els.codeGutter.scrollTop = els.codeInput.scrollTop;
  }

  function initEditor() {
    els.codeInput.addEventListener("input", function () {
      state.code = els.codeInput.value;
      if (!state.codeDirty) {
        state.codeDirty = true;
        updateDetachUI();
        renderPreview();
      }
      paintEditor();
      updateStatus();
      scheduleSave();
    });

    els.codeInput.addEventListener("scroll", syncScroll);

    els.codeInput.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      e.preventDefault();
      const ta = els.codeInput;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + "    " + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + 4;
      ta.dispatchEvent(new Event("input"));
    });
  }

  // ให้ช่องชื่อกว้างพอดีข้อความ ปุ่มลูกศรจะได้อยู่ติดชื่อไม่ลอยห่าง
  // สระบน/ล่างและวรรณยุกต์ไทยไม่กินความกว้าง จึงไม่นับรวม
  function autoSizeName() {
    const raw = els.projectName.value || "";
    const wide = raw.replace(/[ัิ-ฺ็-๎]/g, "").length;
    els.projectName.size = Math.max(8, Math.min(32, wide + 1));
  }

  // ขาของบล็อกที่ผู้ใช้เลือกอยู่ ใช้เน้นในผังการต่อวงจร
  function selectedPin() {
    try {
      const block = Blockly.getSelected();
      if (!block || !block.type) return null;
      if (!window.TerraCoreWiring.hasGuide(block.type)) return null;
      return block.getFieldValue("PIN");
    } catch (e) {
      return null;
    }
  }

  function updateDetachUI() {
    els.detachBadge.hidden = !state.codeDirty;
    els.btnResync.hidden = !state.codeDirty;
  }

  /* -------------------------------------------------------- สลับโหมด */
  function applyMode(mode) {
    state.mode = mode;
    const isBlock = mode === "block";

    els.blockPane.hidden = !isBlock;
    els.previewPane.hidden = !isBlock;
    els.codePane.hidden = isBlock;

    els.tabBlock.classList.toggle("is-active", isBlock);
    els.tabCode.classList.toggle("is-active", !isBlock);
    els.tabBlock.setAttribute("aria-selected", String(isBlock));
    els.tabCode.setAttribute("aria-selected", String(!isBlock));

    if (isBlock) {
      // ตอนซ่อนอยู่ Blockly วัดขนาดไม่ได้ ต้องสั่งวัดใหม่หลังโชว์
      Blockly.svgResize(workspace);
      // รอให้วาดเสร็จจริง ๆ (สองเฟรม) ไม่งั้น scrollCenter คำนวณจากขนาดเก่า
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { workspace.scrollCenter(); });
      });
    } else {
      setEditorValue(state.code);
    }
    updateDetachUI();
    updateStatus();
  }

  function setMode(mode) {
    if (mode === state.mode) return;

    if (mode === "block" && state.codeDirty) {
      confirmDialog({
        title: "กลับไปโหมด Block?",
        body:
          "โค้ดที่คุณแก้ด้วยมือจะถูกแทนที่ด้วยโค้ดที่สร้างจากบล็อกทั้งหมด " +
          "ถ้ายังไม่อยากเสียโค้ดชุดนี้ ให้ดาวน์โหลดเก็บไว้ก่อน",
        ok: "ทิ้งการแก้ไข",
      }).then(function (ok) {
        if (!ok) return;
        state.codeDirty = false;
        refreshCode();
        applyMode("block");
        scheduleSave();
      });
      return;
    }

    applyMode(mode);
    scheduleSave();
  }

  function resyncFromBlocks() {
    confirmDialog({
      title: "สร้างโค้ดใหม่จากบล็อก?",
      body: "โค้ดที่แก้ด้วยมือจะถูกเขียนทับทั้งหมด",
      ok: "สร้างใหม่",
    }).then(function (ok) {
      if (!ok) return;
      state.codeDirty = false;
      refreshCode();
      setEditorValue(state.code);
      updateDetachUI();
      scheduleSave();
      toast("สร้างโค้ดใหม่จากบล็อกแล้ว");
    });
  }

  /* ------------------------------------------------------------ โปรเจกต์ */
  async function refreshProjectList() {
    state.projects = await api("/api/projects");
  }

  async function loadProject(id) {
    const p = await api("/api/projects/" + id);
    state.project = p;
    state.dashboard = p.dashboard || null;
    state.code = p.code || "";
    // ถ้าโค้ดถูกแก้มือไว้ ต้องอยู่โหมดโค้ดเท่านั้น ไม่งั้นจะเห็นสองอย่างไม่ตรงกัน
    state.codeDirty = !!p.code_dirty;

    els.projectName.value = p.name;
    autoSizeName();
    window.TerraCoreCopilot.reset(); // เริ่มนับข้อเสนอใหม่ต่อโปรเจกต์

    state.loading = true;
    workspace.clear();
    if (p.workspace && (p.workspace.blocks || p.workspace.variables)) {
      try {
        Blockly.serialization.workspaces.load(p.workspace, workspace);
      } catch (e) {
        toast("โหลดบล็อกไม่สำเร็จ: " + e.message, true);
      }
    }
    // Blockly ทยอยยิง event ที่คิวไว้ใน setTimeout(0) — ต้องรอให้หมดก่อน
    // ไม่งั้นแค่เปิดโปรเจกต์ก็จะถูกนับเป็นการแก้ไขแล้วสั่งบันทึกทับทันที
    await new Promise(function (r) { setTimeout(r, 0); });
    state.loading = false;

    if (state.codeDirty) {
      renderPreview();
      applyMode("code");
    } else {
      refreshCode();
      applyMode(p.mode === "code" ? "code" : "block");
    }
    state.savedSig = signature(buildPayload());
    updateUploadUI();
    setStatus("เปิด “" + p.name + "” แล้ว");
    window.TerraCoreCopilot.schedule();
  }

  async function createProject(name, workspaceJson) {
    const p = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: name,
        workspace: workspaceJson || {},
        code: "",
        mode: "block",
      }),
    });
    await refreshProjectList();
    await loadProject(p.id);
    return p;
  }

  async function deleteProject() {
    if (!state.project) return;
    const ok = await confirmDialog({
      title: "ลบโปรเจกต์?",
      body: "“" + state.project.name + "” จะถูกลบออกจากฐานข้อมูลอย่างถาวร",
      ok: "ลบ",
    });
    if (!ok) return;
    await api("/api/projects/" + state.project.id, { method: "DELETE" });
    state.project = null;
    await refreshProjectList();
    if (state.projects.length) {
      await loadProject(state.projects[0].id);
    } else {
      await createProject("โปรเจกต์แรก");
    }
    toast("ลบแล้ว");
  }

  /* ------------------------------------------------------------- บันทึก */
  function buildPayload() {
    return {
      name: els.projectName.value.trim() || "ไม่มีชื่อ",
      workspace: Blockly.serialization.workspaces.save(workspace),
      code: state.code,
      mode: state.mode,
      code_dirty: state.codeDirty,
    };
  }

  function signature(payload) {
    return JSON.stringify([
      payload.name, payload.workspace, payload.code, payload.mode, payload.code_dirty,
    ]);
  }

  function scheduleSave() {
    if (!state.project || state.loading) return;
    // บล็อกที่ Copilot เสนออยู่ยังไม่ใช่ของผู้ใช้ อย่าเพิ่งเขียนลงฐานข้อมูล
    if (window.TerraCoreCopilot.isShowing()) return;
    if (signature(buildPayload()) === state.savedSig) return; // ไม่มีอะไรเปลี่ยนจริง
    setStatus("กำลังบันทึก", "is-saving");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      save(false);
    }, 800);
  }

  async function save(snapshot) {
    if (!state.project) return;
    // กดบันทึกทั้งที่ยังมีข้อเสนอค้างอยู่ = ถือว่ายังไม่เอา เก็บ ghost ทิ้งก่อน
    if (window.TerraCoreCopilot.isShowing()) window.TerraCoreCopilot.dismiss();
    clearTimeout(state.saveTimer);
    const payload = buildPayload();
    const sig = signature(payload);

    // Blockly ยิง event หลังโหลดเสร็จอยู่ประปราย ถ้าเนื้อหาไม่ได้เปลี่ยนจริง
    // ก็ไม่ต้องเขียนทับฐานข้อมูลให้ updated_at ขยับเปล่า ๆ
    if (!snapshot && sig === state.savedSig) {
      setStatus("บันทึกแล้ว " + formatTime(state.project.updated_at), "is-saved");
      return;
    }
    payload.snapshot = !!snapshot;

    try {
      const p = await api("/api/projects/" + state.project.id, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      state.project = p;
      state.savedSig = sig;
      const idx = state.projects.findIndex(function (x) { return x.id === p.id; });
      if (idx >= 0) state.projects[idx] = p;
      setStatus("บันทึกแล้ว " + formatTime(p.updated_at), "is-saved");
      if (snapshot) toast("บันทึกและเก็บเวอร์ชันแล้ว");
    } catch (e) {
      setStatus("บันทึกไม่สำเร็จ: " + e.message, "is-error");
      toast("บันทึกไม่สำเร็จ: " + e.message, true);
    }
  }

  /* ---------------------------------------------------------- ส่วนแสดงผล */
  function setStatus(text, cls) {
    els.statusSave.textContent = text;
    els.statusSave.className = "status-item " + (cls || "");
  }

  function updateStatus() {
    // บล็อกที่ยังเป็นข้อเสนอไม่ควรถูกนับรวมกับของจริง
    const total = workspace ? workspace.getAllBlocks(false).length : 0;
    const count = total - window.TerraCoreCopilot.ghostCount();
    els.statusBlocks.textContent = count + " บล็อก";
    els.statusLines.textContent = state.code.split("\n").length + " บรรทัด";
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  let toastTimer = null;
  function toast(msg, isError) {
    els.toast.textContent = msg;
    els.toast.className = "toast" + (isError ? " is-error" : "");
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 2600);
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      els.modalTitle.textContent = opts.title;
      els.modalBody.textContent = opts.body;
      els.modalOk.textContent = opts.ok || "ตกลง";
      els.modal.hidden = false;
      els.modalOk.focus();

      function cleanup(result) {
        els.modal.hidden = true;
        els.modalOk.removeEventListener("click", onOk);
        els.modalCancel.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onKey(e) {
        if (e.key === "Escape") cleanup(false);
        if (e.key === "Enter") cleanup(true);
      }

      els.modalOk.addEventListener("click", onOk);
      els.modalCancel.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKey);
    });
  }

  /* -------------------------------------------------------------- เมนู */
  let menuOwner = null;

  function closeMenu() {
    if (!menuOwner) return;
    menuOwner.setAttribute("aria-expanded", "false");
    menuOwner = null;
    els.menu.hidden = true;
    els.menu.innerHTML = "";
  }

  function openMenu(anchor, items, align) {
    if (menuOwner === anchor) { closeMenu(); return; }
    closeMenu();

    els.menu.innerHTML = "";
    items.forEach(function (it) {
      if (it.type === "sep") {
        const sep = document.createElement("div");
        sep.className = "menu-sep";
        els.menu.appendChild(sep);
        return;
      }
      if (it.type === "label") {
        const lb = document.createElement("div");
        lb.className = "menu-label";
        lb.textContent = it.text;
        els.menu.appendChild(lb);
        return;
      }
      const btn = document.createElement("button");
      btn.className =
        "menu-item" +
        (it.danger ? " menu-item-danger" : "") +
        (it.selected ? " is-selected" : "");
      btn.setAttribute("role", "menuitem");

      const main = document.createElement("span");
      main.textContent = it.label;
      if (it.desc) {
        const d = document.createElement("span");
        d.className = "menu-desc";
        d.textContent = it.desc;
        main.appendChild(d);
      }
      btn.appendChild(main);

      if (it.hint) {
        const h = document.createElement("span");
        h.className = "menu-hint";
        h.textContent = it.hint;
        btn.appendChild(h);
      }
      btn.addEventListener("click", function () {
        closeMenu();
        Promise.resolve()
          .then(it.onSelect)
          .catch(function (e) { toast(e.message, true); });
      });
      els.menu.appendChild(btn);
    });

    els.menu.hidden = false;
    menuOwner = anchor;
    anchor.setAttribute("aria-expanded", "true");

    const r = anchor.getBoundingClientRect();
    const w = els.menu.offsetWidth;
    let left = align === "right" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    els.menu.style.left = left + "px";
    els.menu.style.top = r.bottom + 6 + "px";
  }

  function openProjectMenu() {
    const items = [{ type: "label", text: "โปรเจกต์" }];

    state.projects.forEach(function (p) {
      items.push({
        label: p.name,
        hint: formatTime(p.updated_at),
        selected: state.project && p.id === state.project.id,
        onSelect: function () { return loadProject(p.id); },
      });
    });

    items.push({ type: "sep" });
    items.push({
      label: "โปรเจกต์ใหม่",
      onSelect: function () {
        return createProject("โปรเจกต์ใหม่ " + (state.projects.length + 1));
      },
    });

    items.push({ type: "label", text: "เริ่มจากตัวอย่าง" });
    window.TERRACORE_EXAMPLES.forEach(function (ex) {
      items.push({
        label: ex.name,
        desc: ex.desc,
        onSelect: function () {
          return createProject(ex.name, JSON.parse(ex.json)).then(function () {
            toast("โหลดตัวอย่าง “" + ex.name + "” เป็นโปรเจกต์ใหม่แล้ว");
          });
        },
      });
    });

    openMenu(els.btnProjectMenu, items, "left");
  }

  function openMoreMenu() {
    const items = [
      { label: "คัดลอกโค้ด", onSelect: copyCode },
      { label: "ดาวน์โหลด main.py", onSelect: downloadCode },
    ];
    if (state.dashboard) {
      items.push({
        label: "เปิด AIS Cloud Dashboard",
        hint: "ออนไลน์",
        onSelect: openDashboard,
      });
    }
    items.push({ type: "sep" });
    items.push({ label: "ลบโปรเจกต์นี้", danger: true, onSelect: deleteProject });
    openMenu(
      els.btnMore,
      items,
      "right"
    );
  }

  /* ---------------------------------------------------- Mock Web Flasher */
  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function updateUploadUI() {
    els.btnUpload.classList.toggle("has-dashboard", !!state.dashboard);
    els.btnUploadLabel.textContent = state.dashboard
      ? "อัปโหลดอีกครั้ง"
      : "อัปโหลดไป ESP32";
  }

  function setFlashStage(index, percent, status) {
    const steps = Array.from(els.flashSteps.children);
    steps.forEach(function (step, stepIndex) {
      step.classList.toggle("is-done", stepIndex < index || index >= steps.length);
      step.classList.toggle("is-active", stepIndex === index && index < steps.length);
    });
    els.flashProgressBar.style.width = percent + "%";
    els.flashPercent.textContent = percent + "%";
    els.flashStatus.textContent = status;
  }

  function resetFlashModal() {
    setFlashStage(0, 3, "กำลังเตรียมการอัปโหลด…");
    els.flashResult.hidden = true;
    els.flashError.hidden = true;
    els.flashDone.hidden = true;
    els.flashOpenDashboard.hidden = true;
    els.flashClose.disabled = true;
  }

  function closeFlashModal() {
    if (state.flashActive) return;
    els.flashModal.hidden = true;
  }

  function openDashboard() {
    if (!state.dashboard) return;
    window.open(state.dashboard.dashboard_url, "_blank", "noopener");
  }

  async function uploadToDevice() {
    if (!state.project || state.flashActive) return;
    closeMenu();
    state.flashActive = true;
    resetFlashModal();
    els.flashModal.hidden = false;

    try {
      if (window.TerraCoreCopilot.isShowing()) window.TerraCoreCopilot.dismiss();
      refreshCode();
      await save(false);

      setFlashStage(0, 10, "กำลัง compile โค้ด MicroPython");
      await wait(420);
      setFlashStage(1, 24, "พบ ESP32 DevKit v1 ผ่าน USB Serial");
      await wait(520);
      setFlashStage(2, 42, "กำลังเขียน main.py · block 1/3");
      await wait(430);
      setFlashStage(2, 61, "กำลังเขียน main.py · block 3/3");
      await wait(520);
      setFlashStage(3, 78, "ตรวจ checksum และรีสตาร์ตบอร์ด");
      await wait(520);
      setFlashStage(4, 89, "กำลัง provision AIS Cloud Dashboard");

      const dashboard = await api("/api/projects/" + state.project.id + "/mock-upload", {
        method: "POST",
        body: JSON.stringify({ code: state.code }),
      });
      await wait(430);
      state.dashboard = dashboard;
      updateUploadUI();
      setFlashStage(5, 100, "พร้อมรับ–ส่งข้อมูลกับ AIS Cloud");

      const absoluteUrl = new URL(dashboard.dashboard_url, window.location.origin).href;
      els.flashDashboardUrl.textContent = absoluteUrl;
      els.flashOpenDashboard.href = dashboard.dashboard_url;
      els.flashResult.hidden = false;
      els.flashDone.hidden = false;
      els.flashOpenDashboard.hidden = false;
      els.flashClose.disabled = false;
      toast("อัปโหลดสำเร็จและสร้าง AIS Cloud Dashboard แล้ว");
    } catch (e) {
      els.flashError.textContent = "อัปโหลดไม่สำเร็จ: " + e.message;
      els.flashError.hidden = false;
      els.flashStatus.textContent = "หยุดการอัปโหลดแล้ว";
      els.flashDone.hidden = false;
      els.flashClose.disabled = false;
    } finally {
      state.flashActive = false;
    }
  }

  /* -------------------------------------------------------- ส่งออกโค้ด */
  function downloadCode() {
    const blob = new Blob([state.code], { type: "text/x-python;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "main.py";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("ดาวน์โหลด main.py แล้ว");
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(state.code);
      toast("คัดลอกโค้ดแล้ว");
    } catch (e) {
      toast("คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาต", true);
    }
  }

  /* ------------------------------------------------------------ เริ่มต้น */
  function bindUI() {
    els.tabBlock.addEventListener("click", function () { setMode("block"); });
    els.tabCode.addEventListener("click", function () { setMode("code"); });
    els.btnToCode.addEventListener("click", function () { setMode("code"); });
    els.btnResync.addEventListener("click", resyncFromBlocks);
    els.btnUpload.addEventListener("click", uploadToDevice);
    els.btnSave.addEventListener("click", function () { save(true); });
    els.flashClose.addEventListener("click", closeFlashModal);
    els.flashDone.addEventListener("click", closeFlashModal);

    els.btnWiring.addEventListener("click", function () {
      window.TerraCoreWiring.open(workspace, selectedPin());
    });

    els.btnProjectMenu.addEventListener("click", function (e) {
      e.stopPropagation();
      openProjectMenu();
    });
    els.btnMore.addEventListener("click", function (e) {
      e.stopPropagation();
      openMoreMenu();
    });

    document.addEventListener("click", function (e) {
      if (menuOwner && !els.menu.contains(e.target)) closeMenu();
    });

    els.projectName.addEventListener("input", function () {
      autoSizeName();
      refreshCode(); // ชื่อโปรเจกต์โผล่ในหัวไฟล์ด้วย
      scheduleSave();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuOwner) { closeMenu(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save(true);
      }
    });
  }

  async function boot() {
    initBlockly();
    initEditor();
    window.TerraCoreWiring.init();
    bindUI();

    try {
      await refreshProjectList();
      if (state.projects.length) {
        await loadProject(state.projects[0].id);
      } else {
        // เปิดครั้งแรกให้มีของให้เล่นเลย
        const blink = window.TERRACORE_EXAMPLES[0];
        await createProject(blink.name, JSON.parse(blink.json));
      }
    } catch (e) {
      toast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: " + e.message, true);
      setStatus("ออฟไลน์ — แก้ไขได้แต่ยังไม่ถูกบันทึก", "is-error");
    }
  }

  boot();
})();
