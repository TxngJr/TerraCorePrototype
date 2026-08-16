/* =========================================================================
 * TerraCORE Copilot — ระบบแนะนำบล็อกถัดไป (ต้นแบบ)
 *
 * ยังไม่ใช้ AI จริง เป็นกฎ if/else ที่อ่านบล็อกในพื้นที่ทำงานแล้วหาว่า
 * "ขาดอะไรที่ทำให้โปรแกรมยังไม่ทำงานตามที่ตั้งใจ" กฎเรียงตามความรุนแรง
 * ตัวที่ทำให้โปรแกรมพังก่อน แล้วค่อยเป็นตัวที่ช่วยให้สมบูรณ์ขึ้น
 *
 * ข้อเสนอจะขึ้นเป็นบล็อกจาง ๆ (ghost) ต่ออยู่ในตำแหน่งจริงที่มันจะไปอยู่
 * กด "วางบล็อก" แล้วจึงกลายเป็นบล็อกจริง
 * ------------------------------------------------------------------------
 * ghost ถูก setEnabled(false) ไว้ ตัวแปลงโค้ดของ Blockly จึงข้ามมันไปเอง
 * โค้ด MicroPython ที่เห็นระหว่างมี ghost จึงยังเป็นโค้ดของบล็อกจริงเท่านั้น
 * ========================================================================= */
