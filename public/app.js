const contactsListEl = document.getElementById("contacts-list");
const searchInputEl = document.getElementById("search-input");
const chatPlaceholderEl = document.getElementById("chat-placeholder");
const chatContainerEl = document.getElementById("chat-container");
const messagesContainerEl = document.getElementById("messages-container");
const chatContactNameEl = document.getElementById("chat-contact-name");
const chatContactNumberEl = document.getElementById("chat-contact-number");
const messageFormEl = document.getElementById("message-form");
const messageInputEl = document.getElementById("message-input");
const botToggleEl = document.getElementById("bot-toggle");
const deleteContactBtnEl = document.getElementById("delete-contact-btn");

const ownerBtnEl = document.getElementById("owner-btn");
const settingsModalEl = document.getElementById("settings-modal");
const settingsBotNameEl = document.getElementById("settings-bot-name");
const settingsAvatarFileEl = document.getElementById("settings-avatar-file");
const settingsBotAvatarEl = document.getElementById("settings-bot-avatar");
const settingsSaveBtnEl = document.getElementById("settings-save-btn");
const settingsCancelBtnEl = document.getElementById("settings-cancel-btn");

const botAvatarImg = document.getElementById("bot-avatar");
const botNameLabel = document.getElementById("bot-name");

const newChatBtnEl = document.getElementById("new-chat-btn");
const newChatModalEl = document.getElementById("newchat-modal");
const newChatWaIdEl = document.getElementById("newchat-waid");
const newChatNameEl = document.getElementById("newchat-name");
const newChatFirstMessageEl = document.getElementById("newchat-first-message");
const newChatCreateBtnEl = document.getElementById("newchat-create-btn");
const newChatCancelBtnEl = document.getElementById("newchat-cancel-btn");

let contacts = [];
let filteredContacts = [];
let activeContactId = null;
let loadingMessages = false;

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit"
  });
}

function renderContacts() {
  contactsListEl.innerHTML = "";
  const list = filteredContacts.length ? filteredContacts : contacts;

  if (!list.length) {
    contactsListEl.innerHTML =
      '<div class="contact-item"><div class="contact-name">لا توجد محادثات بعد</div></div>';
    return;
  }

  for (const c of list) {
    const div = document.createElement("div");
    div.className = "contact-item";
    if (c.id === activeContactId) div.classList.add("active");

    const name = c.display_name || c.wa_id;
    const number = c.wa_id;
    const last = c.last_message || "";
    const time = c.last_timestamp ? formatTime(c.last_timestamp) : "";

    div.innerHTML = `
      <div class="contact-name">${name}</div>
      <div class="contact-number">${number}</div>
      <div class="contact-last-message">${last}</div>
      <div class="contact-number" style="text-align:left;direction:ltr;font-size:11px;">${time}</div>
    `;

    div.addEventListener("click", () => {
      openChat(c.id);
    });

    contactsListEl.appendChild(div);
  }
}

async function loadContacts() {
  try {
    contacts = await fetchJSON("/api/contacts");
    filteredContacts = [];
    renderContacts();
  } catch (err) {
    console.error("Error loading contacts:", err);
  }
}

async function openChat(contactId) {
  activeContactId = contactId;
  renderContacts();

  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return;

  chatPlaceholderEl.classList.add("hidden");
  chatContainerEl.classList.remove("hidden");

  chatContactNameEl.textContent = contact.display_name || contact.wa_id;
  chatContactNumberEl.textContent = contact.wa_id;
  botToggleEl.checked = !(contact.bot_paused === 1);

  await loadMessages(contactId);
}

async function loadMessages(contactId) {
  loadingMessages = true;
  messagesContainerEl.innerHTML = "";

  try {
    const messages = await fetchJSON(`/api/contacts/${contactId}/messages`);
    for (const m of messages) {
      appendMessageBubble(m);
    }
    messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
  } catch (err) {
    console.error("Error loading messages:", err);
  } finally {
    loadingMessages = false;
  }
}

function appendMessageBubble(message) {
  const row = document.createElement("div");
  row.className =
    "message-row " + (message.from_me ? "message-from-me" : "message-from-them");

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  const bodyDiv = document.createElement("div");
  bodyDiv.textContent = message.body;

  const metaDiv = document.createElement("div");
  metaDiv.className = "message-meta";
  metaDiv.textContent = formatTime(message.timestamp);

  bubble.appendChild(bodyDiv);
  bubble.appendChild(metaDiv);
  row.appendChild(bubble);

  messagesContainerEl.appendChild(row);
}

messageFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeContactId) return;
  const text = messageInputEl.value.trim();
  if (!text) return;
  messageInputEl.value = "";

  try {
    await fetchJSON(`/api/contacts/${activeContactId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text })
    });

    await loadMessages(activeContactId);
    await loadContacts();
  } catch (err) {
    console.error("Error sending message:", err);
  }
});

botToggleEl.addEventListener("change", async () => {
  if (!activeContactId) return;
  const paused = !botToggleEl.checked;
  try {
    await fetchJSON(`/api/contacts/${activeContactId}/bot-toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused })
    });

    const idx = contacts.findIndex((c) => c.id === activeContactId);
    if (idx >= 0) contacts[idx].bot_paused = paused ? 1 : 0;
  } catch (err) {
    console.error("Error toggling bot:", err);
  }
});

deleteContactBtnEl.addEventListener("click", async () => {
  if (!activeContactId) return;
  if (!confirm("هل أنت متأكد من حذف هذه المحادثة بالكامل؟")) return;

  try {
    await fetchJSON(`/api/contacts/${activeContactId}`, { method: "DELETE" });
    contacts = contacts.filter((c) => c.id !== activeContactId);
    activeContactId = null;
    chatContainerEl.classList.add("hidden");
    chatPlaceholderEl.classList.remove("hidden");
    renderContacts();
  } catch (err) {
    console.error("Error deleting contact:", err);
  }
});

searchInputEl.addEventListener("input", () => {
  const q = searchInputEl.value.trim().toLowerCase();
  if (!q) {
    filteredContacts = [];
  } else {
    filteredContacts = contacts.filter((c) => {
      const name = (c.display_name || "").toLowerCase();
      const wa = (c.wa_id || "").toLowerCase();
      return name.includes(q) || wa.includes(q);
    });
  }
  renderContacts();
});

// settings
async function loadSettings() {
  try {
    const s = await fetchJSON("/api/settings");
    botNameLabel.textContent = s.bot_name || "Smart Bot";
    botAvatarImg.src =
      s.bot_avatar ||
      "https://ui-avatars.com/api/?name=Smart+Bot&background=0D8ABC&color=fff";
  } catch (err) {
    console.error("Error loading settings:", err);
  }
}

ownerBtnEl.addEventListener("click", async () => {
  const pass = prompt("أدخل كلمة المرور للمالك:");
  if (pass !== "Mmaa3551") {
    alert("كلمة المرور غير صحيحة");
    return;
  }

  try {
    const s = await fetchJSON("/api/settings");
    settingsBotNameEl.value = s.bot_name || "Smart Bot";
    settingsBotAvatarEl.value = s.bot_avatar || "";
    settingsAvatarFileEl.value = "";
    settingsModalEl.classList.remove("hidden");
  } catch (err) {
    console.error("Error loading settings:", err);
  }
});

settingsCancelBtnEl.addEventListener("click", () => {
  settingsModalEl.classList.add("hidden");
  settingsAvatarFileEl.value = "";
});

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

settingsSaveBtnEl.addEventListener("click", async () => {
  const bot_name = settingsBotNameEl.value.trim();
  let bot_avatar = settingsBotAvatarEl.value.trim();

  try {
    const file = settingsAvatarFileEl.files[0];
    if (file) {
      bot_avatar = await readFileAsDataURL(file);
    }

    await fetchJSON("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_name, bot_avatar })
    });

    await loadSettings();
    settingsModalEl.classList.add("hidden");
    settingsAvatarFileEl.value = "";
  } catch (err) {
    console.error("Error saving settings:", err);
  }
});

// new chat modal
newChatBtnEl.addEventListener("click", () => {
  newChatWaIdEl.value = "";
  newChatNameEl.value = "";
  newChatFirstMessageEl.value = "";
  newChatModalEl.classList.remove("hidden");
});

newChatCancelBtnEl.addEventListener("click", () => {
  newChatModalEl.classList.add("hidden");
});

newChatCreateBtnEl.addEventListener("click", async () => {
  const wa_id = newChatWaIdEl.value.trim();
  const name = newChatNameEl.value.trim();
  const first = newChatFirstMessageEl.value.trim();

  if (!wa_id) {
    alert("الرجاء إدخال رقم واتساب.");
    return;
  }

  try {
    const contact = await fetchJSON("/api/contacts/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wa_id,
        display_name: name || wa_id,
        first_message: first
      })
    });

    newChatModalEl.classList.add("hidden");

    await loadContacts();
    openChat(contact.id);
  } catch (err) {
    console.error("Error creating new chat:", err);
  }
});

// polling
setInterval(() => {
  loadContacts();
  if (activeContactId && !loadingMessages) {
    loadMessages(activeContactId);
  }
}, 8000);

(async function init() {
  await loadSettings();
  await loadContacts();
})();
