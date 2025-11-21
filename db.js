// db.js
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "smartbot.db");

sqlite3.verbose();
export const db = new sqlite3.Database(dbPath);

// =============================
// Initialize DB
// =============================
export function initDb() {
  db.serialize(() => {
    // جدول الإعدادات
    db.run(
      "CREATE TABLE IF NOT EXISTS settings (" +
        "key TEXT PRIMARY KEY," +
        "value TEXT" +
      ");"
    );

    // جدول جهات الاتصال
    db.run(
      "CREATE TABLE IF NOT EXISTS contacts (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "wa_id TEXT UNIQUE," +
        "display_name TEXT," +
        "bot_paused INTEGER DEFAULT 0," +
        "created_at TEXT DEFAULT (datetime('now'))" +
      ");"
    );

    // جدول الرسائل
    db.run(
      "CREATE TABLE IF NOT EXISTS messages (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "contact_id INTEGER," +
        "from_me INTEGER," +
        "body TEXT," +
        "type TEXT," +
        "timestamp TEXT," +
        "FOREIGN KEY(contact_id) REFERENCES contacts(id)" +
      ");"
    );

    // قيم افتراضية
    db.run(
      "INSERT OR IGNORE INTO settings(key, value) VALUES('bot_name', 'Smart Bot');"
    );
    db.run(
      "INSERT OR IGNORE INTO settings(key, value) VALUES('bot_avatar', 'https://ui-avatars.com/api/?name=Smart+Bot&background=0D8ABC&color=fff');"
    );
  });
}

// =============================
// Settings
// =============================
export function getSetting(key) {
  return new Promise((resolve, reject) => {
    db.get("SELECT value FROM settings WHERE key = ?", [key], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.value : null);
    });
  });
}

export function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO settings(key, value) VALUES(?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

// =============================
// Contacts
// =============================
export function upsertContact(wa_id, display_name) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO contacts(wa_id, display_name) VALUES(?, ?) " +
        "ON CONFLICT(wa_id) DO UPDATE SET display_name = excluded.display_name",
      [wa_id, display_name],
      function (err) {
        if (err) return reject(err);

        db.get(
          "SELECT * FROM contacts WHERE wa_id = ?",
          [wa_id],
          (err2, row) => {
            if (err2) return reject(err2);
            resolve(row);
          }
        );
      }
    );
  });
}

export function getContactByWaId(wa_id) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM contacts WHERE wa_id = ?", [wa_id], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

export function getContacts() {
  return new Promise((resolve, reject) => {
    const sql =
      "SELECT c.*, " +
      "(SELECT body FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message, " +
      "(SELECT timestamp FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_timestamp " +
      "FROM contacts c " +
      "ORDER BY last_timestamp DESC, created_at DESC";

    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// =============================
// Messages
// =============================
export function getMessagesByContact(contactId) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM messages WHERE contact_id = ? ORDER BY id ASC",
      [contactId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

export function insertMessage(contactId, fromMe, body, type, timestamp) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO messages(contact_id, from_me, body, type, timestamp) " +
        "VALUES(?, ?, ?, ?, ?)",
      [contactId, fromMe ? 1 : 0, body, type || "text", timestamp],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

// =============================
// Bot Pause
// =============================
export function setBotPausedForContactId(contactId, paused) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE contacts SET bot_paused = ? WHERE id = ?",
      [paused ? 1 : 0, contactId],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function setBotPausedForPhone(wa_id, paused) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE contacts SET bot_paused = ? WHERE wa_id = ?",
      [paused ? 1 : 0, wa_id],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

// =============================
// Delete Contact
// =============================
export function deleteContact(contactId) {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM messages WHERE contact_id = ?", [contactId], (err) => {
      if (err) return reject(err);

      db.run("DELETE FROM contacts WHERE id = ?", [contactId], (err2) => {
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}
