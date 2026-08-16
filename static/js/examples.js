/* =========================================================================
 * TerraCORE — โปรแกรมตัวอย่างสำเร็จรูป (Blockly serialization)
 * ========================================================================= */
(function (global) {
  "use strict";

  // ---- ตัวช่วยย่อ เพื่อไม่ต้องเขียน JSON ซ้อนกันลึก ๆ ด้วยมือ ----
  const num = (v) => ({ shadow: { type: "math_number", fields: { NUM: v } } });
  const str = (v) => ({ shadow: { type: "text", fields: { TEXT: v } } });
  const onOff = (v) => ({ shadow: { type: "terracore_on_off", fields: { STATE: v } } });
  const varRef = (v) => ({ block: { type: "variables_get", fields: { VAR: v } } });

  const B = (type, fields, inputs, extra) => {
    const b = { type: type };
    if (fields) b.fields = fields;
    if (inputs) b.inputs = inputs;
    if (extra) b.extraState = extra;
    return b;
  };

  // ต่อบล็อกเรียงลงมาเป็นสายเดียว
  const chain = (blocks) => {
    for (let i = blocks.length - 1; i > 0; i--) {
      blocks[i - 1].next = { block: blocks[i] };
    }
    return blocks[0];
  };

  const stack = (blocks) => ({ block: chain(blocks) });

  const VAR_TEMP = { id: "vTemp", name: "อุณหภูมิ" };
  const VAR_LIGHT = { id: "vLight", name: "ค่าแสง" };

  const EXAMPLES = [
    {
      id: "blink",
      name: "ไฟกะพริบ",
      desc: "พื้นฐานสุด — เปิดปิด LED บนบอร์ดทุกครึ่งวินาที",
      workspace: {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "terracore_forever",
              x: 60,
              y: 60,
              inputs: {
                DO: stack([
                  B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("1") }),
                  B("terracore_delay", { UNIT: "ms" }, { TIME: num(500) }),
                  B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("0") }),
                  B("terracore_delay", { UNIT: "ms" }, { TIME: num(500) }),
                ]),
              },
            },
          ],
        },
      },
    },

    {
      id: "button",
      name: "ปุ่มควบคุมไฟ",
      desc: "กดปุ่มแล้วไฟติด ปล่อยแล้วไฟดับ — สอนเรื่องเงื่อนไข",
      workspace: {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "terracore_forever",
              x: 60,
              y: 60,
              inputs: {
                DO: stack([
                  B(
                    "controls_if",
                    null,
                    {
                      IF0: { block: B("terracore_button_pressed", { PIN: "0" }) },
                      DO0: stack([
                        B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("1") }),
                      ]),
                      ELSE: stack([
                        B("terracore_digital_write", { PIN: "2" }, { STATE: onOff("0") }),
                      ]),
                    },
                    { hasElse: true }
                  ),
                  B("terracore_delay", { UNIT: "ms" }, { TIME: num(50) }),
                ]),
              },
            },
          ],
        },
      },
    },

    {
      id: "sensor_cloud",
      name: "ส่งอุณหภูมิไป AIS Cloud",
      desc: "อ่าน DHT22 แล้วส่งไป AIS Cloud Dashboard ทุก 5 วินาที",
      workspace: {
        variables: [VAR_TEMP],
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "terracore_on_start",
              x: 60,
              y: 40,
              inputs: {
                DO: stack([
                  B("terracore_wifi_connect", { SSID: "MyWiFi", PASS: "12345678" }),
                ]),
              },
            },
            {
              type: "terracore_forever",
              x: 60,
              y: 190,
              inputs: {
                DO: stack([
                  B("variables_set", { VAR: VAR_TEMP }, {
                    VALUE: {
                      block: B("terracore_dht_read", {
                        WHAT: "temp",
                        MODEL: "DHT22",
                        PIN: "15",
                      }),
                    },
                  }),
                  B("terracore_print", null, { TEXT: varRef(VAR_TEMP) }),
                  B("terracore_cloud_send", { KEY: "temperature" }, {
                    VALUE: varRef(VAR_TEMP),
                  }),
                  B("terracore_delay", { UNIT: "s" }, { TIME: num(5) }),
                ]),
              },
            },
          ],
        },
      },
    },

    {
      id: "dimmer",
      name: "หรี่ไฟตามแสง",
      desc: "อ่านค่าอนาล็อกแล้วแปลงช่วงไปคุมความสว่าง PWM",
      workspace: {
        variables: [VAR_LIGHT],
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "terracore_forever",
              x: 60,
              y: 60,
              inputs: {
                DO: stack([
                  B("variables_set", { VAR: VAR_LIGHT }, {
                    VALUE: { block: B("terracore_analog_read", { PIN: "34" }) },
                  }),
                  B("terracore_pwm_write", { PIN: "2" }, {
                    DUTY: {
                      block: B("terracore_map", null, {
                        VAL: varRef(VAR_LIGHT),
                        IN_MIN: num(0),
                        IN_MAX: num(4095),
                        OUT_MIN: num(0),
                        OUT_MAX: num(1023),
                      }),
                    },
                  }),
                  B("terracore_delay", { UNIT: "ms" }, { TIME: num(100) }),
                ]),
              },
            },
          ],
        },
      },
    },
    {
      id: "dimmer_broken",
      name: "หรี่ไฟตามแสง (ต่อผิด)",
      desc: "ตั้งใจต่อผิดไว้ ให้ลองดูว่า Copilot จับได้ไหม",
      workspace: {
        variables: [VAR_LIGHT],
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "terracore_forever",
              x: 60,
              y: 60,
              inputs: {
                DO: stack([
                  B("variables_set", { VAR: VAR_LIGHT }, {
                    VALUE: { block: B("terracore_analog_read", { PIN: "34" }) },
                  }),
                  // ต่อค่า 0–4095 เข้า PWM ที่รับแค่ 0–1023 ตรง ๆ
                  B("terracore_pwm_write", { PIN: "2" }, {
                    DUTY: { block: B("terracore_analog_read", { PIN: "34" }) },
                  }),
                  B("terracore_delay", { UNIT: "ms" }, { TIME: num(100) }),
                ]),
              },
            },
          ],
        },
      },
    },
  ];

  // สร้างใหม่ทุกครั้งที่เรียก กัน object เดิมถูกแก้ระหว่างโหลด
  global.TERRACORE_EXAMPLES = EXAMPLES.map(function (ex) {
    return {
      id: ex.id,
      name: ex.name,
      desc: ex.desc,
      json: JSON.stringify(ex.workspace),
    };
  });
})(window);
