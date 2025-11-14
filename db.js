// db.js
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ملف قاعدة البيانات (يبقى محفوظ على السيرفر)
const dbPath = path.join(__dirname, 'data', 'bot.sqlite');

// تأكد أن مجلد data موجود
import fs from 'fs';
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

sqlite3.verbose();
export const db = new sqlite3.Database(dbPath);

// إنشاء الجداول
export function initDb() {
  db.serialize(() => {
    // جدول المحادثات
    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_id TEXT NOT NULL,
        name TEXT,
        last_message TEXT,
        last_from TEXT,               -- user / bot / staff
        last_at INTEGER,
        mode TEXT DEFAULT 'bot',      -- bot / human
        assigned_to TEXT,             -- email الموظف
        blocked INTEGER DEFAULT 0,
        created_at INTEGER
      )
    `);

    // جدول الرسائل
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER,
        wa_id TEXT,
        from_type TEXT,               -- user / bot / staff
        body TEXT,
        type TEXT DEFAULT 'text',
        created_at INTEGER,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id)
      )
    `);

    // جدول الموظفين
    db.run(`
      CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        is_owner INTEGER DEFAULT 0
      )
    `);

    // جدول الإشعارات (طلب خدمة عملاء…الخ)
    db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        payload TEXT,
        is_read INTEGER DEFAULT 0,
        created_at INTEGER
      )
    `);

    // إنشاء المالك افتراضياً إذا ما كان موجود
    db.get(`SELECT * FROM staff WHERE is_owner = 1 LIMIT 1`, (err, row) => {
      if (err) return console.error('DB owner check error:', err);
      if (!row) {
        db.run(
          `INSERT INTO staff (name, email, password, is_owner) VALUES (?, ?, ?, 1)`,
          ['المالك', 'owner@example.com', '123456'],
          err2 => {
            if (err2) console.error('DB insert owner error:', err2);
            else console.log('✅ Owner user created (email: owner@example.com / pass: 123456)');
          }
        );
      }
    });
  });
}

// دوال مساعدة

export function getOrCreateConversation(wa_id, name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM conversations WHERE wa_id = ? LIMIT 1`,
      [wa_id],
      (err, row) => {
        if (err) return reject(err);
        const now = Date.now();

        if (row) return resolve(row);

        db.run(
          `INSERT INTO conversations
           (wa_id, name, last_message, last_from, last_at, mode, created_at)
           VALUES (?, ?, ?, 'user', ?, 'bot', ?)`,
          [wa_id, name || '', '', now, now],
          function (err2) {
            if (err2) return reject(err2);
            db.get(
              `SELECT * FROM conversations WHERE id = ?`,
              [this.lastID],
              (err3, row2) => {
                if (err3) return reject(err3);
                resolve(row2);
              }
            );
          }
        );
      }
    );
  });
}

export function addMessage(conversationId, wa_id, from_type, body, type = 'text') {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    db.run(
      `INSERT INTO messages (conversation_id, wa_id, from_type, body, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [conversationId, wa_id, from_type, body, type, now],
      function (err) {
        if (err) return reject(err);

        // تحديث آخر رسالة في المحادثة
        db.run(
          `UPDATE conversations
           SET last_message = ?, last_from = ?, last_at = ?
           WHERE id = ?`,
          [body, from_type, now, conversationId],
          err2 => {
            if (err2) return reject(err2);
            resolve(this.lastID);
          }
        );
      }
    );
  });
}

export function setConversationMode(conversationId, mode, assigned_to = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE conversations SET mode = ?, assigned_to = ? WHERE id = ?`,
      [mode, assigned_to, conversationId],
      err => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function getConversationById(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM conversations WHERE id = ?`, [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

export function getConversationByWaId(wa_id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM conversations WHERE wa_id = ?`, [wa_id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

export function listConversations(limit = 100) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM conversations ORDER BY last_at DESC LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

export function getMessagesForConversation(conversationId, limit = 200) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [conversationId, limit],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

export function addNotification(type, payload) {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    db.run(
      `INSERT INTO notifications (type, payload, created_at)
       VALUES (?, ?, ?)`,
      [type, JSON.stringify(payload), now],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

export function listNotifications(onlyUnread = false) {
  return new Promise((resolve, reject) => {
    let sql = `SELECT * FROM notifications`;
    if (onlyUnread) sql += ` WHERE is_read = 0`;
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

export function markNotificationRead(id) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE notifications SET is_read = 1 WHERE id = ?`, [id], err => {
      if (err) return reject(err);
      resolve();
    });
  });
}
