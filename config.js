// config.js

// هنا نعرّف المنتجات اللي في زد
// تقدر تضيف عليهم لاحقاً
const productsConfig = {
  // منتج بوت واتساب 1 شهر
  "Z.17632374787413204": {
    type: "whatsapp_bot",
    days: 30,
    name: "بوت واتساب - اشتراك شهر"
  },

  // مثال لبوت واتساب 3 شهور (لما تضيفه في زد)
  "Z.WHATSAPP_BOT_3M": {
    type: "whatsapp_bot",
    days: 90,
    name: "بوت واتساب - اشتراك 3 شهور"
  },

  // مثال لبوت تيليجرام (تضيف ID الحقيقي من زد)
  "Z.TELEGRAM_BOT_1M": {
    type: "telegram_bot",
    days: 30,
    name: "بوت تيليجرام - اشتراك شهر"
  },

  // مثال لبوت ذكاء اصطناعي للمتجر / الموقع
  "Z.STORE_AI_BOT_1M": {
    type: "store_ai_bot",
    days: 30,
    name: "بوت المتجر الذكي - اشتراك شهر"
  }
};

module.exports = {
  productsConfig
};
