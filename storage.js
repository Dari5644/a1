// storage.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const ACTIVATIONS_FILE = path.join(DATA_DIR, "activations.json");

// تأكد أن مجلد data موجود
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ فشل قراءة JSON:", file, err);
    return fallback;
  }
}

function safeWriteJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("❌ فشل كتابة JSON:", file, err);
  }
}

export function loadOrders() {
  return safeReadJson(ORDERS_FILE, []);
}

export function saveOrders(orders) {
  safeWriteJson(ORDERS_FILE, orders);
}

export function loadActivations() {
  return safeReadJson(ACTIVATIONS_FILE, []);
}

export function saveActivations(activations) {
  safeWriteJson(ACTIVATIONS_FILE, activations);
}

// إضافة طلب جديد
export function addOrder(order) {
  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);
}

// إضافة تفعيل جديد
export function addActivation(activation) {
  const activations = loadActivations();
  activations.push(activation);
  saveActivations(activations);
}

// تحديث حالة تفعيل (مثلاً used = true)
export function updateActivation(id, patch) {
  const activations = loadActivations();
  const idx = activations.findIndex((a) => a.id === id);
  if (idx !== -1) {
    activations[idx] = { ...activations[idx], ...patch };
    saveActivations(activations);
    return activations[idx];
  }
  return null;
}
