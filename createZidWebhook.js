// createZidWebhook.js
import "dotenv/config";
import axios from "axios";

const ZID_TOKEN = process.env.ZID_ACCESS_TOKEN;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function createZidWebhook() {
  try {
    const res = await axios.post(
      "https://api.zid.sa/v1/managers/webhooks",
      {
        url: `${BASE_URL}/zid/webhook`,
        events: ["order.paid"]
      },
      {
        headers: {
          Authorization: `Bearer ${ZID_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ تم إنشاء الويب هوك في زد:", res.data);
  } catch (error) {
    console.error(
      "❌ خطأ في إنشاء الويب هوك:",
      error.response?.data || error.message
    );
  }
}

createZidWebhook();
