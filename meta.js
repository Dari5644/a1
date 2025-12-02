// meta.js
import axios from "axios";

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

if (!META_ACCESS_TOKEN) {
  console.warn("⚠️ META_ACCESS_TOKEN غير مضبوط في المتغيرات.");
}
if (!PHONE_NUMBER_ID) {
  console.warn("⚠️ PHONE_NUMBER_ID غير مضبوط في المتغيرات.");
}

export async function sendWhatsAppMessage(toWaId, text) {
  if (!META_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.error("❌ لا يمكن الإرسال، متغيرات Meta غير مكتملة.");
    return;
  }

  try {
    const url =
      "https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/messages";

    const payload = {
      messaging_product: "whatsapp",
      to: toWaId,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    };

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: "Bearer " + META_ACCESS_TOKEN,
        "Content-Type": "application/json"
      }
    });

    console.log(
      "✅ تم إرسال رسالة إلى:",
      toWaId,
      "message_id:",
      res.data && res.data.messages && res.data.messages[0]
        ? res.data.messages[0].id
        : "N/A"
    );
  } catch (err) {
    console.error(
      "❌ خطأ في إرسال رسالة عبر Meta:",
      err.response && err.response.data ? err.response.data : err.message
    );
  }
}
