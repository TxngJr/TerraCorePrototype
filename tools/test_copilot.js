/*
 * ทดสอบกฎของ Copilot โดยไม่ต้องเปิดเบราว์เซอร์
 *
 *   node tools/test_copilot.js
 *
 * แต่ละเคสสร้าง workspace ขึ้นมาแล้วถามว่ากฎไหนควรทำงาน
 * ใช้ตรวจว่ากฎยังจับสถานการณ์ได้ถูกหลังแก้ตัวกฎหรือแก้บล็อก
 */
const assert = require("assert");

global.window = global;

const Blockly = require("../node_modules/blockly/core-node.js");
require("../node_modules/blockly/blocks_compressed.js");
const py = require("../node_modules/blockly/python_compressed.js");
Blockly.Python = py.pythonGenerator;
Object.assign(Blockly.Msg, require("../node_modules/blockly/msg/th.js"));
global.Blockly = Blockly;

require("../static/js/blocks.js");
require("../static/js/copilot.js");

const RULES = global.TerraCoreCopilot.rules;

/* ---------------------------------------------------------------- ตัวช่วย */
const num = (v) => ({ shadow: { type: "math_number", fields: { NUM: v } } });
const onOff = (v) => ({ shadow: { type: "terracore_on_off", fields: { STATE: v } } });
const B = (type, fields, inputs) => {
  const b = { type };
  if (fields) b.fields = fields;
  if (inputs) b.inputs = inputs;
  return b;
};
const chain = (blocks) => {
  for (let i = blocks.length - 1; i > 0; i--) blocks[i - 1].next = { block: blocks[i] };
  return blocks[0];
};
const loop = (body) => ({
  type: "terracore_forever",
  inputs: { DO: { block: chain(body) } },
});

const DELAY = () => B("terracore_delay", { UNIT: "ms" }, { TIME: num(500) });
const DHT = () => B("terracore_dht_read", { WHAT: "temp", MODEL: "DHT22", PIN: "15" });

// กฎตัวแรกที่จับได้ คือกฎที่ Copilot จะเสนอจริง
function firstMatch(json) {
  const ws = new Blockly.Workspace();
  // รับได้ทั้งบล็อกเดี่ยวและหลายกองบนสุด (เช่น "เมื่อเริ่มทำงาน" คู่กับลูป
  // ซึ่งต่อกันไม่ได้เพราะบล็อกเริ่มทำงานไม่มีจุดต่อด้านล่าง)
  const tops = json ? (Array.isArray(json) ? json : [json]) : [];
  if (tops.length) {
    Blockly.serialization.workspaces.load(
      { blocks: { languageVersion: 0, blocks: tops } },
      ws
    );
  }
  for (const rule of RULES) {
    const plan = rule.match(ws);
    if (plan) return { id: rule.id, plan, ws };
  }
  return { id: null, plan: null, ws };
}

