"""
TerraCORE IDE - Prototype
Block Code -> MicroPython, เก็บโปรเจกต์ใน SQLite

รัน:  python3 app.py    แล้วเปิด http://127.0.0.1:5001
"""

import json
import math
import os
import random
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone

from flask import Flask, g, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("TERRACORE_DB", os.path.join(BASE_DIR, "terracore.db"))

app = Flask(__name__, static_folder="static", static_url_path="/static")


# --------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    board          TEXT    NOT NULL DEFAULT 'esp32',
    workspace_json TEXT    NOT NULL DEFAULT '{}',   -- Blockly serialization
    code           TEXT    NOT NULL DEFAULT '',     -- MicroPython ล่าสุด
    mode           TEXT    NOT NULL DEFAULT 'block',-- 'block' | 'code'
    code_dirty     INTEGER NOT NULL DEFAULT 0,      -- 1 = โค้ดถูกแก้มือ (หลุดจาก block)
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_json TEXT    NOT NULL DEFAULT '{}',
    code           TEXT    NOT NULL DEFAULT '',
    mode           TEXT    NOT NULL DEFAULT 'block',
    note           TEXT    NOT NULL DEFAULT '',
    created_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revisions_project
    ON revisions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dashboards (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    public_token   TEXT    NOT NULL UNIQUE,
    device_token   TEXT    NOT NULL UNIQUE,
    channel_json   TEXT    NOT NULL DEFAULT '[]',
    provisioned_at TEXT    NOT NULL,
    last_flash_at  TEXT    NOT NULL,
    last_seen_at   TEXT
);

