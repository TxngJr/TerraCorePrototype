"""
TerraCORE IDE - Prototype
Block Code -> MicroPython, เก็บโปรเจกต์ใน SQLite

รัน:  python3 app.py    แล้วเปิด http://127.0.0.1:5001
"""

import json
import sqlite3
import os
from datetime import datetime, timezone
from contextlib import closing

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
# Static
# --------------------------------------------------------------------------


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/healthz")
def healthz():
    """Lightweight endpoint for container liveness/readiness probes."""
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "5001"))
    print(f"TerraCORE IDE  ->  http://127.0.0.1:{port}   (db: {DB_PATH})")
    app.run(host="127.0.0.1", port=port, debug=True)
