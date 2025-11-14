// db.js
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const dbPath = path.join(dataDir, "bot.sqlite");

export const db = new Database(dbPath);

// ============= إنشاء الجداول =============
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      name TEXT,
      last_message TEXT,
      last_from TEXT,
      last_at INTEGER,
      mode TEXT DEFAULT 'bot',
      assigned_to TEXT,
      blocked INTEGER DEFAULT 0,
      created_at INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER,
      wa_id TEXT,
      from_type TEXT,
      body TEXT,
      type TEXT DEFAULT 'text',
      created_at INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      is_owner INTEGER DEFAULT 0
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      payload TEXT,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER
    );
  `);

  const owner = db.prepare(`SELECT * FROM staff WHERE is_owner = 1`).get();
  if (!owner) {
    db.prepare(`
      INSERT INTO staff (name, email, password, is_owner)
      VALUES (?, ?, ?, 1)
    `).run("المالك", "owner@example.com", "123456");
  }
}

// ============ دوال المساعدة =============

export function getOrCreateConversation(wa_id, name) {
  let conv = db.prepare(`SELECT * FROM conversations WHERE wa_id = ?`).get(wa_id);
  const now = Date.now();

  if (conv) return conv;

  const result = db.prepare(`
    INSERT INTO conversations
    (wa_id, name, last_message, last_from, last_at, mode, created_at)
    VALUES (?, ?, ?, 'user', ?, 'bot', ?)
  `).run(wa_id, name || "", "", now, now);

  return db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(result.lastInsertRowid);
}

export function addMessage(conversationId, wa_id, from_type, body, type = "text") {
  const now = Date.now();

  db.prepare(`
    INSERT INTO messages (conversation_id, wa_id, from_type, body, type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(conversationId, wa_id, from_type, body, type, now);

  db.prepare(`
    UPDATE conversations 
    SET last_message = ?, last_from = ?, last_at = ?
    WHERE id = ?
  `).run(body, from_type, now, conversationId);
}

export function setConversationMode(conversationId, mode, assigned_to = null) {
  db.prepare(`
    UPDATE conversations SET mode = ?, assigned_to = ? WHERE id = ?
  `).run(mode, assigned_to, conversationId);
}

export function getConversationById(id) {
  return db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id);
}

export function getConversationByWaId(wa_id) {
  return db.prepare(`SELECT * FROM conversations WHERE wa_id = ?`).get(wa_id);
}

export function listConversations(limit = 200) {
  return db.prepare(`
    SELECT * FROM conversations ORDER BY last_at DESC LIMIT ?
  `).all(limit);
}

export function getMessagesForConversation(conversationId, limit = 200) {
  return db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?
  `).all(conversationId, limit);
}

export function addNotification(type, payload) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO notifications (type, payload, created_at)
    VALUES (?, ?, ?)
  `).run(type, JSON.stringify(payload), now);
}
