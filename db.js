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
    const obj = JSON.parse(raw);
    if (!obj.activations) obj.activations = [];
    return obj;
  } catch {
    return { activations: [] };
  }
}

async function saveDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

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
    used: false,
    paused: false // افتراضياً البوت شغال
  };

  db.activations.push(record);
  await saveDB(db);
  return record;
}

// ترجع آخر اشتراك نشط لهذا الرقم
export async function getActiveSubscriptionByPhone(phone) {
  const db = await loadDB();
  const now = new Date();
  const list = db.activations
    .filter((a) => a.phone === phone && new Date(a.expiresAt) > now)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list[0] || null;
}

// تحديث حالة البوت (موقّف/شغال) لهذا الرقم
export async function setBotPausedForPhone(phone, paused) {
  const db = await loadDB();
  let changed = false;
  for (const a of db.activations) {
    if (a.phone === phone) {
      a.paused = !!paused;
      changed = true;
    }
  }
  if (changed) {
    await saveDB(db);
  }
}
