// meta.js
import axios from "axios";
import { PHONE_NUMBER_ID } from "./config.js";

const META_BASE_URL = "https://graph.facebook.com/v21.0";
const META_TOKEN = process.env.META_ACCESS_TOKEN;

if (!META_TOKEN) {
  console.warn("⚠️ META_ACCESS_TOKEN غير مضبوط في متغيرات البيئة.");
}

export async function sendWhatsAppMessageMeta(toWaId, text) {
  if (!META_TOKEN) {
    console.error("❌ لا يوجد META_ACCESS_TOKEN");
    return;
  }
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: toWaId,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    };

    const url = `${META_BASE_URL}/${PHONE_NUMBER_ID}/messages`;

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${META_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    console.log("✅ تم إرسال رسالة عبر Meta إلى:", toWaId, "id:", res.data.messages?.[0]?.id);
  } catch (err) {
    console.error("❌ خطأ في إرسال رسالة عبر Meta:", err.response?.data || err.message);
  }
}