(function (global) {
  "use strict";

  const Blockly = global.Blockly;

  /* ---------------------------------------------------- ตัวช่วยสร้าง JSON */
  const num = (v) => ({ shadow: { type: "math_number", fields: { NUM: v } } });
  const str = (v) => ({ shadow: { type: "text", fields: { TEXT: v } } });
  const onOff = (v) => ({ shadow: { type: "terracore_on_off", fields: { STATE: v } } });

  const B = (type, fields, inputs) => {
    const b = { type: type };
    if (fields) b.fields = fields;
    if (inputs) b.inputs = inputs;
    return b;
  };

  const chain = (blocks) => {
    for (let i = blocks.length - 1; i > 0; i--) {
      blocks[i - 1].next = { block: blocks[i] };
    }
    return blocks[0];
  };

  /* ------------------------------------------------- ตัวช่วยอ่าน workspace */
  function byType(ws, type) {
    return ws.getBlocksByType(type, false);
  }

  function stackTail(block) {
    let b = block;
    while (b.getNextBlock()) b = b.getNextBlock();
    return b;
  }

  // จุดที่จะต่อบล็อกใหม่เข้าไปท้ายสุดของตัวลูป
  function tailConnectionOf(loopBlock) {
    const input = loopBlock.getInput("DO");
    if (!input || !input.connection) return null;
    const body = input.connection.targetBlock();
    return body ? stackTail(body).nextConnection : input.connection;
  }

  function firstLoop(ws) {
    return byType(ws, "terracore_forever")[0] || null;
  }

  // ค่าที่เสียบอยู่ในช่อง STATE ของบล็อกตั้งขา ("1" = เปิด, "0" = ปิด)
  function writeState(block) {
    const t = block.getInputTargetBlock("STATE");
    return t && t.type === "terracore_on_off" ? t.getFieldValue("STATE") : null;
  }

  function hasInside(block, type) {
    return block.getDescendants(false).some(function (b) { return b.type === type; });
  }

  /* --------------------------------------------------------------- กฎ */
  const RULES = [
    {
      id: "empty-start",
      title: "เริ่มจากไฟกะพริบ",
      reason:
        "พื้นที่ทำงานยังว่างอยู่ ไฟกะพริบเป็นโปรแกรมแรกที่เห็นผลทันทีบนบอร์ด " +
        "และได้ครบทั้งลูป การสั่งขา และการหน่วงเวลา",
      match: function (ws) {
        if (ws.getAllBlocks(false).length) return null;
        return {
          place: "top",
          json: {
            type: "terracore_forever",
            inputs: {
              DO: {
                block: chain([
                  B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("1") }),
                  B("terracore_delay", { UNIT: "ms" }, { TIME: num(500) }),
                  B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("0") }),
                  B("terracore_delay", { UNIT: "ms" }, { TIME: num(500) }),
                ]),
              },
            },
          },
        };
      },
    },

    {
      id: "wifi-before-cloud",
      title: "ต่อ WiFi ก่อนส่งข้อมูล",
      reason:
        "มีบล็อกส่งไป AIS Cloud แต่ยังไม่ได้เชื่อมต่อ WiFi ที่ไหนเลย " +
        "ถ้าไม่ต่อก่อน ข้อมูลจะส่งไม่ออกและขึ้น error ตอนรัน",
      match: function (ws) {
        if (!byType(ws, "terracore_cloud_send").length) return null;
        if (byType(ws, "terracore_wifi_connect").length) return null;
        return {
          place: "top",
          json: {
            type: "terracore_on_start",
            inputs: {
              DO: {
                block: B("terracore_wifi_connect", {
                  SSID: "MyWiFi",
                  PASS: "12345678",
                }),
              },
            },
          },
        };
      },
    },

    {
      id: "map-analog-to-pwm",
      title: "แปลงช่วงค่าก่อนส่งให้ PWM",
      reason:
        "ขาอนาล็อกให้ค่า 0–4095 แต่ PWM รับได้แค่ 0–1023 ถ้าต่อตรง ๆ " +
        "ไฟจะสว่างสุดค้างเกือบตลอดช่วง ครอบด้วยบล็อกแปลงช่วงค่าก่อนจะคุมได้จริง",
      match: function (ws) {
        for (const pwm of byType(ws, "terracore_pwm_write")) {
          const inner = pwm.getInputTargetBlock("DUTY");
          // เฉพาะกรณีต่อขาอนาล็อกเข้าตรง ๆ ถ้าผ่านบล็อกแปลงค่าแล้วถือว่าถูก
          if (!inner || inner.type !== "terracore_analog_read") continue;
          return {
            place: "wrap",
            connection: pwm.getInput("DUTY").connection,
            innerInput: "VAL",
            json: B("terracore_map", null, {
              IN_MIN: num(0),
              IN_MAX: num(4095),
              OUT_MIN: num(0),
              OUT_MAX: num(1023),
            }),
          };
        }
        return null;
      },
    },

    {
      id: "loop-needs-delay",
      title: "เพิ่มหน่วงเวลาในลูป",
      reason:
        "ลูปนี้ยังไม่มีการหน่วงเวลา บอร์ดจะวนเร็วจนกินซีพียูเต็มและอาจค้าง " +
        "ใส่หน่วงเวลาสั้น ๆ ไว้ท้ายลูปช่วยได้",
      match: function (ws) {
        const loop = firstLoop(ws);
        if (!loop) return null;
        if (hasInside(loop, "terracore_delay")) return null;
        const conn = tailConnectionOf(loop);
        if (!conn) return null;
        return {
          place: "connect",
          connection: conn,
          json: B("terracore_delay", { UNIT: "ms" }, { TIME: num(100) }),
        };
      },
    },

    {
      id: "finish-the-blink",
      title: "สั่งปิดไฟให้ครบจังหวะ",
      reason:
        "มีคำสั่งเปิดไฟแต่ยังไม่มีคำสั่งปิด ไฟจะติดค้างอยู่อย่างนั้น " +
        "เติมหน่วงเวลาแล้วสั่งปิดต่อท้าย ไฟถึงจะกะพริบ",
      match: function (ws) {
        const loop = firstLoop(ws);
        if (!loop) return null;
        const writes = byType(ws, "terracore_digital_write");
        if (!writes.length) return null;

        const on = writes.filter(function (b) { return writeState(b) === "1"; });
        const off = writes.filter(function (b) { return writeState(b) === "0"; });
        if (!on.length || off.length) return null;

        const pin = on[0].getFieldValue("PIN");
        const conn = tailConnectionOf(loop);
        if (!conn) return null;
        return {
          place: "connect",
          connection: conn,
          json: chain([
            B("terracore_delay", { UNIT: "ms" }, { TIME: num(500) }),
            B("terracore_digital_write", { PIN: pin }, { STATE: onOff("0") }),
            B("terracore_delay", { UNIT: "ms" }, { TIME: num(500) }),
          ]),
        };
      },
    },

    {
      id: "send-sensor-to-cloud",
      title: "ส่งค่าที่อ่านได้ไป AIS Cloud Dashboard",
      reason:
        "อ่านค่าจากเซนเซอร์แล้วแต่ยังไม่ได้ส่งไปไหน ส่งไป AIS Cloud Dashboard " +
        "เพื่อให้เห็นเป็นกราฟบน AIS Cloud Dashboard",
      match: function (ws) {
        const loop = firstLoop(ws);
        if (!loop) return null;
        if (byType(ws, "terracore_cloud_send").length) return null;

        const dht = byType(ws, "terracore_dht_read")[0];
        const adc = byType(ws, "terracore_analog_read")[0];
        if (!dht && !adc) return null;

        const conn = tailConnectionOf(loop);
        if (!conn) return null;

        const value = dht
          ? B("terracore_dht_read", {
              WHAT: dht.getFieldValue("WHAT"),
              MODEL: dht.getFieldValue("MODEL"),
              PIN: dht.getFieldValue("PIN"),
            })
          : B("terracore_analog_read", { PIN: adc.getFieldValue("PIN") });

        const key = dht
          ? (dht.getFieldValue("WHAT") === "temp" ? "temperature" : "humidity")
          : "sensor";

        return {
          place: "connect",
          connection: conn,
          json: B("terracore_cloud_send", { KEY: key }, { VALUE: { block: value } }),
        };
      },
    },

    {
      id: "print-sensor-value",
      title: "แสดงค่าทาง Serial ไว้ตรวจงาน",
      reason:
        "ยังไม่มีการแสดงค่าออกมาเลย ใส่บล็อกแสดงข้อความไว้ " +
        "จะได้เห็นว่าเซนเซอร์อ่านได้จริงไหมตอนดีบัก",
      match: function (ws) {
        const loop = firstLoop(ws);
        if (!loop) return null;
        if (byType(ws, "terracore_print").length) return null;

        const dht = byType(ws, "terracore_dht_read")[0];
        const adc = byType(ws, "terracore_analog_read")[0];
        const src = dht || adc;
        if (!src) return null;

        const conn = tailConnectionOf(loop);
        if (!conn) return null;

        const value = dht
          ? B("terracore_dht_read", {
              WHAT: dht.getFieldValue("WHAT"),
              MODEL: dht.getFieldValue("MODEL"),
              PIN: dht.getFieldValue("PIN"),
            })
          : B("terracore_analog_read", { PIN: adc.getFieldValue("PIN") });

        return {
          place: "connect",
          connection: conn,
          json: B("terracore_print", null, { TEXT: { block: value } }),
        };
      },
    },
  ];

  /* ------------------------------------------------------------- สถานะ */
  const S = {
    workspace: null,
    onApplied: null,
    isBusy: null,
    current: null, // { rule, plan, blocks: [] }
    mutating: false, // Copilot กำลังแตะ workspace อยู่ ฝั่งแอปต้องข้าม event ช่วงนี้
    pendingRevert: null, // buildGhost ฝากวิธีคืนสายไว้ตอนสร้างข้อเสนอชนิดครอบ
    dismissed: new Set(),
    timer: null,
    els: null,
  };

  /* ----------------------------------------------------------- ghost */
  // การแตะ workspace ของ Copilot ต้องไม่ยิง event ออกไปเลย
  //
  // เคยลองปล่อยให้ event ยิงตามปกติแล้วใช้ธงบอกให้ฝั่งแอปข้าม แต่ธงถูกปลดใน
  // setTimeout(0) ซึ่งชนกับจังหวะที่ Blockly ทยอยยิง event ทีหลัง พอกันไม่อยู่
  // ฝั่งแอปเลยนึกว่าผู้ใช้แก้บล็อก แล้วสั่งเก็บ ghost ทิ้ง จากนั้นตั้งเวลาเสนอใหม่
  // กลายเป็นวนกระพริบทุก ๆ 0.9 วินาที — ปิด event ไปเลยจึงตรงไปตรงมาและนิ่งกว่า
  function silently(fn) {
    const prevRecord = Blockly.Events.getRecordUndo();
    Blockly.Events.setRecordUndo(false); // ghost ต้องไม่กินประวัติการย้อนกลับ
    Blockly.Events.disable();
    S.mutating = true;
    try {
      return fn();
    } finally {
      S.mutating = false;
      Blockly.Events.enable();
      Blockly.Events.setRecordUndo(prevRecord);
    }
  }

  function markGhost(block) {
    const g = block.getSvgRoot();
    if (!g) return;
    g.classList.add("tc-ghost");
    // ส่งสีของบล็อกให้ CSS ใช้ เพราะตอน disabled Blockly เปลี่ยนไปใช้ลายทแยง
    g.style.setProperty("--ghost-fill", block.getColour());
  }

  function unmarkGhost(block) {
    const g = block.getSvgRoot();
    if (!g) return;
    g.classList.remove("tc-ghost");
    g.style.removeProperty("--ghost-fill");
  }

  function buildGhost(plan) {
    const ws = S.workspace;
    // ต้องวัดก่อนสร้าง ghost ไม่งั้นกรอบที่ได้จะรวมตัว ghost เองเข้าไปด้วย
    const hadBlocks = ws.getAllBlocks(false).length > 0;
    const box = hadBlocks ? ws.getBlocksBoundingBox() : null;

    return silently(function () {
      const root = Blockly.serialization.blocks.append(plan.json, ws);
      let innerIds = null;

      if (plan.place === "wrap" && plan.connection) {
        // ครอบบล็อกจริงที่เสียบอยู่เดิม: ถอดออกมา ยัดเข้าไปในตัวครอบ
        // แล้วเอาตัวครอบไปเสียบแทนที่เดิม
        const inner = plan.connection.targetBlock();
        plan.connection.disconnect();
        root.getInput(plan.innerInput).connection.connect(inner.outputConnection);
        plan.connection.connect(root.outputConnection);

        // บล็อกเดิมเป็นของผู้ใช้ ไม่ใช่ข้อเสนอ จึงต้องไม่ถูกทำเป็น ghost
        innerIds = new Set(inner.getDescendants(false).map(function (b) { return b.id; }));

        S.pendingRevert = function () {
          plan.connection.disconnect();
          root.getInput(plan.innerInput).connection.disconnect();
          plan.connection.connect(inner.outputConnection);
        };
      } else if (plan.place === "connect" && plan.connection) {
        plan.connection.connect(root.previousConnection);
      } else if (hadBlocks) {
        root.moveBy(box.left, box.bottom + 40);
      } else {
        root.moveBy(60, 60);
      }

      const blocks = root.getDescendants(false).filter(function (b) {
        return !innerIds || !innerIds.has(b.id);
      });
      blocks.forEach(function (b) {
        b.setEnabled(false); // ตัวแปลงโค้ดจะข้ามบล็อกที่ปิดอยู่
        b.setMovable(false);
        b.setDeletable(false);
      });
      // ต้องใส่คลาสหลัง setEnabled เพราะ Blockly วาดบล็อกใหม่ตอนสถานะเปลี่ยน
      blocks.forEach(markGhost);
      return blocks;
    });
  }

  function removeGhost() {
    if (!S.current) return;
    const blocks = S.current.blocks;
    const revert = S.current.revert;
    silently(function () {
      // ข้อเสนอชนิดครอบต้องคืนสายให้บล็อกจริงก่อน ไม่งั้นทิ้งตัวครอบไป
      // บล็อกเดิมของผู้ใช้จะหลุดลอยไปด้วย
      if (revert) revert();
      // ลบจากท้ายมาหน้า เพื่อให้ healStack ต่อบล็อกจริงกลับเข้าที่เดิมได้ถูก
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b && !b.disposed) b.dispose(true);
      }
    });
    S.current = null;
    hideCard();
  }

  function applyGhost() {
    if (!S.current) return;
    const blocks = S.current.blocks;
    silently(function () {
      blocks.forEach(function (b) {
        if (b.disposed) return;
        unmarkGhost(b);
        b.setEnabled(true);
        b.setMovable(true);
        b.setDeletable(true);
      });
    });
    const title = S.current.rule.title;
    S.current = null;
    hideCard();
    if (S.onApplied) S.onApplied(title);
  }

  // ข้อเสนอที่มองไม่เห็นก็ไม่มีประโยชน์ — ถ้า ghost อยู่นอกจอค่อยเลื่อนไปหา
  // ถ้าเห็นอยู่แล้วก็ไม่ต้องขยับ จะได้ไม่กระตุกโดยไม่จำเป็น
  function ensureVisible(block) {
    try {
      const host = S.workspace.getParentSvg().parentElement;
      const hostRect = host.getBoundingClientRect();
      const rect = block.getSvgRoot().getBoundingClientRect();
      const margin = 12;
      const visible =
        rect.left >= hostRect.left + margin &&
        rect.right <= hostRect.right - margin &&
        rect.top >= hostRect.top + margin &&
        rect.bottom <= hostRect.bottom - margin;
      if (!visible && S.workspace.centerOnBlock) {
        S.workspace.centerOnBlock(block.id);
      }
    } catch (e) {
      /* เลื่อนไม่ได้ก็ไม่เป็นไร ข้อเสนอยังใช้งานได้ */
    }
  }

  /* -------------------------------------------------------------- การ์ด */
  // กล่องเครื่องมือของ Blockly ลอยอยู่เหนือพื้นที่ทำงาน ถ้าวางการ์ดชิดซ้าย
  // เฉย ๆ จะโดนบัง — เลื่อนให้พ้นความกว้างจริงของกล่องเครื่องมือ
  function placeCard() {
    let offset = 0;
    try {
      const tb = S.workspace && S.workspace.getToolbox();
      if (tb && tb.getWidth) offset = tb.getWidth();
    } catch (e) {
      offset = 0;
    }
    S.els.root.style.left = offset + 18 + "px";
  }

  function showCard(rule) {
    S.els.title.textContent = rule.title;
    S.els.reason.textContent = rule.reason;
    placeCard();
    S.els.root.hidden = false;
  }

  function hideCard() {
    S.els.root.hidden = true;
  }

  /* ----------------------------------------------------------- ประเมิน */
  function evaluateNow() {
    if (!S.workspace || (S.isBusy && S.isBusy())) return;
    if (S.current) return; // มีข้อเสนอค้างอยู่แล้ว รอให้ตัดสินใจก่อน

    for (const rule of RULES) {
      if (S.dismissed.has(rule.id)) continue;
      let plan = null;
      try {
        plan = rule.match(S.workspace);
      } catch (e) {
        plan = null; // กฎไหนพัง ก็แค่ข้ามไป ไม่ให้ล้มทั้งหน้า
      }
      if (!plan) continue;

      S.pendingRevert = null;
      const blocks = buildGhost(plan);
      if (!blocks || !blocks.length) continue;
      S.current = {
        rule: rule,
        plan: plan,
        blocks: blocks,
        revert: S.pendingRevert,
      };
      ensureVisible(blocks[0]);
      showCard(rule);
      return;
    }
  }

  /* ---------------------------------------------------------------- API */
  function init(opts) {
    S.workspace = opts.workspace;
    S.onApplied = opts.onApplied;
    S.isBusy = opts.isBusy;

    S.els = {
      root: document.getElementById("copilot"),
      title: document.getElementById("copilotTitle"),
      reason: document.getElementById("copilotReason"),
      confirm: document.getElementById("copilotConfirm"),
      dismiss: document.getElementById("copilotDismiss"),
    };

    S.els.confirm.addEventListener("click", applyGhost);
    S.els.dismiss.addEventListener("click", function () {
      if (S.current) S.dismissed.add(S.current.rule.id);
      removeGhost();
    });
  }

  // เรียกทุกครั้งที่ผู้ใช้แก้บล็อก — หน่วงไว้ก่อนเพื่อไม่ให้เด้งระหว่างลาก
  function schedule() {
    clearTimeout(S.timer);
    S.timer = setTimeout(evaluateNow, 900);
  }

  // เปลี่ยนโปรเจกต์ = เริ่มนับข้อเสนอใหม่ทั้งหมด
  function reset() {
    clearTimeout(S.timer);
    removeGhost();
    S.dismissed.clear();
  }

  function isShowing() {
    return !!S.current;
  }

  function ghostCount() {
    return S.current ? S.current.blocks.length : 0;
  }

  function isMutating() {
    return S.mutating;
  }

  global.TerraCoreCopilot = {
    init: init,
    schedule: schedule,
    reset: reset,
    isShowing: isShowing,
    isMutating: isMutating,
    ghostCount: ghostCount,
    dismiss: removeGhost,
    rules: RULES, // เปิดไว้ให้ tools/test_copilot.js ทดสอบกฎได้โดยไม่ต้องเปิดเบราว์เซอร์
  };
})(window);
