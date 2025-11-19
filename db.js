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
    return { activations: [] };
  }
}

async function saveDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// إنشاء تفعيل جديد
export async function addActivation({
  phone,
  customerName,
  productId,
  productName,
  botType,
  durationDays,
  orderId
}) {
  const db = await loadDB();
  const token =
    Math.random().toString(36).substring(2, 10) +
    Date.now().toString(36).substring(4);

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + durationDays * 24 * 60 * 60 * 1000
  );

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

export async function getActivationByToken(token) {
  const db = await loadDB();
  return db.activations.find((a) => a.token === token);
}

export async function markActivationUsed(token) {
  const db = await loadDB();
  const idx = db.activations.findIndex((a) => a.token === token);
  if (idx !== -1) {
    db.activations[idx].used = true;
    await saveDB(db);
  }
}

export async function getActiveSubscriptionByPhone(phone) {
  const db = await loadDB();
  const now = new Date();
  return db.activations.find(
    (a) => a.phone === phone && new Date(a.expiresAt) > now
  );
}
