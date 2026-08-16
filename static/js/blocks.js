/* =========================================================================
 * TerraCORE — นิยาม Block และตัวแปลง Block -> MicroPython (ESP32)
 * ========================================================================= */
(function (global) {
  "use strict";

  const Blockly = global.Blockly;
  const Py = Blockly.Python;

  Py.INDENT = "    "; // ให้โค้ดที่ได้เป็น 4 spaces ตามมาตรฐาน Python

  const COLOR = {
    start: "#6153E0",
    output: "#BC4636",
    input: "#1F7A55",
    cloud: "#1F6FA8",
  };

  /* ---------------------------------------------------------------------
   * ตัวเลือกขาของ ESP32
   * ------------------------------------------------------------------- */
  const OUT_PINS = ["2", "4", "5", "12", "13", "14", "15", "16", "17", "18",
                    "19", "21", "22", "23", "25", "26", "27", "32", "33"];
  const IN_PINS  = ["0", "2", "4", "5", "12", "13", "14", "15", "16", "17",
                    "18", "19", "21", "22", "23", "25", "26", "27", "32", "33",
                    "34", "35", "36", "39"];
  const ADC_PINS = ["32", "33", "34", "35", "36", "39"];

  function pinOptions(pins) {
    return pins.map(function (p) {
      let label = "GPIO " + p;
      if (p === "2") label += " (LED บนบอร์ด)";
      if (p === "0") label += " (ปุ่ม BOOT)";
      if (p === "34" || p === "35" || p === "36" || p === "39") label += " (อ่านอย่างเดียว)";
      return [label, p];
    });
  }

  /* ---------------------------------------------------------------------
   * บริบทของการ generate — เก็บ import / ค่าคงที่ / ฟังก์ชันช่วย / การตั้งค่าขา
   * แต่ละบล็อกแค่ "ขอ" สิ่งที่ต้องใช้ แล้วตอนประกอบไฟล์ค่อยรวมให้ไม่ซ้ำ
   * ------------------------------------------------------------------- */
  const Ctx = {
    machine: new Set(), // ชื่อที่ import จาก machine เช่น Pin, ADC, PWM
    modules: new Set(), // import ปกติ เช่น time, network
    consts: new Map(),
    helpers: new Map(),
    setup: new Map(),
    reset: function () {
      this.machine.clear();
      this.modules.clear();
      this.consts.clear();
      this.helpers.clear();
      this.setup.clear();
    },
  };

  function needMachine() {
    for (const n of arguments) Ctx.machine.add(n);
  }
  function needModule() {
    for (const m of arguments) Ctx.modules.add(m);
  }
  function constant(name, line) {
    Ctx.consts.set(name, line);
  }
  function helper(name, code) {
    if (!Ctx.helpers.has(name)) Ctx.helpers.set(name, code);
  }
  function setupLine(varName, line) {
    Ctx.setup.set(varName, line);
    return varName;
  }

  // ประกาศอ็อบเจกต์ขาไว้ครั้งเดียว แล้วเรียกใช้ซ้ำ (อ่านง่ายกว่าและเร็วกว่าสร้างใหม่ทุกครั้ง)
  function outPin(pin) {
    needMachine("Pin");
    const v = "pin_out_" + pin;
    return setupLine(v, v + " = Pin(" + pin + ", Pin.OUT)");
  }
  function inPin(pin, pullUp) {
    needMachine("Pin");
    const v = (pullUp ? "btn_" : "pin_in_") + pin;
    return setupLine(
      v,
      v + " = Pin(" + pin + ", Pin.IN" + (pullUp ? ", Pin.PULL_UP" : "") + ")"
    );
  }
  function adcPin(pin) {
    needMachine("ADC", "Pin");
    const v = "adc_" + pin;
    return setupLine(
      v,
      v + " = ADC(Pin(" + pin + "))\n" + v + ".atten(ADC.ATTN_11DB)  # อ่านได้ถึง ~3.3V"
    );
  }
  function pwmPin(pin) {
    needMachine("PWM", "Pin");
    const v = "pwm_" + pin;
    return setupLine(v, v + " = PWM(Pin(" + pin + "), freq=1000)");
  }

  /* ---------------------------------------------------------------------
   * นิยามบล็อก
   * ------------------------------------------------------------------- */
  Blockly.defineBlocksWithJsonArray([
    // ---------- เริ่มต้น / โครงสร้าง ----------
    {
      type: "terracore_on_start",
      message0: "เมื่อเริ่มทำงาน",
      message1: "%1",
      args1: [{ type: "input_statement", name: "DO" }],
      colour: COLOR.start,
      tooltip: "โค้ดในนี้ทำงานหนึ่งครั้งตอนเปิดบอร์ด",
      helpUrl: "",
    },
    {
      type: "terracore_forever",
      message0: "ทำซ้ำตลอดไป",
      message1: "%1",
      args1: [{ type: "input_statement", name: "DO" }],
      previousStatement: null,
      colour: COLOR.start,
      tooltip: "วนทำงานไม่รู้จบ (while True)",
    },
    {
      type: "terracore_delay",
      message0: "หน่วงเวลา %1 %2",
      args0: [
        { type: "input_value", name: "TIME", check: "Number" },
        {
          type: "field_dropdown",
          name: "UNIT",
          options: [["มิลลิวินาที", "ms"], ["วินาที", "s"]],
        },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOR.start,
      tooltip: "หยุดรอตามเวลาที่กำหนด",
    },

    // ---------- เอาต์พุต ----------
    {
      type: "terracore_digital_write",
      message0: "ตั้งขา %1 เป็น %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: pinOptions(OUT_PINS) },
        { type: "input_value", name: "STATE", check: "Number" },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOR.output,
      tooltip: "สั่งเปิด/ปิดไฟที่ขาดิจิทัล",
    },
    {
      type: "terracore_on_off",
      message0: "%1",
      args0: [
        {
          type: "field_dropdown",
          name: "STATE",
          options: [["เปิด (HIGH)", "1"], ["ปิด (LOW)", "0"]],
        },
      ],
      output: "Number",
      colour: COLOR.output,
      tooltip: "สถานะเปิดหรือปิด",
    },
    {
      type: "terracore_toggle",
      message0: "สลับสถานะขา %1",
      args0: [
        { type: "field_dropdown", name: "PIN", options: pinOptions(OUT_PINS) },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: COLOR.output,
      tooltip: "ถ้าติดอยู่ให้ดับ ถ้าดับอยู่ให้ติด",
    },
    {
      type: "terracore_pwm_write",
      message0: "ตั้งความสว่างขา %1 เป็น %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: pinOptions(OUT_PINS) },
        { type: "input_value", name: "DUTY", check: "Number" },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOR.output,
      tooltip: "ค่า 0–1023 (PWM)",
    },
    {
      type: "terracore_print",
      message0: "แสดงข้อความ %1",
      args0: [{ type: "input_value", name: "TEXT" }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOR.output,
      tooltip: "พิมพ์ข้อความออกทาง Serial",
    },

    // ---------- อินพุต / เซนเซอร์ ----------
    {
      type: "terracore_digital_read",
      message0: "อ่านค่าดิจิทัลขา %1",
      args0: [
        { type: "field_dropdown", name: "PIN", options: pinOptions(IN_PINS) },
      ],
      output: "Number",
      colour: COLOR.input,
      tooltip: "ได้ค่า 0 หรือ 1",
    },
    {
      type: "terracore_analog_read",
      message0: "อ่านค่าอนาล็อกขา %1",
      args0: [
        { type: "field_dropdown", name: "PIN", options: pinOptions(ADC_PINS) },
      ],
      output: "Number",
      colour: COLOR.input,
      tooltip: "ได้ค่า 0–4095",
    },
    {
      type: "terracore_button_pressed",
      message0: "ปุ่มขา %1 ถูกกด",
      args0: [
        { type: "field_dropdown", name: "PIN", options: pinOptions(IN_PINS) },
      ],
      output: "Boolean",
      colour: COLOR.input,
      tooltip: "จริงเมื่อปุ่มถูกกด (ต่อแบบ PULL_UP)",
    },
    {
      type: "terracore_dht_read",
      message0: "อ่าน %1 จาก %2 ขา %3",
      args0: [
        {
          type: "field_dropdown",
          name: "WHAT",
          options: [["อุณหภูมิ (°C)", "temp"], ["ความชื้น (%)", "humi"]],
        },
        {
          type: "field_dropdown",
          name: "MODEL",
          options: [["DHT22", "DHT22"], ["DHT11", "DHT11"]],
        },
        { type: "field_dropdown", name: "PIN", options: pinOptions(IN_PINS) },
      ],
      output: "Number",
      colour: COLOR.input,
      tooltip: "อ่านอุณหภูมิหรือความชื้นจากเซนเซอร์ DHT",
    },
    {
      type: "terracore_map",
      message0: "แปลงค่า %1 จาก %2 – %3 เป็น %4 – %5",
      args0: [
        { type: "input_value", name: "VAL", check: "Number" },
        { type: "input_value", name: "IN_MIN", check: "Number" },
        { type: "input_value", name: "IN_MAX", check: "Number" },
        { type: "input_value", name: "OUT_MIN", check: "Number" },
        { type: "input_value", name: "OUT_MAX", check: "Number" },
      ],
      inputsInline: true,
      output: "Number",
      colour: COLOR.input,
      tooltip: "เทียบสัดส่วนค่าจากช่วงหนึ่งไปอีกช่วงหนึ่ง",
    },

    // ---------- WiFi / Cloud ----------
    {
      type: "terracore_wifi_connect",
      message0: "เชื่อมต่อ WiFi ชื่อ %1 รหัสผ่าน %2",
      args0: [
        { type: "field_input", name: "SSID", text: "MyWiFi" },
        { type: "field_input", name: "PASS", text: "12345678" },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: COLOR.cloud,
      tooltip: "เชื่อมต่อบอร์ดเข้ากับ WiFi",
    },
    {
      type: "terracore_wifi_connected",
      message0: "WiFi เชื่อมต่อแล้ว",
      output: "Boolean",
      colour: COLOR.cloud,
      tooltip: "จริงเมื่อเชื่อมต่อ WiFi สำเร็จ",
    },
    {
      type: "terracore_cloud_send",
      message0: "ส่งขึ้น TerraCORE Cloud คีย์ %1 ค่า %2",
      args0: [
        { type: "field_input", name: "KEY", text: "temperature" },
        { type: "input_value", name: "VALUE" },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: COLOR.cloud,
      tooltip: "ส่งค่าเซนเซอร์ขึ้น Dashboard",
    },
  ]);

  /* ---------------------------------------------------------------------
   * ตัวแปลงเป็น MicroPython
   * ------------------------------------------------------------------- */

  // statementToCode ย่อหน้าให้หนึ่งระดับเสมอ — บล็อกที่อยู่บนสุดต้องถอยกลับมา
  function unindent(code, indent) {
    return code
      .split("\n")
      .map(function (line) {
        return line.startsWith(indent) ? line.slice(indent.length) : line;
      })
      .join("\n");
  }

  // MicroPython รับเฉพาะจำนวนเต็มใน duty() และ sleep_ms()
  // ค่าที่มาจากการหาร เช่น value_map จะเป็น float ต้องครอบ int() ให้
  function asInt(expr) {
    return /^-?\d+$/.test(expr.trim()) ? expr : "int(" + expr + ")";
  }

  function bodyOrPass(gen, block, name) {
    const body = gen.statementToCode(block, name);
    return body.trim() ? body : gen.INDENT + "pass\n";
  }

  Py.forBlock["terracore_on_start"] = function (block, gen) {
    const body = bodyOrPass(gen, block, "DO");
    return "# เมื่อเริ่มทำงาน\n" + unindent(body, gen.INDENT);
  };

  Py.forBlock["terracore_forever"] = function (block, gen) {
    return "while True:\n" + bodyOrPass(gen, block, "DO");
  };

  Py.forBlock["terracore_delay"] = function (block, gen) {
    const t = gen.valueToCode(block, "TIME", Py.ORDER_NONE) || "1000";
    needModule("time");
    return block.getFieldValue("UNIT") === "s"
      ? "time.sleep(" + t + ")\n"
      : "time.sleep_ms(" + asInt(t) + ")\n";
  };

  Py.forBlock["terracore_digital_write"] = function (block, gen) {
    const v = outPin(block.getFieldValue("PIN"));
    const state = gen.valueToCode(block, "STATE", Py.ORDER_NONE) || "0";
    return v + ".value(" + state + ")\n";
  };

  Py.forBlock["terracore_on_off"] = function (block) {
    return [block.getFieldValue("STATE"), Py.ORDER_ATOMIC];
  };

  Py.forBlock["terracore_toggle"] = function (block) {
    const v = outPin(block.getFieldValue("PIN"));
    return v + ".value(not " + v + ".value())\n";
  };

  Py.forBlock["terracore_pwm_write"] = function (block, gen) {
    const v = pwmPin(block.getFieldValue("PIN"));
    const duty = gen.valueToCode(block, "DUTY", Py.ORDER_NONE) || "512";
    return v + ".duty(" + asInt(duty) + ")\n";
  };

  Py.forBlock["terracore_print"] = function (block, gen) {
    const text = gen.valueToCode(block, "TEXT", Py.ORDER_NONE) || "''";
    return "print(" + text + ")\n";
  };

  Py.forBlock["terracore_digital_read"] = function (block) {
    return [
      inPin(block.getFieldValue("PIN"), false) + ".value()",
      Py.ORDER_FUNCTION_CALL,
    ];
  };

  Py.forBlock["terracore_analog_read"] = function (block) {
    return [adcPin(block.getFieldValue("PIN")) + ".read()", Py.ORDER_FUNCTION_CALL];
  };

  Py.forBlock["terracore_button_pressed"] = function (block) {
    // ต่อแบบ PULL_UP: กดแล้วขาลงกราวด์ ค่าจึงเป็น 0
    return [
      inPin(block.getFieldValue("PIN"), true) + ".value() == 0",
      Py.ORDER_RELATIONAL,
    ];
  };

  Py.forBlock["terracore_dht_read"] = function (block) {
    const pin = block.getFieldValue("PIN");
    const model = block.getFieldValue("MODEL");
    const what = block.getFieldValue("WHAT");

    needModule("dht");
    needMachine("Pin");
    const v = "dht_" + pin;
    setupLine(v, v + " = dht." + model + "(Pin(" + pin + "))");
    helper(
      "dht_read",
      "def dht_read(sensor, what):\n" +
        "    \"\"\"อ่านค่าจากเซนเซอร์ DHT — ต้องสั่ง measure() ก่อนทุกครั้ง\"\"\"\n" +
        "    sensor.measure()\n" +
        "    if what == 'temp':\n" +
        "        return sensor.temperature()\n" +
        "    return sensor.humidity()\n"
    );
    return ["dht_read(" + v + ", '" + what + "')", Py.ORDER_FUNCTION_CALL];
  };

  Py.forBlock["terracore_map"] = function (block, gen) {
    const val = gen.valueToCode(block, "VAL", Py.ORDER_NONE) || "0";
    const inMin = gen.valueToCode(block, "IN_MIN", Py.ORDER_NONE) || "0";
    const inMax = gen.valueToCode(block, "IN_MAX", Py.ORDER_NONE) || "4095";
    const outMin = gen.valueToCode(block, "OUT_MIN", Py.ORDER_NONE) || "0";
    const outMax = gen.valueToCode(block, "OUT_MAX", Py.ORDER_NONE) || "100";
    helper(
      "value_map",
      "def value_map(x, in_min, in_max, out_min, out_max):\n" +
        "    \"\"\"เทียบสัดส่วนค่าจากช่วงหนึ่งไปอีกช่วงหนึ่ง\"\"\"\n" +
        "    if in_max == in_min:\n" +
        "        return out_min\n" +
        "    return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min\n"
    );
    return [
      "value_map(" + [val, inMin, inMax, outMin, outMax].join(", ") + ")",
      Py.ORDER_FUNCTION_CALL,
    ];
  };

  Py.forBlock["terracore_wifi_connect"] = function (block, gen) {
    needModule("network", "time");
    helper(
      "wifi_connect",
      "def wifi_connect(ssid, password, timeout_ms=15000):\n" +
        "    \"\"\"เชื่อมต่อ WiFi และรอจนสำเร็จหรือหมดเวลา\"\"\"\n" +
        "    wlan = network.WLAN(network.STA_IF)\n" +
        "    wlan.active(True)\n" +
        "    if not wlan.isconnected():\n" +
        "        print('กำลังเชื่อมต่อ WiFi:', ssid)\n" +
        "        wlan.connect(ssid, password)\n" +
        "        start = time.ticks_ms()\n" +
        "        while not wlan.isconnected():\n" +
        "            if time.ticks_diff(time.ticks_ms(), start) > timeout_ms:\n" +
        "                print('เชื่อมต่อ WiFi ไม่สำเร็จ')\n" +
        "                return False\n" +
        "            time.sleep_ms(200)\n" +
        "    print('เชื่อมต่อแล้ว IP:', wlan.ifconfig()[0])\n" +
        "    return True\n"
    );
    const ssid = gen.quote_(block.getFieldValue("SSID"));
    const pass = gen.quote_(block.getFieldValue("PASS"));
    return "wifi_connect(" + ssid + ", " + pass + ")\n";
  };

  Py.forBlock["terracore_wifi_connected"] = function () {
    needModule("network");
    helper(
      "wifi_connected",
      "def wifi_connected():\n" +
        "    return network.WLAN(network.STA_IF).isconnected()\n"
    );
    return ["wifi_connected()", Py.ORDER_FUNCTION_CALL];
  };

  Py.forBlock["terracore_cloud_send"] = function (block, gen) {
    needModule("urequests");
    constant(
      "TERRACORE_API",
      "TERRACORE_API = 'https://api.terracore.dev/v1/ingest'"
    );
    constant(
      "TERRACORE_DEVICE_TOKEN",
      "TERRACORE_DEVICE_TOKEN = 'ใส่ Device Token ของคุณที่นี่'"
    );
    helper(
      "cloud_send",
      "def cloud_send(key, value):\n" +
        "    \"\"\"ส่งค่าหนึ่งค่าขึ้น TerraCORE Cloud เพื่อแสดงบน Dashboard\"\"\"\n" +
        "    try:\n" +
        "        res = urequests.post(\n" +
        "            TERRACORE_API,\n" +
        "            json={'token': TERRACORE_DEVICE_TOKEN, 'key': key, 'value': value},\n" +
        "        )\n" +
        "        res.close()\n" +
        "        return True\n" +
        "    except Exception as e:\n" +
        "        print('ส่งข้อมูลไม่สำเร็จ:', e)\n" +
        "        return False\n"
    );
    const key = gen.quote_(block.getFieldValue("KEY"));
    const value = gen.valueToCode(block, "VALUE", Py.ORDER_NONE) || "0";
    return "cloud_send(" + key + ", " + value + ")\n";
  };

  /* ---------------------------------------------------------------------
   * ชื่อตัวแปร/ฟังก์ชันภาษาไทย -> ชื่อ ASCII ที่อ่านออก
   *
   * ปกติ Blockly จะแปลงอักษรที่ไม่ใช่ ASCII เป็นรหัสฐานสิบหก เช่น
   * "อุณหภูมิ" กลายเป็น _E0_B8_AD_E0_B8_B8_... ซึ่งอ่านไม่รู้เรื่อง
   * และ MicroPython บนบอร์ดจริงก็ไม่รับชื่อตัวแปรที่ไม่ใช่ ASCII อยู่แล้ว
   * จึงถอดเสียงเป็นอักษรโรมันแบบประมาณ ๆ แล้วแนบตารางเทียบไว้ในโค้ด
   * ------------------------------------------------------------------- */
  const THAI_ROMAN = {
    "ก": "k", "ข": "kh", "ฃ": "kh", "ค": "kh", "ฅ": "kh", "ฆ": "kh", "ง": "ng",
    "จ": "ch", "ฉ": "ch", "ช": "ch", "ซ": "s", "ฌ": "ch", "ญ": "y",
    "ฎ": "d", "ฏ": "t", "ฐ": "th", "ฑ": "th", "ฒ": "th", "ณ": "n",
    "ด": "d", "ต": "t", "ถ": "th", "ท": "th", "ธ": "th", "น": "n",
    "บ": "b", "ป": "p", "ผ": "ph", "ฝ": "f", "พ": "ph", "ฟ": "f", "ภ": "ph",
    "ม": "m", "ย": "y", "ร": "r", "ล": "l", "ว": "w", "ศ": "s", "ษ": "s",
    "ส": "s", "ห": "h", "ฬ": "l", "อ": "o", "ฮ": "h",
    "ฤ": "rue", "ฦ": "lue",
    "ะ": "a", "ั": "a", "า": "a", "ำ": "am", "ิ": "i", "ี": "i",
    "ึ": "ue", "ื": "ue", "ุ": "u", "ู": "u",
    "เ": "e", "แ": "ae", "โ": "o", "ใ": "ai", "ไ": "ai", "ๅ": "a",
    "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4",
    "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9",
  };

  // วรรณยุกต์และเครื่องหมายที่ไม่ออกเสียง — ตัดทิ้ง
  const THAI_SILENT = new Set([
    "่", "้", "๊", "๋", // ่ ้ ๊ ๋
    "์", "็", "ฺ", "ํ", // ์ ็ ฺ ํ
    "ๆ", "ฯ", "๚", "๛", // ๆ ฯ ๚ ๛
  ]);

  const PY_RESERVED = new Set([
    "False", "None", "True", "and", "as", "assert", "async", "await", "break",
    "class", "continue", "def", "del", "elif", "else", "except", "finally",
    "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
    "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
  ]);

  function romanize(text) {
    // สระหน้า (เ แ โ ใ ไ) เขียนก่อนพยัญชนะแต่ออกเสียงตามหลัง — สลับก่อนถอด
    const reordered = text.replace(/([เแโใไ])([ก-ฮ])/g, "$2$1");

    let out = "";
    for (const ch of reordered) {
      if (THAI_SILENT.has(ch)) continue;
      if (THAI_ROMAN[ch]) out += THAI_ROMAN[ch];
      else if (/[A-Za-z0-9]/.test(ch)) out += ch;
      else out += "_";
    }
    out = out.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (!out) out = "var";
    if (/^[0-9]/.test(out)) out = "v_" + out;
    if (PY_RESERVED.has(out)) out += "_";
    return out;
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function remapThaiNames(code, workspace) {
    const notes = [];
    const used = new Set();
    const pairs = [];

    function consider(original, generated) {
      if (!generated) return;
      if (!/[^\x00-\x7F]/.test(original)) {
        used.add(generated); // ชื่อ ASCII อยู่แล้ว จองไว้กันชนกัน
        return;
      }
      pairs.push({ original: original, generated: generated });
    }

    // Blockly เตือนถ้าถามชื่อโดยไม่ผูก variable map ไว้ก่อน
    if (Py.nameDB_ && workspace.getVariableMap) {
      try {
        Py.nameDB_.setVariableMap(workspace.getVariableMap());
      } catch (e) {
        /* เวอร์ชันที่ไม่มีเมธอดนี้ก็ข้ามไป ผลลัพธ์เหมือนเดิม */
      }
    }

    // ต้องส่ง "ชื่อ" ไม่ใช่ id — getVariableName(id) จะคืน id กลับมาเฉย ๆ
    workspace.getAllVariables().forEach(function (v) {
      consider(v.name, Py.getVariableName(v.name));
    });

    try {
      const procs = Blockly.Procedures.allProcedures(workspace);
      procs[0].concat(procs[1]).forEach(function (tuple) {
        consider(tuple[0], Py.getProcedureName(tuple[0]));
      });
    } catch (e) {
      /* ไม่มีฟังก์ชันก็ข้าม */
    }

    pairs.forEach(function (p) {
      const base = romanize(p.original);
      let name = base;
      let i = 2;
      while (used.has(name)) name = base + "_" + i++;
      used.add(name);
      p.safe = name;
      notes.push(name + "  ←  " + p.original);
    });

    // แทนที่ชื่อยาวก่อน กันกรณีชื่อหนึ่งเป็นคำนำหน้าของอีกชื่อ
    pairs.sort(function (a, b) { return b.generated.length - a.generated.length; });

    let out = code;
    pairs.forEach(function (p) {
      out = out.replace(
        new RegExp("\\b" + escapeRe(p.generated) + "\\b", "g"),
        p.safe
      );
    });
    return { code: out, notes: notes };
  }

  /* ---------------------------------------------------------------------
   * ประกอบไฟล์ MicroPython ฉบับสมบูรณ์
   * ------------------------------------------------------------------- */
  function buildImports() {
    const lines = [];
    if (Ctx.machine.size) {
      lines.push(
        "from machine import " + Array.from(Ctx.machine).sort().join(", ")
      );
    }
    Array.from(Ctx.modules)
      .sort()
      .forEach(function (m) {
        lines.push("import " + m);
      });
    return lines;
  }

  function section(title, lines) {
    if (!lines.length) return "";
    return "# --- " + title + " ---\n" + lines.join("\n") + "\n\n";
  }

  function generate(workspace, options) {
    options = options || {};
    Ctx.reset();

    let body = "";
    let nameNotes = [];
    try {
      body = Py.workspaceToCode(workspace);
      // ต้องทำทันทีหลัง generate ตอนตารางชื่อยังอยู่ครบ
      const remapped = remapThaiNames(body, workspace);
      body = remapped.code;
      nameNotes = remapped.notes;
    } catch (err) {
      return (
        "# แปลงโค้ดไม่สำเร็จ\n# " + String(err && err.message ? err.message : err) + "\n"
      );
    }

    const header =
      "# =====================================================\n" +
      "#  TerraCORE IDE — MicroPython\n" +
      "#  โปรเจกต์: " + (options.name || "ไม่มีชื่อ") + "\n" +
      "#  บอร์ด: ESP32\n" +
      "#  ไฟล์นี้สร้างอัตโนมัติจาก Block Code\n" +
      "# =====================================================\n\n";

    if (!body.trim() && !Ctx.setup.size) {
      return (
        header +
        "# ยังไม่มีบล็อกในพื้นที่ทำงาน\n" +
        "# ลากบล็อกจากกล่องเครื่องมือทางซ้ายมาวาง แล้วโค้ดจะขึ้นตรงนี้เอง\n"
      );
    }

    const imports = buildImports();
    const setup = [];
    Ctx.setup.forEach(function (line) {
      setup.push(line);
    });

    return (
      header +
      (imports.length ? imports.join("\n") + "\n\n" : "") +
      section("ค่าคงที่", Array.from(Ctx.consts.values())) +
      (Ctx.helpers.size
        ? "# --- ฟังก์ชันช่วย ---\n" +
          Array.from(Ctx.helpers.values()).join("\n") +
          "\n"
        : "") +
      section("ตั้งค่าอุปกรณ์", setup) +
      section(
        "ชื่อที่ถอดมาจากภาษาไทย",
        nameNotes.map(function (n) { return "# " + n; })
      ) +
      "# --- โปรแกรมหลัก ---\n" +
      body.replace(/\n{3,}/g, "\n\n").trimEnd() +
      "\n"
    );
  }

  global.TerraCoreBlocks = { generate: generate, COLOR: COLOR };
})(window);
