// config.js
export const shopConfig = {
  shopName: "متجر سمارت بوت",
  botBrand: "Smart Bot",
  whatsappNumber: "0561340876",
  // رسالة الترحيب الافتراضية في الواتساب لما يفعَّل الاشتراك
  defaultWelcomeMessage: (customerName, productName, days, activationUrl) =>
    `مرحباً ${customerName || "عزيزي"} 👋\n\n` +
    `شكراً لطلبك *${productName}* من ${shopConfig.shopName}.\n` +
    `تم تفعيل اشتراكك لمدة *${days}* يوم ✅\n\n` +
    `رابط التفعيل (مرة واحدة فقط):\n${activationUrl}\n\n` +
    `في حال واجهت أي مشكلة، راسلنا على هذا الرقم ${shopConfig.whatsappNumber}.`
};

// هنا تربط معرفات منتجات زد بالمدد ونوع البوت
// مثال: Z.17632374787413204 = بوت واتساب لمدة شهر
export const productsMap = {
  // بوت واتساب شهر
  "Z.17632374787413204": {
    botType: "whatsapp",
    durationDays: 30,
    name: "بوت واتساب – شهر واحد"
  },

  // أمثلة أخرى:
  // "Z.XXXXX3MONTHS": { botType: "whatsapp", durationDays: 90, name: "بوت واتساب – 3 شهور" },
  // "Z.TELEGRAM1M": { botType: "telegram", durationDays: 30, name: "بوت تيليجرام – شهر واحد" },
  // "Z.STOREAI1M": { botType: "store_ai", durationDays: 30, name: "بوت ذكاء اصطناعي للمتجر – شهر واحد" },
};

// أي منتج ما هو موجود هنا نتجاهله
