/* =========================================================================
 * TerraCORE — ตัวไฮไลต์ syntax ของ Python แบบเบา ๆ (ไม่ต้องพึ่ง library)
 * ========================================================================= */
(function (global) {
  "use strict";

  const KEYWORDS = new Set([
    "False", "None", "True", "and", "as", "assert", "async", "await", "break",
    "class", "continue", "def", "del", "elif", "else", "except", "finally",
    "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
    "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
  ]);

  const BUILTINS = new Set([
    "abs", "bool", "bytearray", "bytes", "dict", "enumerate", "float", "int",
    "len", "list", "max", "min", "open", "ord", "chr", "print", "range",
    "round", "set", "sorted", "str", "sum", "tuple", "type", "isinstance",
    "Exception", "self",
    // ที่พบบ่อยใน MicroPython
    "Pin", "ADC", "PWM", "machine", "time", "network", "dht", "urequests",
    "DHT11", "DHT22", "WLAN",
  ]);

  const TOKEN = new RegExp(
    [
      "(#[^\\n]*)",                                   // 1 คอมเมนต์
      "('''[\\s\\S]*?'''|\"\"\"[\\s\\S]*?\"\"\"" +
        "|'(?:\\\\.|[^'\\\\\\n])*'" +
        "|\"(?:\\\\.|[^\"\\\\\\n])*\")",              // 2 สตริง
      "(@[A-Za-z_]\\w*)",                             // 3 เดคอเรเตอร์
      "\\b(\\d[\\w.]*)\\b",                           // 4 ตัวเลข
      "\\b([A-Za-z_]\\w*)\\b",                        // 5 ตัวระบุ
    ].join("|"),
    "g"
  );

  function esc(s) {
    return s.replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  function span(cls, text) {
    return '<span class="' + cls + '">' + esc(text) + "</span>";
  }

  function highlight(code) {
    let out = "";
    let last = 0;
    let prevWord = null;
    let m;

    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(code)) !== null) {
      out += esc(code.slice(last, m.index));
      last = TOKEN.lastIndex;

      if (m[1]) {
        out += span("t-com", m[1]);
      } else if (m[2]) {
        out += span("t-str", m[2]);
      } else if (m[3]) {
        out += span("t-dec", m[3]);
      } else if (m[4]) {
        out += span("t-num", m[4]);
      } else {
        const w = m[5];
        if (KEYWORDS.has(w)) {
          out += span("t-kw", w);
          prevWord = w; // จำไว้เพื่อระบายสีชื่อฟังก์ชันหลัง def / class
          continue;
        }
        if (prevWord === "def" || prevWord === "class") {
          out += span("t-def", w);
        } else if (BUILTINS.has(w)) {
          out += span("t-bif", w);
        } else {
          out += esc(w);
        }
        prevWord = null;
      }
    }
    out += esc(code.slice(last));
    return out;
  }

  function lineNumbers(code) {
    const n = code.split("\n").length;
    const rows = new Array(n);
    for (let i = 0; i < n; i++) rows[i] = i + 1;
    return rows.join("\n");
  }

  global.TerraCoreHL = { highlight: highlight, lineNumbers: lineNumbers };
})(window);
