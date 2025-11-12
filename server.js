// server.js  —  نسخة مصغّرة وتعمل مع Render
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT         = process.env.PORT || 3000;
const VERIFY_TOKEN = "mawaheb_verify";
const WABA_TOKEN   = "EAAMlJZBsLvHQBP8xKH0xP7MW7nggFBrbkmZCVH6psRPUJChlWp0cNGqCj4GJOEZADDVVa8C6Oq99m75n5JNG09daDkJo1hQLFRQtAvWFre4W5eZAU6sFeYXEZBDmVD816Q8sh42IqzVZAZCvilZAfF9cPMSqbUbEInd8TDKaoyZAMX6qdxKmJZArc6OzEt1YLcmDmBOfFER3hXXfwMAZAZA4n3l3NN0Mz33DNja3QLEZBZBZBZBgdQZDZD";   // Permanent Access Token
const PHONE_ID     = "0561340876";
const OPENAI_KEY   = "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";

// ✅ GET للتحقق من الويبهوك (Meta يطلبها مرة واحدة)
// ✅ تحقق الويبهوك – استعمل نفس التوكن اللي في ميتا بالضبط
// GET webhook verification - REQUIRED BY META
app.post("/webhook", (req, res) => {
  const VERIFY_TOKEN = "mawaheb_verify"; // نفس التوكن اللي حطيته في Meta

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verified successfully ✔");
      res.status(200).send(challenge);
    } else {
      console.log("❌ Wrong token received:", token);
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});



// ✅ استقبال الرسائل
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg   = entry?.messages?.[0];
    if (!msg) {
      res.sendStatus(200);
      return;
    }

    const from = msg.from;
    if (msg.type !== "text") {
      await sendWhatsApp(from, "أرسل سؤالك نصيًا من فضلك ✍️");
      res.sendStatus(200);
      return;
    }

    const text = (msg.text?.body || "").trim();
    if (/موظف|بشري|اتصال/i.test(text)) {
      await sendWhatsApp(from, "تم تحويلك لموظف خدمة العملاء. 🙏");
      res.sendStatus(200);
      return;
    }

    const ai = await askAI(text);
    await sendWhatsApp(from, ai || "لم أفهم سؤالك جيدًا، هل تعيد بصيغة أخرى؟");
    res.sendStatus(200);
  } catch (e) {
    console.error("POST /webhook error:", e);
    res.sendStatus(200);
  }
});

// ===== وظائف مساعدة =====
async function askAI(userMsg) {
  if (!OPENAI_KEY) return "فعّل OpenAI API KEY في المتغيرات.";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "أجب بالعربية باختصار ودقة. إن لم تكن متأكدًا فاطلب تحويلًا لموظف." },
        { role: "user", content: userMsg }
      ]
    })
  });
  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim();
}

async function sendWhatsApp(to, body) {
  if (!WABA_TOKEN || !PHONE_ID) {
    console.error("⚠️ ضع WABA_TOKEN و PHONE_ID في المتغيرات");
    return;
  }
  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { preview_url: false, body }
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) console.error("Send error:", await r.text());
}

app.listen(PORT, () => console.log(`✅ Running on :${PORT}`));