/* ----------------------------------------------------------------- เคส */
const CASES = [
  {
    name: "พื้นที่ว่าง -> ชวนเริ่มไฟกะพริบ",
    json: null,
    expect: "empty-start",
    place: "top",
  },
  {
    name: "ลูปไม่มีหน่วงเวลา -> เตือนเรื่องหน่วงเวลา",
    json: loop([B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("1") })]),
    expect: "loop-needs-delay",
    place: "connect",
  },
  {
    name: "เปิดไฟแต่ไม่ปิด -> ชวนปิดให้ครบจังหวะ",
    json: loop([
      B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("1") }),
      DELAY(),
    ]),
    expect: "finish-the-blink",
    place: "connect",
  },
  {
    name: "ส่ง Cloud แต่ไม่ต่อ WiFi -> เตือนต่อ WiFi ก่อน",
    json: loop([
      B("terracore_cloud_send", { KEY: "temperature" }, { VALUE: num(0) }),
      DELAY(),
    ]),
    expect: "wifi-before-cloud",
    place: "top",
  },
  {
    name: "อ่านเซนเซอร์แต่ไม่ส่งไปไหน -> ชวนส่งขึ้น Dashboard",
    json: loop([
      B("variables_set", { VAR: { id: "vT", name: "อุณหภูมิ" } }, { VALUE: { block: DHT() } }),
      DELAY(),
    ]),
    expect: "send-sensor-to-cloud",
    place: "connect",
  },
  {
    name: "ส่งขึ้น Cloud แล้วแต่ไม่แสดงค่า -> ชวนใส่ print",
    json: [
      {
        type: "terracore_on_start",
        inputs: { DO: { block: B("terracore_wifi_connect", { SSID: "a", PASS: "b" }) } },
      },
      loop([
        B("terracore_cloud_send", { KEY: "temperature" }, { VALUE: { block: DHT() } }),
        DELAY(),
      ]),
    ],
    expect: "print-sensor-value",
    place: "connect",
  },
  {
    name: "ต่อขาอนาล็อกเข้า PWM ตรง ๆ -> ชวนครอบด้วยบล็อกแปลงช่วงค่า",
    json: loop([
      B("terracore_pwm_write", { PIN: "2" }, {
        DUTY: { block: B("terracore_analog_read", { PIN: "34" }) },
      }),
      DELAY(),
    ]),
    expect: "map-analog-to-pwm",
    place: "wrap",
  },
  {
    name: "ครอบด้วยบล็อกแปลงช่วงค่าแล้ว -> ไม่ต้องเสนอซ้ำ",
    json: loop([
      B("terracore_pwm_write", { PIN: "2" }, {
        DUTY: {
          block: B("terracore_map", null, {
            VAL: { block: B("terracore_analog_read", { PIN: "34" }) },
            IN_MIN: num(0), IN_MAX: num(4095), OUT_MIN: num(0), OUT_MAX: num(1023),
          }),
        },
      }),
      DELAY(),
    ]),
    // กฎอื่นอาจยังมีอะไรแนะนำได้ (เช่นชวนส่งค่าขึ้น Dashboard) แต่ต้องไม่ใช่
    // การชวนครอบซ้ำ เพราะครอบไปแล้ว
    notExpect: "map-analog-to-pwm",
  },
  {
    name: "ไฟกะพริบครบแล้ว -> ไม่ต้องเสนออะไร",
    json: loop([
      B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("1") }),
      DELAY(),
      B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("0") }),
      DELAY(),
    ]),
    expect: null,
  },
];

/* ----------------------------------------------------------------- รัน */
let failed = 0;
for (const c of CASES) {
  let got;
  try {
    got = firstMatch(c.json);
    if ("notExpect" in c) {
      assert.notStrictEqual(got.id, c.notExpect);
    } else {
      assert.strictEqual(got.id, c.expect);
    }
    if (c.place) assert.strictEqual(got.plan.place, c.place);
    // ข้อเสนอชนิดต่อเข้าไป ต้องชี้ไปยังจุดต่อจริงที่ยังว่างอยู่
    if (c.place === "connect") {
      assert.ok(got.plan.connection, "ต้องมี connection ให้ต่อ");
      assert.ok(!got.plan.connection.targetBlock(), "จุดต่อต้องยังว่าง");
    }
    // ชนิดครอบต้องชี้ไปยังจุดที่ "มีบล็อกเสียบอยู่แล้ว" และตัวครอบต้องมีช่องรับ
    if (c.place === "wrap") {
      assert.ok(got.plan.connection.targetBlock(), "จุดที่จะครอบต้องมีบล็อกอยู่");
      assert.ok(got.plan.innerInput, "ต้องบอกว่าจะยัดบล็อกเดิมเข้าช่องไหน");
    }
    console.log("ok   " + c.name + "  -> " + (got.id || "ไม่เสนอ"));
  } catch (err) {
    failed++;
    const want = "notExpect" in c ? "ไม่ใช่ " + c.notExpect : JSON.stringify(c.expect);
    console.error("FAIL " + c.name);
    console.error("     คาดว่า " + want + " แต่ได้ " +
                  JSON.stringify(got && got.id) + " (" + err.message + ")");
  } finally {
    if (got && got.ws) got.ws.dispose();
  }
}

console.log(failed ? `\n${failed} เคสไม่ผ่าน` : `\nผ่านทั้งหมด ${CASES.length} เคส`);
process.exit(failed ? 1 : 0);
