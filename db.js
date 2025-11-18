// db.js
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, "data.json");

async function loadDB() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { activations: [] }; // شكل مبدئي
  }
}

async function saveDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// إنشاء سجل تفعيل جديد
export async function addActivation({ phone, customerName, productId, productName, botType, durationDays, orderId }) {
  const db = await loadDB();
  const token = Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const record = {
    token,
    phone,
    customerName,
    productId,
    productName,
    botType,
    durationDays,
    orderId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    used: false
  };

  db.activations.push(record);
  await saveDB(db);
  return record;
}

// جلب التفعيل من التوكن
export async function getActivationByToken(token) {
  const db = await loadDB();
  return db.activations.find(a => a.token === token);
}

// تعليم التوكن كمستخدم
export async function markActivationUsed(token) {
  const db = await loadDB();
  const idx = db.activations.findIndex(a => a.token === token);
  if (idx !== -1) {
    db.activations[idx].used = true;
    await saveDB(db);
  }
}

// دالة يقدر البوت يستخدمها للتأكد من الاشتراك
export async function getActiveSubscriptionByPhone(phone) {
  const db = await loadDB();
  const now = new Date();
  return db.activations.find(
    a =>
      a.phone === phone &&
      !a.used && // لو تبي تخليها تستخدم دائماً ولا single-use، تقدر تشيل هذي
      new Date(a.expiresAt) > now
  );
}