CREATE TABLE IF NOT EXISTS telemetry (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id   INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    channel_key    TEXT    NOT NULL,
    value          REAL    NOT NULL,
    created_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_dashboard
    ON telemetry(dashboard_id, id DESC);

CREATE TABLE IF NOT EXISTS device_commands (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id   INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    command_key    TEXT    NOT NULL,
    value_json     TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'queued',
    created_at     TEXT    NOT NULL,
    delivered_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_commands_dashboard
    ON device_commands(dashboard_id, id DESC);
"""

# เก็บ revision ไว้กี่ชุดต่อโปรเจกต์
MAX_REVISIONS = 30


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with closing(sqlite3.connect(DB_PATH)) as db:
        db.executescript(SCHEMA)
        db.commit()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


CHANNEL_PRESETS = {
    "temperature": {
        "label": "อุณหภูมิ",
        "unit": "°C",
        "min": 0,
        "max": 50,
        "decimals": 1,
        "color": "#ef8354",
        "baseline": 28,
        "amplitude": 4.5,
    },
    "humidity": {
        "label": "ความชื้นอากาศ",
        "unit": "%",
        "min": 0,
        "max": 100,
        "decimals": 0,
        "color": "#3b82a0",
        "baseline": 62,
        "amplitude": 11,
    },
    "light": {
        "label": "ความเข้มแสง",
        "unit": "lux",
        "min": 0,
        "max": 1000,
        "decimals": 0,
        "color": "#d39b2c",
        "baseline": 610,
        "amplitude": 260,
    },
    "soil": {
        "label": "ความชื้นดิน",
        "unit": "%",
        "min": 0,
        "max": 100,
        "decimals": 0,
        "color": "#4c956c",
        "baseline": 54,
        "amplitude": 9,
    },
    "pm25": {
        "label": "ฝุ่น PM2.5",
        "unit": "µg/m³",
        "min": 0,
        "max": 150,
        "decimals": 0,
        "color": "#826aed",
        "baseline": 28,
        "amplitude": 13,
    },
}


def _channel_preset(key):
    """เลือกหน้าตาเกจจากชื่อ key โดยยังเก็บ key เดิมจากบล็อกไว้."""
    lowered = key.casefold()
    if any(word in lowered for word in ("temp", "temperature", "อุณหภูมิ")):
        preset_name = "temperature"
    elif any(word in lowered for word in ("soil", "moisture", "ความชื้นดิน")):
        preset_name = "soil"
    elif any(word in lowered for word in ("humid", "ความชื้น")):
        preset_name = "humidity"
    elif any(word in lowered for word in ("light", "lux", "ldr", "photo", "แสง")):
        preset_name = "light"
    elif any(word in lowered for word in ("pm2", "dust", "ฝุ่น")):
        preset_name = "pm25"
    else:
        preset_name = "generic"

    if preset_name == "generic":
        preset = {
            "label": key.replace("_", " ").strip().title() or "Sensor",
            "unit": "",
            "min": 0,
            "max": 100,
            "decimals": 1,
            "color": "#5b4be8",
            "baseline": 50,
            "amplitude": 18,
        }
    else:
        preset = dict(CHANNEL_PRESETS[preset_name])
    return {"key": key, **preset}


def infer_channels(code):
    """อ่านชื่อ channel จาก cloud_send('key', value); ไม่มีให้ใช้ชุดเดโม."""
    keys = []
    pattern = re.compile(r"cloud_send\(\s*(['\"])([^'\"]+)\1\s*,")
    for match in pattern.finditer(code or ""):
        key = match.group(2).strip()[:48]
        if key and key not in keys:
            keys.append(key)
    if not keys:
        keys = ["temperature", "humidity", "light"]
    return [_channel_preset(key) for key in keys[:6]]


def _load_channels(row):
    try:
        channels = json.loads(row["channel_json"])
    except (json.JSONDecodeError, TypeError):
        channels = []
    return channels or infer_channels("")


def _mock_value(channel, sample_time, index=0):
    minimum = float(channel.get("min", 0))
    maximum = float(channel.get("max", 100))
    baseline = float(channel.get("baseline", (minimum + maximum) / 2))
    amplitude = float(channel.get("amplitude", (maximum - minimum) * 0.18))
    wave = math.sin(sample_time / (5.8 + index * 1.4) + index * 1.7)
    noise = random.uniform(-amplitude * 0.045, amplitude * 0.045)
    value = max(minimum, min(maximum, baseline + amplitude * wave + noise))
    return round(value, int(channel.get("decimals", 1)))


def _dashboard_row_by_project(pid):
    return get_db().execute(
        """SELECT d.*, p.name AS project_name
             FROM dashboards d
             JOIN projects p ON p.id = d.project_id
            WHERE d.project_id = ?""",
        (pid,),
    ).fetchone()


def _dashboard_row_by_token(token):
    return get_db().execute(
        """SELECT d.*, p.name AS project_name
             FROM dashboards d
             JOIN projects p ON p.id = d.project_id
            WHERE d.public_token = ?""",
        (token,),
    ).fetchone()


def _dashboard_summary(row):
    if row is None:
        return None
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "project_name": row["project_name"],
        "token": row["public_token"],
        "dashboard_url": f"/dashboard/{row['public_token']}",
        "device_id": f"ESP32-{row['project_id']:04d}",
        "channels": _load_channels(row),
        "provisioned_at": row["provisioned_at"],
        "last_flash_at": row["last_flash_at"],
        "last_seen_at": row["last_seen_at"],
    }


def _dashboard_detail(row):
    summary = _dashboard_summary(row)
    db = get_db()
    readings = db.execute(
        """SELECT channel_key, value, created_at
             FROM (
                 SELECT channel_key, value, created_at, id
                   FROM telemetry
                  WHERE dashboard_id = ?
                  ORDER BY id DESC
                  LIMIT 180
             )
            ORDER BY id ASC""",
        (row["id"],),
    ).fetchall()
    history = [
        {"key": item["channel_key"], "value": item["value"], "created_at": item["created_at"]}
        for item in readings
    ]
    latest = {}
    for item in history:
        latest[item["key"]] = {"value": item["value"], "created_at": item["created_at"]}

    command_rows = db.execute(
        """SELECT id, command_key, value_json, status, created_at, delivered_at
             FROM device_commands
            WHERE dashboard_id = ?
            ORDER BY id DESC
            LIMIT 12""",
        (row["id"],),
    ).fetchall()
    commands = []
    for command in command_rows:
        try:
            value = json.loads(command["value_json"])
        except (json.JSONDecodeError, TypeError):
            value = command["value_json"]
        commands.append(
            {
                "id": command["id"],
                "key": command["command_key"],
                "value": value,
                "status": command["status"],
                "created_at": command["created_at"],
                "delivered_at": command["delivered_at"],
            }
        )
    packet_count = db.execute(
        "SELECT COUNT(*) FROM telemetry WHERE dashboard_id = ?", (row["id"],)
    ).fetchone()[0]
    summary.update(
        {
            "latest": latest,
            "history": history,
            "commands": commands,
            "packet_count": packet_count,
        }
    )
    return summary


def row_to_project(row, with_content=True):
    out = {
        "id": row["id"],
        "name": row["name"],
        "board": row["board"],
        "mode": row["mode"],
        "code_dirty": bool(row["code_dirty"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if with_content:
        try:
            out["workspace"] = json.loads(row["workspace_json"])
        except (json.JSONDecodeError, TypeError):
            out["workspace"] = {}
        out["code"] = row["code"]
        out["dashboard"] = _dashboard_summary(_dashboard_row_by_project(row["id"]))
    return out


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------


@app.get("/api/projects")
def list_projects():
    rows = get_db().execute(
        "SELECT * FROM projects ORDER BY updated_at DESC"
    ).fetchall()
    return jsonify([row_to_project(r, with_content=False) for r in rows])


@app.post("/api/projects")
def create_project():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip() or "โปรเจกต์ใหม่"
    ts = now()
    db = get_db()
    cur = db.execute(
        """INSERT INTO projects
           (name, board, workspace_json, code, mode, code_dirty, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)""",
        (
            name,
            data.get("board") or "esp32",
            json.dumps(data.get("workspace") or {}, ensure_ascii=False),
            data.get("code") or "",
            data.get("mode") or "block",
            ts,
            ts,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM projects WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_project(row)), 201


@app.get("/api/projects/<int:pid>")
def get_project(pid):
    row = get_db().execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if row is None:
        return jsonify({"error": "ไม่พบโปรเจกต์"}), 404
    return jsonify(row_to_project(row))


@app.put("/api/projects/<int:pid>")
def update_project(pid):
    data = request.get_json(silent=True) or {}
    db = get_db()
    row = db.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if row is None:
        return jsonify({"error": "ไม่พบโปรเจกต์"}), 404

    name = (data.get("name") or row["name"]).strip() or row["name"]
    workspace_json = (
        json.dumps(data["workspace"], ensure_ascii=False)
        if "workspace" in data
        else row["workspace_json"]
    )
    code = data.get("code", row["code"])
    mode = data.get("mode", row["mode"])
    code_dirty = int(bool(data.get("code_dirty", row["code_dirty"])))

    db.execute(
        """UPDATE projects
              SET name = ?, board = ?, workspace_json = ?, code = ?,
                  mode = ?, code_dirty = ?, updated_at = ?
            WHERE id = ?""",
        (
            name,
            data.get("board", row["board"]),
            workspace_json,
            code,
            mode,
            code_dirty,
            now(),
            pid,
        ),
    )

    # snapshot เฉพาะตอนกด save เอง ไม่ใช่ autosave — กัน revision ท่วม
    if data.get("snapshot"):
        db.execute(
            """INSERT INTO revisions
               (project_id, workspace_json, code, mode, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (pid, workspace_json, code, mode, data.get("note") or "", now()),
        )
        db.execute(
            """DELETE FROM revisions
                WHERE project_id = ?
                  AND id NOT IN (
                      SELECT id FROM revisions
                       WHERE project_id = ?
                       ORDER BY created_at DESC, id DESC
                       LIMIT ?
                  )""",
            (pid, pid, MAX_REVISIONS),
        )

    db.commit()
    row = db.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    return jsonify(row_to_project(row))


@app.delete("/api/projects/<int:pid>")
def delete_project(pid):
    db = get_db()
    cur = db.execute("DELETE FROM projects WHERE id = ?", (pid,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "ไม่พบโปรเจกต์"}), 404
    return jsonify({"ok": True})


@app.get("/api/projects/<int:pid>/revisions")
def list_revisions(pid):
    rows = get_db().execute(
        """SELECT id, mode, note, created_at
             FROM revisions
            WHERE project_id = ?
            ORDER BY created_at DESC, id DESC""",
        (pid,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/api/revisions/<int:rid>")
def get_revision(rid):
    row = get_db().execute("SELECT * FROM revisions WHERE id = ?", (rid,)).fetchone()
    if row is None:
        return jsonify({"error": "ไม่พบเวอร์ชัน"}), 404
    try:
        workspace = json.loads(row["workspace_json"])
    except (json.JSONDecodeError, TypeError):
        workspace = {}
    return jsonify(
        {
            "id": row["id"],
            "project_id": row["project_id"],
            "workspace": workspace,
            "code": row["code"],
            "mode": row["mode"],
            "note": row["note"],
            "created_at": row["created_at"],
        }
    )


# --------------------------------------------------------------------------
# Mock upload + AIS Cloud Dashboard
# --------------------------------------------------------------------------


def _seed_mock_telemetry(dashboard_id, channels):
    """เติม history เริ่มต้นเพื่อให้หน้าเดโมมีกราฟทันทีหลัง provision."""
    db = get_db()
    db.execute("DELETE FROM telemetry WHERE dashboard_id = ?", (dashboard_id,))
    db.execute("DELETE FROM device_commands WHERE dashboard_id = ?", (dashboard_id,))
    current = datetime.now(timezone.utc)
    for sample_index in range(36):
        sample_dt = current - timedelta(seconds=(35 - sample_index) * 2)
        sample_iso = sample_dt.isoformat(timespec="seconds")
        for channel_index, channel in enumerate(channels):
            value = _mock_value(channel, sample_dt.timestamp(), channel_index)
            db.execute(
                """INSERT INTO telemetry (dashboard_id, channel_key, value, created_at)
                   VALUES (?, ?, ?, ?)""",
                (dashboard_id, channel["key"], value, sample_iso),
            )
    db.execute(
        "UPDATE dashboards SET last_seen_at = ? WHERE id = ?",
        (current.isoformat(timespec="seconds"), dashboard_id),
    )


@app.post("/api/projects/<int:pid>/mock-upload")
def mock_upload(pid):
    """จำลอง flash สำเร็จและ provision dashboard ให้โปรเจกต์อัตโนมัติ."""
    data = request.get_json(silent=True) or {}
    db = get_db()
    project = db.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if project is None:
        return jsonify({"error": "ไม่พบโปรเจกต์"}), 404

    code = data.get("code", project["code"])
    if not isinstance(code, str):
        return jsonify({"error": "code ต้องเป็นข้อความ"}), 400
    channels = infer_channels(code)
    channels_json = json.dumps(channels, ensure_ascii=False)
    ts = now()
    dashboard = _dashboard_row_by_project(pid)

    if dashboard is None:
        cur = db.execute(
            """INSERT INTO dashboards
               (project_id, public_token, device_token, channel_json,
                provisioned_at, last_flash_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                pid,
                secrets.token_urlsafe(9),
                secrets.token_urlsafe(24),
                channels_json,
                ts,
                ts,
                ts,
            ),
        )
        dashboard_id = cur.lastrowid
    else:
        dashboard_id = dashboard["id"]
        db.execute(
            """UPDATE dashboards
                  SET channel_json = ?, last_flash_at = ?, last_seen_at = ?
                WHERE id = ?""",
            (channels_json, ts, ts, dashboard_id),
        )

    _seed_mock_telemetry(dashboard_id, channels)
    db.commit()
    dashboard = _dashboard_row_by_project(pid)
    mock_ingest_url = request.url_root.rstrip("/") + "/api/cloud/ingest"
    result = _dashboard_summary(dashboard)
    result.update(
        {
            "mock_device_token": dashboard["device_token"],
            "mock_ingest_url": mock_ingest_url,
            "firmware_bytes": len(code.encode("utf-8")),
            "firmware_configured": False,
            "network_mode": "local-simulator",
            "mock": True,
        }
    )
    return jsonify(result), 201


@app.get("/api/dashboards/<token>")
def get_dashboard(token):
    dashboard = _dashboard_row_by_token(token)
    if dashboard is None:
        return jsonify({"error": "ไม่พบ Dashboard"}), 404
    return jsonify(_dashboard_detail(dashboard))


@app.post("/api/dashboards/<token>/mock-tick")
def mock_dashboard_tick(token):
    """ESP32 simulator: ส่ง telemetry รอบใหม่และรับ command ที่ค้างอยู่."""
    dashboard = _dashboard_row_by_token(token)
    if dashboard is None:
        return jsonify({"error": "ไม่พบ Dashboard"}), 404
    db = get_db()
    sample_dt = datetime.now(timezone.utc)
    sample_iso = sample_dt.isoformat(timespec="seconds")
    for index, channel in enumerate(_load_channels(dashboard)):
        db.execute(
            """INSERT INTO telemetry (dashboard_id, channel_key, value, created_at)
               VALUES (?, ?, ?, ?)""",
            (
                dashboard["id"],
                channel["key"],
                _mock_value(channel, sample_dt.timestamp(), index),
                sample_iso,
            ),
        )
    db.execute(
        "UPDATE dashboards SET last_seen_at = ? WHERE id = ?",
        (sample_iso, dashboard["id"]),
    )
    db.execute(
        """UPDATE device_commands
              SET status = 'delivered', delivered_at = ?
            WHERE dashboard_id = ? AND status = 'queued'""",
        (sample_iso, dashboard["id"]),
    )
    db.execute(
        """DELETE FROM telemetry
            WHERE dashboard_id = ?
              AND id NOT IN (
                  SELECT id FROM telemetry
                   WHERE dashboard_id = ?
                   ORDER BY id DESC LIMIT 600
              )""",
        (dashboard["id"], dashboard["id"]),
    )
    db.commit()
    return jsonify(_dashboard_detail(_dashboard_row_by_token(token)))


@app.post("/api/dashboards/<token>/commands")
def create_device_command(token):
    dashboard = _dashboard_row_by_token(token)
    if dashboard is None:
        return jsonify({"error": "ไม่พบ Dashboard"}), 404
    data = request.get_json(silent=True) or {}
    command_key = str(data.get("key") or "").strip()[:48]
    if not command_key or "value" not in data:
        return jsonify({"error": "ต้องระบุ key และ value"}), 400
    ts = now()
    db = get_db()
    cur = db.execute(
        """INSERT INTO device_commands
           (dashboard_id, command_key, value_json, status, created_at)
           VALUES (?, ?, ?, 'queued', ?)""",
        (dashboard["id"], command_key, json.dumps(data["value"], ensure_ascii=False), ts),
    )
    db.commit()
    return (
        jsonify(
            {
                "id": cur.lastrowid,
                "key": command_key,
                "value": data["value"],
                "status": "queued",
                "created_at": ts,
                "delivered_at": None,
            }
        ),
        202,
    )


@app.post("/api/cloud/ingest")
def cloud_ingest():
    """Endpoint แบบเดียวกับที่ firmware จริงจะ POST ค่าเข้ามา."""
    data = request.get_json(silent=True) or {}
    device_token = str(data.get("token") or "")
    db = get_db()
    dashboard = db.execute(
        "SELECT * FROM dashboards WHERE device_token = ?", (device_token,)
    ).fetchone()
    if dashboard is None:
        return jsonify({"error": "Mock Device Token ไม่ถูกต้อง"}), 401
    key = str(data.get("key") or "").strip()[:48]
    allowed_keys = {item["key"] for item in _load_channels(dashboard)}
    if key not in allowed_keys:
        return jsonify({"error": "ไม่พบ channel นี้ใน Dashboard"}), 400
    try:
        value = float(data.get("value"))
    except (TypeError, ValueError):
        return jsonify({"error": "value ต้องเป็นตัวเลข"}), 400
    if not math.isfinite(value):
        return jsonify({"error": "value ต้องเป็นตัวเลขที่มีค่าจำกัด"}), 400
    ts = now()
    db.execute(
        """INSERT INTO telemetry (dashboard_id, channel_key, value, created_at)
           VALUES (?, ?, ?, ?)""",
        (dashboard["id"], key, value, ts),
    )
    db.execute(
        "UPDATE dashboards SET last_seen_at = ? WHERE id = ?", (ts, dashboard["id"])
    )
    db.commit()
    return jsonify({"ok": True, "received_at": ts}), 202


@app.get("/api/cloud/devices/<device_token>/commands")
def device_poll_commands(device_token):
    """Endpoint ที่ ESP32 ใช้ poll คำสั่งจาก Dashboard ใน prototype."""
    db = get_db()
    dashboard = db.execute(
        "SELECT * FROM dashboards WHERE device_token = ?", (device_token,)
    ).fetchone()
    if dashboard is None:
        return jsonify({"error": "Mock Device Token ไม่ถูกต้อง"}), 401
    rows = db.execute(
        """SELECT * FROM device_commands
            WHERE dashboard_id = ? AND status = 'queued'
            ORDER BY id ASC LIMIT 20""",
        (dashboard["id"],),
    ).fetchall()
    delivered_at = now()
    if rows:
        db.executemany(
            """UPDATE device_commands
                  SET status = 'delivered', delivered_at = ?
                WHERE id = ?""",
            [(delivered_at, row["id"]) for row in rows],
        )
        db.commit()
    return jsonify(
        [
            {
                "id": row["id"],
                "key": row["command_key"],
                "value": json.loads(row["value_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]
    )


# --------------------------------------------------------------------------
# Static
# --------------------------------------------------------------------------


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/dashboard/<token>")
def dashboard_page(token):
    # token ถูกอ่านโดย dashboard.js; route นี้แยกหน้า cloud ออกจาก IDE ชัดเจน
    return send_from_directory(app.static_folder, "dashboard.html")


@app.get("/healthz")
def healthz():
    """Lightweight endpoint for container liveness/readiness probes."""
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "5001"))
    print(f"TerraCORE IDE  ->  http://127.0.0.1:{port}   (db: {DB_PATH})")
    app.run(host="127.0.0.1", port=port, debug=True)
