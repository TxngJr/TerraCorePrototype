/* =========================================================================
 * TerraCORE — กล่องเครื่องมือ (Toolbox)
 * ========================================================================= */
(function (global) {
  "use strict";

  const C = global.TerraCoreBlocks.COLOR;

  // shadow block ช่วยให้เด็กเริ่มได้เลยโดยไม่ต้องลากบล็อกตัวเลขมาต่อเอง
  const num = (v) => ({ shadow: { type: "math_number", fields: { NUM: v } } });
  const txt = (v) => ({ shadow: { type: "text", fields: { TEXT: v } } });

  global.TERRACORE_TOOLBOX = {
    kind: "categoryToolbox",
    contents: [
      {
        kind: "category",
        name: "เริ่มต้น",
        colour: C.start,
        contents: [
          { kind: "block", type: "terracore_on_start" },
          { kind: "block", type: "terracore_forever" },
          {
            kind: "block",
            type: "terracore_delay",
            inputs: { TIME: num(1000) },
          },
        ],
      },
      {
        kind: "category",
        name: "เอาต์พุต",
        colour: C.output,
        contents: [
          {
            kind: "block",
            type: "terracore_digital_write",
            inputs: { STATE: { shadow: { type: "terracore_on_off" } } },
          },
          { kind: "block", type: "terracore_on_off" },
          { kind: "block", type: "terracore_toggle" },
          {
            kind: "block",
            type: "terracore_pwm_write",
            inputs: { DUTY: num(512) },
          },
          {
            kind: "block",
            type: "terracore_print",
            inputs: { TEXT: txt("สวัสดี TerraCORE") },
          },
        ],
      },
      {
        kind: "category",
        name: "อินพุต / เซนเซอร์",
        colour: C.input,
        contents: [
          { kind: "block", type: "terracore_digital_read" },
          { kind: "block", type: "terracore_analog_read" },
          { kind: "block", type: "terracore_button_pressed" },
          { kind: "block", type: "terracore_dht_read" },
          {
            kind: "block",
            type: "terracore_map",
            inputs: {
              IN_MIN: num(0),
              IN_MAX: num(4095),
              OUT_MIN: num(0),
              OUT_MAX: num(100),
            },
          },
        ],
      },
      {
        kind: "category",
        name: "WiFi & Cloud",
        colour: C.cloud,
        contents: [
          { kind: "block", type: "terracore_wifi_connect" },
          { kind: "block", type: "terracore_wifi_connected" },
          {
            kind: "block",
            type: "terracore_cloud_send",
            inputs: { VALUE: num(0) },
          },
        ],
      },
      { kind: "sep" },
      {
        kind: "category",
        name: "ตรรกะ",
        colour: "210",
        contents: [
          { kind: "block", type: "controls_if" },
          { kind: "block", type: "logic_compare" },
          { kind: "block", type: "logic_operation" },
          { kind: "block", type: "logic_negate" },
          { kind: "block", type: "logic_boolean" },
        ],
      },
      {
        kind: "category",
        name: "วนซ้ำ",
        colour: "120",
        contents: [
          {
            kind: "block",
            type: "controls_repeat_ext",
            inputs: { TIMES: num(10) },
          },
          { kind: "block", type: "controls_whileUntil" },
          {
            kind: "block",
            type: "controls_for",
            inputs: { FROM: num(1), TO: num(10), BY: num(1) },
          },
        ],
      },
      {
        kind: "category",
        name: "คณิตศาสตร์",
        colour: "230",
        contents: [
          { kind: "block", type: "math_number" },
          {
            kind: "block",
            type: "math_arithmetic",
            inputs: { A: num(1), B: num(1) },
          },
          { kind: "block", type: "math_single", inputs: { NUM: num(9) } },
          { kind: "block", type: "math_round", inputs: { NUM: num(3.1) } },
          {
            kind: "block",
            type: "math_modulo",
            inputs: { DIVIDEND: num(64), DIVISOR: num(10) },
          },
          {
            kind: "block",
            type: "math_constrain",
            inputs: { VALUE: num(50), LOW: num(1), HIGH: num(100) },
          },
          {
            kind: "block",
            type: "math_random_int",
            inputs: { FROM: num(1), TO: num(100) },
          },
        ],
      },
      {
        kind: "category",
        name: "ข้อความ",
        colour: "160",
        contents: [
          { kind: "block", type: "text" },
          { kind: "block", type: "text_join" },
        ],
      },
      { kind: "sep" },
      { kind: "category", name: "ตัวแปร", colour: "330", custom: "VARIABLE" },
      { kind: "category", name: "ฟังก์ชัน", colour: "290", custom: "PROCEDURE" },
    ],
  };
})(window);
