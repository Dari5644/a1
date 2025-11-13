// server.js
// بوت واتساب + ذكاء اصطناعي

import express from "express";

const app = express();
app.use(express.json());

// ============ الإعدادات ============

// نفس التوكن اللي حطيته في صفحة Webhooks داخل واتساب
const VERIFY_TOKEN = "mawaheb_verify";

// توكن واتساب WABA (اللي عطيتني إياه)
const WABA_TOKEN =
  "EAAMlJZBsLvHQBP8xKH0xP7MW7nggFBrbkmZCVH6psRPUJChlWp0cNGqCj4GJOEZADDVVa8C6Oq99m75n5JNG09daDkJo1hQLFRQtAvWFre4W5eZAU6sFeYXEZBDmVD816Q8sh42IqzVZAZCvilZAfF9cPMSqbUbEInd8TDKaoyZAMX6qdxKmJZArc6OzEt1YLcmDmBOfFER3hXXfwMAZAZA4n3l3NN0Mz33DNja3QLEZBZBZBZBgdQZDZD";

// مفتاح OpenAI (اللي عطيتني إياه)
const OPENAI_KEY =
  "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";

// المنفذ (Render يعطيه من ENV)
const PORT = process.env.PORT || 10000;

// ============ التحقق من Webhook (GET) ============

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  } else {
    console.log("❌ WEBHOOK_VERIFY_FAILED", { mode, token });
    return res.sendStatus(403);
  }
});

// ============ استقبال رسائل واتساب (POST) ============

app.post("/webhook", async (req, res) => {
  // لازم نرجع 200 بسرعة عشان واتساب ما يعيد المحاولة
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    const metadata = value?.metadata;

    if (!messages || !metadata) {
      return;
    }

    const msg = messages[0];
    const phoneNumberId = metadata.phone_number_id; // ID لرقم الواتساب
    const from = msg.from; // رقم المرسل (بصيغة دولية)

    console.log("📩 Incoming message:", JSON.stringify(msg, null, 2));

    // نتعامل فقط مع الرسائل النصية
    if (msg.type !== "text") {
      await sendWhatsAppMessage(
        phoneNumberId,
        from,
        "أرسل سؤالك نصيًا من فضلك ✍️"
      );
      return;
    }

    const userText = (msg.text?.body || "").trim();

    // لو المستخدم طلب موظف
    if (/موظف|بشري|خدمة عملاء|تواصل/i.test(userText)) {
      await sendWhatsAppMessage(
        phoneNumberId,
        from,
        "تم تحويلك لموظف خدمة العملاء في أقرب وقت بإذن الله 🤝"
      );
      return;
    }

    // نسأل الذكاء الاصطناعي
    const aiReply = await askOpenAI(userText);

    await sendWhatsAppMessage(
      phoneNumberId,
      from,
      aiReply || "لم أفهم سؤالك جيدًا، هل توضح أكثر؟ 🙂"
    );
  } catch (err) {
    console.error("❌ Error in POST /webhook:", err);
  }
});

// ============ دوال المساعدة ============

// سؤال OpenAI والرجوع بالرد
async function askOpenAI(userMessage) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `أنت بوت واتساب ذكي يتبع "جمعية تنمية المواهب".
ترد بالعربية الفصحى المبسطة، باختصار ووضوح.
لا تخترع معلومات، وإذا لم تكن متأكدًا اطلب توضيحًا أو اقترح تحويل المحادثة لموظف خدمة العملاء.`,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
      }),
    });

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content?.trim();
    console.log("🤖 AI reply:", answer);
    return answer;
  } catch (err) {
    console.error("❌ Error calling OpenAI:", err);
    return "حدث خطأ في خدمة الذكاء الاصطناعي، حاول لاحقًا أو تواصل مع موظف خدمة العملاء.";
  }
}

// إرسال رسالة واتساب
async function sendWhatsAppMessage(phoneNumberId, to, body) {
  try {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        preview_url: false,
        body,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WABA_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("❌ WhatsApp API error:", resp.status, errorText);
    } else {
      console.log("✅ Message sent to", to);
    }
  } catch (err) {
    console.error("❌ Error sending WhatsApp message:", err);
  }
}

// ============ مسار بسيط لاختبار السيرفر ============

app.get("/", (req, res) => {
  res.send("WhatsApp AI bot is running ✅");
});

// ============ تشغيل السيرفر ============

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
