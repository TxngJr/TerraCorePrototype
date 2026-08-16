/*
 * รันตัวแปลง Block -> MicroPython แบบไม่ต้องเปิดเบราว์เซอร์
 * ใช้ตรวจว่าโค้ดที่สร้างออกมายัง compile ผ่านหลังแก้ generator
 *
 *   node tools/gen_examples.js <โฟลเดอร์ปลายทาง>
 */
const fs = require("fs");
const path = require("path");

// ไฟล์ฝั่งหน้าเว็บผูกกับ window — จำลองให้เหมือนอยู่ในเบราว์เซอร์
global.window = global;

// core-node จะต่อ jsdom ให้ Blockly ใช้แทน DOM ของเบราว์เซอร์
const Blockly = require("../node_modules/blockly/core-node.js");
require("../node_modules/blockly/blocks_compressed.js");
const py = require("../node_modules/blockly/python_compressed.js");

// ใน node ไฟล์ภาษาแค่ export ออกมา ต้องรวมเข้า Blockly.Msg เอง
Object.assign(Blockly.Msg, require("../node_modules/blockly/msg/th.js"));

// ในเบราว์เซอร์ UMD จะตั้ง Blockly.Python ให้เอง แต่ใน node ต้องตั้งเอง
Blockly.Python = py.pythonGenerator;
global.Blockly = Blockly;

require("../static/js/blocks.js");
require("../static/js/examples.js");

// นอกเบราว์เซอร์ไม่มี document ให้ Blockly ใช้ตอนสร้าง event — ปิดไปเลย
Blockly.Events.disable();

const outDir = process.argv[2] || path.join(__dirname, "..", "build", "examples");
fs.mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const ex of global.TERRACORE_EXAMPLES) {
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(JSON.parse(ex.json), ws);
    const code = global.TerraCoreBlocks.generate(ws, { name: ex.name });
    const file = path.join(outDir, ex.id + ".py");
    fs.writeFileSync(file, code, "utf8");
    console.log("ok   " + ex.id.padEnd(14) + " -> " + file);
  } catch (err) {
    failed++;
    console.error("FAIL " + ex.id + ": " + err.message);
  } finally {
    ws.dispose();
  }
}
process.exit(failed ? 1 : 0);
