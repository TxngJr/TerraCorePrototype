/* AIS Cloud Dashboard — telemetry + command mock prototype */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    projectName: $("projectName"),
    connectionState: $("connectionState"),
    connectionLabel: $("connectionLabel"),
    deviceId: $("deviceId"),
    lastSeen: $("lastSeen"),
    packetCount: $("packetCount"),
    metricGrid: $("metricGrid"),
    activityList: $("activityList"),
    activityCount: $("activityCount"),
    simulationToggle: $("simulationToggle"),
    ledControl: $("ledControl"),
    fanControl: $("fanControl"),
    fanValue: $("fanValue"),
    pumpControl: $("pumpControl"),
    dashboardToken: $("dashboardToken"),
    toast: $("dashboardToast"),
    fatalError: $("fatalError"),
    fatalMessage: $("fatalMessage"),
  };

  const token = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
  const state = {
    data: null,
    metricEls: Object.create(null),
    simulation: true,
    ticking: false,
    timer: null,
    toastTimer: null,
  };

  async function api(path, options) {
    const res = await fetch(
      path,
      Object.assign({ headers: { "Content-Type": "application/json" } }, options)
    );
    let body = null;
    try { body = await res.json(); } catch (e) { /* response ว่าง */ }
    if (!res.ok) throw new Error((body && body.error) || "AIS Cloud API ตอบกลับ " + res.status);
    return body;
  }

  function formatNumber(value, decimals) {
    return Number(value).toLocaleString("th-TH", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatClock(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function showToast(message, isError) {
    els.toast.textContent = message;
    els.toast.className = "dashboard-toast" + (isError ? " is-error" : "");
    els.toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { els.toast.hidden = true; }, 2500);
  }

  function setConnection() {
    els.connectionState.className = "connection-pill";
    if (!state.simulation) {
      els.connectionState.classList.add("is-paused");
      els.connectionLabel.textContent = "Simulator หยุดชั่วคราว";
      return;
    }
    if (!state.data || !state.data.last_seen_at) {
      els.connectionState.classList.add("is-connecting");
      els.connectionLabel.textContent = "กำลังเชื่อมต่อ";
      return;
    }
    els.connectionLabel.textContent = "ออนไลน์ · รับส่งข้อมูลอยู่";
  }

  function gaugeMarkup(channel) {
    const min = Number(channel.min);
    const max = Number(channel.max);
    return (
      '<div class="metric-head">' +
        '<div><span class="metric-name"></span><span class="metric-key"></span></div>' +
        '<span class="live-mini">LIVE</span>' +
      '</div>' +
      '<div class="gauge-wrap">' +
        '<svg class="gauge-svg" viewBox="0 0 200 135" aria-hidden="true">' +
          '<path class="gauge-track" d="M20 111 A80 80 0 0 1 180 111" pathLength="100"/>' +
          '<path class="gauge-progress" d="M20 111 A80 80 0 0 1 180 111" pathLength="100"/>' +
          '<g class="gauge-needle"><line class="gauge-needle-line" x1="100" y1="111" x2="100" y2="46"/><circle class="gauge-needle-hub" cx="100" cy="111" r="5"/></g>' +
        '</svg>' +
        '<div class="gauge-value"><span>—</span><small></small></div>' +
      '</div>' +
      '<div class="gauge-limits"><span>' + min + '</span><span>' + max + '</span></div>' +
      '<div class="sparkline"><svg viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">' +
        '<path class="sparkline-area"></path><polyline class="sparkline-line"></polyline>' +
      '</svg></div>'
    );
  }

  function buildMetricCards() {
    els.metricGrid.innerHTML = "";
    state.metricEls = Object.create(null);
    state.data.channels.forEach(function (channel) {
      const card = document.createElement("article");
      card.className = "metric-card";
      card.dataset.key = channel.key;
      card.innerHTML = gaugeMarkup(channel);
      card.querySelector(".metric-name").textContent = channel.label;
      card.querySelector(".metric-key").textContent = channel.key;
      card.querySelector(".gauge-value small").textContent = channel.unit || "value";
      card.querySelector(".gauge-progress").style.stroke = channel.color;
      card.querySelector(".sparkline-line").style.stroke = channel.color;
      card.querySelector(".sparkline-area").style.fill = channel.color;
      els.metricGrid.appendChild(card);
      state.metricEls[channel.key] = card;
    });
  }

  function historyFor(key) {
    return (state.data.history || []).filter(function (item) { return item.key === key; }).slice(-38);
  }

  function updateSparkline(card, channel) {
    const samples = historyFor(channel.key);
    if (samples.length < 2) return;
    const range = Number(channel.max) - Number(channel.min) || 1;
    const points = samples.map(function (sample, index) {
      const x = index * (300 / (samples.length - 1));
      const pct = Math.max(0, Math.min(1, (Number(sample.value) - Number(channel.min)) / range));
      return [x, 55 - pct * 49];
    });
    const pointText = points.map(function (point) { return point[0].toFixed(1) + "," + point[1].toFixed(1); }).join(" ");
    card.querySelector(".sparkline-line").setAttribute("points", pointText);
    card.querySelector(".sparkline-area").setAttribute(
      "d",
      "M " + points[0][0].toFixed(1) + " 60 L " + pointText.replace(/ /g, " L ") + " L 300 60 Z"
    );
  }

  function updateMetrics() {
    state.data.channels.forEach(function (channel) {
      const card = state.metricEls[channel.key];
      const reading = state.data.latest[channel.key];
      if (!card || !reading) return;
      const minimum = Number(channel.min);
      const maximum = Number(channel.max);
      const value = Number(reading.value);
      const pct = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum || 1)));
      card.querySelector(".gauge-progress").style.strokeDasharray = (pct * 100).toFixed(2) + " 100";
      card.querySelector(".gauge-needle").style.transform = "rotate(" + (-90 + pct * 180).toFixed(2) + "deg)";
      card.querySelector(".gauge-value span").textContent = formatNumber(value, Number(channel.decimals || 0));
      card.querySelector(".live-mini").title = "รับล่าสุด " + formatClock(reading.created_at);
      updateSparkline(card, channel);
    });
  }

  function commandLabel(command) {
    if (command.key === "led") return "LED บนบอร์ด";
    if (command.key === "fan_speed") return "ความเร็วพัดลม";
    if (command.key === "water_pump") return "ปั๊มน้ำ";
    return command.key;
  }

  function commandValue(command) {
    if (command.key === "led") return command.value ? "เปิด" : "ปิด";
    if (command.key === "fan_speed") return command.value + "%";
    if (command.key === "water_pump") return command.value + " วินาที";
    return String(command.value);
  }

  function renderActivity() {
    const telemetry = (state.data.history || []).slice(-12).map(function (item) {
      return { type: "telemetry", at: item.created_at, item: item };
    });
    const commands = (state.data.commands || []).map(function (item) {
      return { type: "command", at: item.created_at, item: item };
    });
    const activity = telemetry.concat(commands).sort(function (a, b) {
      return new Date(b.at) - new Date(a.at);
    }).slice(0, 9);

    els.activityList.innerHTML = "";
    els.activityCount.textContent = activity.length + " รายการ";
    if (!activity.length) {
      const empty = document.createElement("p");
      empty.className = "activity-empty";
      empty.textContent = "ยังไม่มีข้อมูลรับ–ส่ง";
      els.activityList.appendChild(empty);
      return;
    }

    activity.forEach(function (entry) {
      const row = document.createElement("div");
      row.className = "activity-item" + (entry.type === "command" ? " is-command" : "");
      const icon = document.createElement("span");
      icon.className = "activity-icon";
      icon.textContent = entry.type === "command" ? "TX" : "RX";
      const main = document.createElement("div");
      main.className = "activity-main";
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      const value = document.createElement("span");
      value.className = "activity-value";

      if (entry.type === "command") {
        title.textContent = commandLabel(entry.item);
        detail.textContent = "ส่งคำสั่ง · " + formatClock(entry.at);
        value.textContent = commandValue(entry.item) + " · " + (entry.item.status === "delivered" ? "ถึงอุปกรณ์แล้ว" : "รอรับ");
        value.classList.add("activity-status");
        if (entry.item.status === "delivered") value.classList.add("is-delivered");
      } else {
        const channel = state.data.channels.find(function (item) { return item.key === entry.item.key; });
        title.textContent = entry.item.key;
        detail.textContent = "รับ telemetry · " + formatClock(entry.at);
        value.textContent = formatNumber(entry.item.value, channel ? channel.decimals : 1) + (channel && channel.unit ? " " + channel.unit : "");
      }
      main.appendChild(title);
      main.appendChild(detail);
      row.appendChild(icon);
      row.appendChild(main);
      row.appendChild(value);
      els.activityList.appendChild(row);
    });
  }

  function render() {
    if (!state.data) return;
    els.projectName.textContent = state.data.project_name;
    document.title = state.data.project_name + " — AIS Cloud";
    els.deviceId.textContent = state.data.device_id;
    els.lastSeen.textContent = "ล่าสุด " + formatClock(state.data.last_seen_at);
    els.packetCount.textContent = Number(state.data.packet_count || 0).toLocaleString("th-TH");
    els.dashboardToken.textContent = "dashboard/" + token.slice(0, 8) + "…";
    setConnection();
    updateMetrics();
    renderActivity();
  }

  async function tick() {
    if (!state.simulation || state.ticking) return;
    state.ticking = true;
    try {
      state.data = await api("/api/dashboards/" + encodeURIComponent(token) + "/mock-tick", {
        method: "POST",
      });
      render();
    } catch (e) {
      showToast("รับข้อมูลจำลองไม่สำเร็จ: " + e.message, true);
    } finally {
      state.ticking = false;
    }
  }

  async function sendCommand(key, value, label) {
    try {
      const command = await api("/api/dashboards/" + encodeURIComponent(token) + "/commands", {
        method: "POST",
        body: JSON.stringify({ key: key, value: value }),
      });
      state.data.commands.unshift(command);
      state.data.commands = state.data.commands.slice(0, 12);
      renderActivity();
      showToast("ส่งคำสั่ง “" + label + "” เข้า AIS Cloud queue แล้ว");
    } catch (e) {
      showToast("ส่งคำสั่งไม่สำเร็จ: " + e.message, true);
    }
  }

  function bindControls() {
    els.simulationToggle.addEventListener("click", function () {
      state.simulation = !state.simulation;
      els.simulationToggle.setAttribute("aria-pressed", String(state.simulation));
      els.simulationToggle.textContent = state.simulation ? "หยุดข้อมูลจำลอง" : "เล่นข้อมูลจำลอง";
      setConnection();
      if (state.simulation) tick();
    });

    els.ledControl.addEventListener("change", function () {
      sendCommand("led", els.ledControl.checked, els.ledControl.checked ? "เปิด LED" : "ปิด LED");
    });
    els.fanControl.addEventListener("input", function () {
      els.fanValue.textContent = els.fanControl.value + "%";
    });
    els.fanControl.addEventListener("change", function () {
      sendCommand("fan_speed", Number(els.fanControl.value), "พัดลม " + els.fanControl.value + "%");
    });
    els.pumpControl.addEventListener("click", function () {
      els.pumpControl.classList.add("is-active");
      els.pumpControl.textContent = "กำลังรดน้ำ…";
      sendCommand("water_pump", 3, "รดน้ำ 3 วินาที");
      setTimeout(function () {
        els.pumpControl.classList.remove("is-active");
        els.pumpControl.textContent = "สั่งรดน้ำ";
      }, 1000);
    });
  }

  async function boot() {
    if (!token) {
      els.fatalMessage.textContent = "ลิงก์ไม่มี AIS Cloud Dashboard token";
      els.fatalError.hidden = false;
      return;
    }
    bindControls();
    try {
      state.data = await api("/api/dashboards/" + encodeURIComponent(token));
      buildMetricCards();
      render();
      state.timer = setInterval(tick, 1600);
      setTimeout(tick, 450);
    } catch (e) {
      els.fatalMessage.textContent = e.message;
      els.fatalError.hidden = false;
    }
  }

  boot();
})();
