import express from "express";
const app = express();

app.use(express.json());

const VERIFY_TOKEN = "mawaheb_verify";

// FOR META WEBHOOK VERIFICATION
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook verified!");
        return res.status(200).send(challenge);
    } else {
        return res.sendStatus(403);
    }
});

// FOR RECEIVING WHATSAPP MESSAGES
app.post("/webhook", (req, res) => {
    console.log("WhatsApp Message:", JSON.stringify(req.body, null, 2));
    res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Webhook running on PORT:", PORT));
