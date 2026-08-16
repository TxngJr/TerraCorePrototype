/* =========================================================================
 * TerraCORE — ตัวช่วยแนะนำการต่อวงจร (mockup)
 *
 * อ่านว่าโปรแกรมใช้ขาไหนทำอะไรบ้าง แล้ววาดบอร์ด ESP32 DevKit v1 (30 ขา)
 * พร้อมกระพริบเฉพาะขาที่ต้องต่อ และบอกว่าแต่ละขาต้องต่ออุปกรณ์อะไร
 * ต้องใช้ตัวต้านทานเท่าไร ลง GND ตรงไหน
 *
 * ยังเป็นข้อมูลที่เขียนไว้ล่วงหน้า ไม่ได้วิเคราะห์วงจรจริง
 * ========================================================================= */
(function (global) {
  "use strict";

  /* ------------------------------------------------- ผังขาของบอร์ดจริง */
  // DOIT ESP32 DevKit v1 (30 ขา) เรียงจากบนลงล่าง โดยหันพอร์ต USB ลงข้างล่าง
  // GPIO 0 กับ GPIO 2 ไม่ได้อยู่บนแถวขา — เป็นปุ่ม BOOT กับ LED บนบอร์ด
  const LEFT = [
    { label: "EN" }, { label: "VP", gpio: "36" }, { label: "VN", gpio: "39" },
    { label: "D34", gpio: "34" }, { label: "D35", gpio: "35" },
    { label: "D32", gpio: "32" }, { label: "D33", gpio: "33" },
    { label: "D25", gpio: "25" }, { label: "D26", gpio: "26" },
    { label: "D27", gpio: "27" }, { label: "D14", gpio: "14" },
    { label: "D12", gpio: "12" }, { label: "GND", kind: "gnd" },
    { label: "D13", gpio: "13" }, { label: "VIN", kind: "power" },
  ];
  const RIGHT = [
    { label: "D23", gpio: "23" }, { label: "D22", gpio: "22" },
    { label: "TX0", gpio: "1" }, { label: "RX0", gpio: "3" },
    { label: "D21", gpio: "21" }, { label: "GND", kind: "gnd" },
    { label: "D19", gpio: "19" }, { label: "D18", gpio: "18" },
    { label: "D5", gpio: "5" }, { label: "TX2", gpio: "17" },
    { label: "RX2", gpio: "16" }, { label: "D4", gpio: "4" },
    { label: "D2", gpio: "2" }, { label: "D15", gpio: "15" },
    { label: "3V3", kind: "power" },
  ];

  // ขาที่ต่ออุปกรณ์บนบอร์ดไว้แล้ว ไม่ต้องต่อสายเพิ่ม
  const ONBOARD = {
    "2": "LED บนบอร์ด",
    "0": "ปุ่ม BOOT บนบอร์ด",
  };

  /* --------------------------------------- ความรู้เรื่องการต่อของแต่ละบล็อก */
  // คืน { device, wiring, role } ต่อการใช้งานหนึ่งครั้ง
  const GUIDE = {
    terracore_digital_write: function (pin) {
      if (pin === "2") {
        return {
          role: "ขาออกดิจิทัล",
          device: "LED บนบอร์ด",
          wiring: "ใช้ LED ที่ติดมากับบอร์ดได้เลย ไม่ต้องต่อสายเพิ่ม",
        };
      }
      return {
        role: "ขาออกดิจิทัล",
        device: "LED",
        wiring:
          "ขายาวของ LED เข้าขานี้ ผ่านตัวต้านทาน 220Ω แล้วขาสั้นลง GND " +
          "(ห้ามต่อ LED ตรงเข้าขาโดยไม่มีตัวต้านทาน)",
      };
    },
    terracore_toggle: function (pin) {
      return GUIDE.terracore_digital_write(pin);
    },
    terracore_pwm_write: function (pin) {
      if (pin === "2") {
        return {
          role: "ขาออก PWM",
          device: "LED บนบอร์ด",
          wiring: "หรี่ LED บนบอร์ดได้เลย ไม่ต้องต่อสายเพิ่ม",
        };
      }
      return {
        role: "ขาออก PWM",
        device: "LED หรือมอเตอร์",
        wiring:
          "ถ้าเป็น LED ต่อผ่านตัวต้านทาน 220Ω ลง GND เหมือนขาออกปกติ " +
          "ถ้าเป็นมอเตอร์ต้องผ่านทรานซิสเตอร์หรือโมดูลไดรเวอร์ ห้ามต่อตรง",
      };
    },
    terracore_digital_read: function () {
      return {
        role: "ขาเข้าดิจิทัล",
        device: "สวิตช์ หรือเซนเซอร์แบบดิจิทัล",
        wiring:
          "ต่อสวิตช์ระหว่างขานี้กับ GND แล้วใส่ตัวต้านทาน pull-up 10kΩ " +
          "ไปที่ 3V3 เพื่อไม่ให้ขาลอย",
      };
    },
    terracore_button_pressed: function (pin) {
      if (pin === "0") {
        return {
          role: "ขาเข้าดิจิทัล",
          device: "ปุ่ม BOOT บนบอร์ด",
          wiring: "ใช้ปุ่ม BOOT ที่ติดมากับบอร์ดได้เลย ไม่ต้องต่อปุ่มเพิ่ม",
        };
      }
      return {
        role: "ขาเข้าดิจิทัล",
        device: "ปุ่มกด",
        wiring:
          "ต่อปุ่มระหว่างขานี้กับ GND ได้เลย โค้ดเปิด PULL_UP ในตัวไว้แล้ว " +
          "ตอนกดขาจะเป็น 0 ตอนปล่อยเป็น 1",
      };
    },
    terracore_analog_read: function () {
      return {
        role: "ขาอ่านอนาล็อก",
        device: "โพเทนชิโอมิเตอร์ หรือ LDR",
        wiring:
          "โพเทนชิโอมิเตอร์: ปลายสองข้างเข้า 3V3 กับ GND ขากลางเข้าขานี้ · " +
          "LDR: ต่ออนุกรมกับตัวต้านทาน 10kΩ คร่อม 3V3 กับ GND แล้วเอาจุดกลางเข้าขานี้ " +
          "· แรงดันที่เข้าขาต้องไม่เกิน 3.3V",
      };
    },
    terracore_dht_read: function (pin, block) {
      const model = block && block.getFieldValue ? block.getFieldValue("MODEL") : "DHT22";
      return {
        role: "ขาข้อมูลเซนเซอร์",
        device: model,
        wiring:
          "VCC เข้า 3V3 · GND เข้า GND · DATA เข้าขานี้ " +
          "และคร่อมตัวต้านทาน pull-up 10kΩ ระหว่าง DATA กับ 3V3",
      };
    },
  };

  /* ------------------------------------------ รวบรวมว่าโปรแกรมใช้ขาอะไรบ้าง */
  function collect(workspace) {
    const byPin = new Map();
    workspace.getAllBlocks(false).forEach(function (block) {
      const make = GUIDE[block.type];
      if (!make || !block.isEnabled()) return; // ข้ามบล็อกที่ยังเป็นข้อเสนอ
      const pin = block.getFieldValue("PIN");
      if (pin === null || pin === undefined) return;

      let info;
      try {
        info = make(pin, block);
      } catch (e) {
        return;
      }
      if (!byPin.has(pin)) byPin.set(pin, { pin: pin, uses: [] });
      const entry = byPin.get(pin);
      // ใช้ซ้ำแบบเดียวกันหลายที่ ไม่ต้องบอกซ้ำ
      if (!entry.uses.some(function (u) { return u.device === info.device && u.role === info.role; })) {
        entry.uses.push(info);
      }
    });
    return byPin;
  }

  /* ------------------------------------------------------------- วาดบอร์ด */
  const ROW_H = 24;
  const TOP = 34;
  const BOARD_X = 132;
  const BOARD_W = 132;
  const PAD_W = 26;
  const PAD_H = 15;

  function pinSvg(entry, index, side, usedPins, focusPin) {
    const y = TOP + index * ROW_H;
    const isRight = side === "right";
    const padX = isRight ? BOARD_X + BOARD_W - PAD_W / 2 : BOARD_X - PAD_W / 2;
    const labelX = isRight ? BOARD_X + BOARD_W + 24 : BOARD_X - 24;
    const anchor = isRight ? "start" : "end";

    const gpio = entry.gpio;
    const used = gpio && usedPins.has(gpio);
    const focused = gpio && gpio === focusPin;

    const cls = ["wire-pin"];
    if (used) cls.push("is-used");
    if (focused) cls.push("is-focus");
    if (entry.kind === "gnd") cls.push("is-gnd");
    if (entry.kind === "power") cls.push("is-power");

    return (
      '<g class="' + cls.join(" ") + '">' +
      '<rect class="wire-pad" x="' + padX + '" y="' + (y - PAD_H / 2) +
      '" width="' + PAD_W + '" height="' + PAD_H + '" rx="3"/>' +
      '<text class="wire-pin-label" x="' + labelX + '" y="' + (y + 4) +
      '" text-anchor="' + anchor + '">' + entry.label + "</text>" +
      "</g>"
    );
  }

  function boardSvg(usedPins, focusPin) {
    const rows = Math.max(LEFT.length, RIGHT.length);
    const height = TOP + rows * ROW_H + 40;
    const width = BOARD_X * 2 + BOARD_W;

    let svg =
      '<svg class="wire-board" viewBox="0 0 ' + width + " " + height +
      '" role="img" aria-label="ผังขาของบอร์ด ESP32 DevKit v1">';

    // ตัวแผ่นวงจร
    svg +=
      '<rect class="wire-pcb" x="' + BOARD_X + '" y="16" width="' + BOARD_W +
      '" height="' + (height - 46) + '" rx="8"/>';

    // พอร์ต USB ด้านล่าง
    svg +=
      '<rect class="wire-usb" x="' + (BOARD_X + BOARD_W / 2 - 22) + '" y="' +
      (height - 36) + '" width="44" height="22" rx="3"/>';

    // อุปกรณ์บนบอร์ด: LED (GPIO 2) กับปุ่ม BOOT (GPIO 0)
    const ledOn = usedPins.has("2");
    const bootOn = usedPins.has("0");
    svg +=
      '<g class="wire-onboard' + (ledOn ? " is-used" : "") +
      (focusPin === "2" ? " is-focus" : "") + '">' +
      '<circle class="wire-led" cx="' + (BOARD_X + 30) + '" cy="' + (height - 66) + '" r="7"/>' +
      '<text class="wire-onboard-label" x="' + (BOARD_X + 30) + '" y="' + (height - 50) +
      '" text-anchor="middle">LED</text></g>';
    svg +=
      '<g class="wire-onboard' + (bootOn ? " is-used" : "") +
      (focusPin === "0" ? " is-focus" : "") + '">' +
      '<rect class="wire-btn" x="' + (BOARD_X + BOARD_W - 44) + '" y="' + (height - 74) +
      '" width="18" height="16" rx="3"/>' +
      '<text class="wire-onboard-label" x="' + (BOARD_X + BOARD_W - 35) + '" y="' + (height - 50) +
      '" text-anchor="middle">BOOT</text></g>';

    svg +=
      '<text class="wire-board-name" x="' + (BOARD_X + BOARD_W / 2) +
      '" y="' + (TOP - 12) + '" text-anchor="middle">ESP32 DevKit v1</text>';

    LEFT.forEach(function (p, i) { svg += pinSvg(p, i, "left", usedPins, focusPin); });
    RIGHT.forEach(function (p, i) { svg += pinSvg(p, i, "right", usedPins, focusPin); });

    svg += "</svg>";
    return svg;
  }

  /* -------------------------------------------------------- รายการคำอธิบาย */
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  function listHtml(byPin, focusPin) {
    if (!byPin.size) {
      return (
        '<p class="wire-empty">โปรแกรมนี้ยังไม่ได้ใช้ขาไหนเลย ' +
        "ลองลากบล็อกที่มีการเลือกขา เช่น ตั้งขา หรือ อ่านค่าอนาล็อก เข้ามาก่อน</p>"
      );
    }

    // ขาที่กำลังโฟกัสอยู่ให้ขึ้นก่อน ที่เหลือเรียงตามเลขขา
    const pins = Array.from(byPin.keys()).sort(function (a, b) {
      if (a === focusPin) return -1;
      if (b === focusPin) return 1;
      return Number(a) - Number(b);
    });

    return pins.map(function (pin) {
      const entry = byPin.get(pin);
      const onboard = ONBOARD[pin];
      const uses = entry.uses.map(function (u) {
        return (
          '<div class="wire-use">' +
          '<div class="wire-use-head"><span class="wire-device">' + esc(u.device) +
          '</span><span class="wire-role">' + esc(u.role) + "</span></div>" +
          '<p class="wire-how">' + esc(u.wiring) + "</p></div>"
        );
      }).join("");

      return (
        '<article class="wire-item' + (pin === focusPin ? " is-focus" : "") + '">' +
        '<header class="wire-item-head">' +
        '<span class="wire-pin-name">GPIO ' + esc(pin) + "</span>" +
        (onboard ? '<span class="wire-tag">' + esc(onboard) + "</span>" : "") +
        (pin === focusPin ? '<span class="wire-tag wire-tag-focus">บล็อกที่เลือก</span>' : "") +
        "</header>" + uses + "</article>"
      );
    }).join("");
  }

  /* ------------------------------------------------------------------ API */
  const els = {};

  function init() {
    els.modal = document.getElementById("wiringModal");
    els.board = document.getElementById("wiringBoard");
    els.list = document.getElementById("wiringList");
    els.close = document.getElementById("wiringClose");
    els.count = document.getElementById("wiringCount");

    els.close.addEventListener("click", close);
    els.modal.addEventListener("click", function (e) {
      if (e.target === els.modal) close(); // คลิกนอกกล่องเพื่อปิด
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !els.modal.hidden) close();
    });
  }

  function open(workspace, focusPin) {
    const byPin = collect(workspace);
    const usedPins = new Set(byPin.keys());

    els.board.innerHTML = boardSvg(usedPins, focusPin || null);
    els.list.innerHTML = listHtml(byPin, focusPin || null);
    els.count.textContent = byPin.size
      ? "ต้องต่อทั้งหมด " + byPin.size + " ขา"
      : "ยังไม่มีขาที่ต้องต่อ";

    els.modal.hidden = false;
    els.close.focus();
  }

  function close() {
    els.modal.hidden = true;
  }

  global.TerraCoreWiring = {
    init: init,
    open: open,
    close: close,
    hasGuide: function (type) { return !!GUIDE[type]; },
  };
})(window);
