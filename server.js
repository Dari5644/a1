// server.js
// بوت واتساب + ذكاء اصطناعي (Express)

import express from "express";

// لو تستخدم Node 18+ عندك fetch جاهز، ما تحتاج node-fetch
// لو صار خطأ في fetch، ثبّت node-fetch واستبدل السطر:
// import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ================= الإعدادات =================

// توكن التحقق اللي حطيته في Meta Webhook
const VERIFY_TOKEN = "mawaheb_verify";

// WABA TOKEN (رمز الوصول للواتساب)
const WABA_TOKEN =
  "EAAMlJZBsLvHQBP8xKH0xP7MW7nggFBrbkmZCVH6psRPUJChlWp0cNGqCj4GJOEZADDVVa8C6Oq99m75n5JNG09daDkJo1hQLFRQtAvWFre4W5eZAU6sFeYXEZBDmVD816Q8sh42IqzVZAZCvilZAfF9cPMSqbUbEInd8TDKaoyZAMX6qdxKmJZArc6OzEt1YLcmDmBOfFER3hXXfwMAZAZA4n3l3NN0Mz33DNja3QLEZBZBZBZBgdQZDZD";

// مفتاح OpenAI
const OPENAI_KEY =
  "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";

// رقمك (للاستخدام لو احتجته) – بصيغة دولية
const OWNER_PHONE = "966561340876";

// المنفذ من Render أو 10000 محلياً
const PORT = process.env.PORT || 10000;

// ============= Webhook Verification (GET) =============

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      console.log("❌ Wrong verify token:", token);
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// ============= استقبال رسائل واتساب (POST) =============

app.post("/webhook", async (req, res) => {
  try {
    // تأكيد الاستلام لمتا أولاً
    res.sendStatus(200);

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
    const from = msg.from; // رقم الشخص اللي أرسل

    // نستقبل فقط الرسائل النصية
    if (msg.type !== "text") {
      await sendWhatsAppMessage(
        phoneNumberId,
        from,
        "أرسل سؤالك نصيًا من فضلك ✍️"
      );
      return;
    }

    const userText = (msg.text?.body || "").trim();
    console.log("📩 Received:", userText, "from", from);

    // لو طلب موظف بشري
    if (/موظف|بشري|خدمة عملاء|تواصل/i.test(userText)) {
      await sendWhatsAppMessage(
        phoneNumberId,
        from,
        "تم تحويلك لموظف خدمة العملاء في أقرب وقت بإذن الله 🤝"
      );
      return;
    }

    // استدعاء OpenAI للرد
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

// ============= دوال المساعدة =============

// سؤال الذكاء الاصطناعي
async function askOpenAI(userMessage) {
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
          { role: "user", content: userMessage },
        ],
      }),
    });

    const data = await resp.json();
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
      const text = await resp.text();
      console.error("❌ WhatsApp API error:", resp.status, text);
    } else {
      console.log("✅ Message sent to", to);
    }
  } catch (err) {
    console.error("❌ Error sending WhatsApp message:", err);
  }
}

// ============= تشغيل السيرفر =============

app.get("/", (_req, res) => {
  res.send("WhatsApp AI bot is running ✅");
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
