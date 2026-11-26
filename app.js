(() => {
  "use strict";
  const API = "https://teslafield-api.onrender.com";
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const promptInput = $("promptInput");
  const messageList = $("messageList");
  const welcome = $("welcomeScreen");
  const MAX_HISTORY = 100;
  let chats = [];
  let activeId = null;
  let generating = false;
  let controller = null;
  let selectedFiles = [];
  let toastTimer = null;

  const makeId = () => "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  const safeText = (value) => String(value == null ? "" : value);
  const escapeHtml = (value) => safeText(value).replace(/[&<>"']/g, (char) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
  const icon = (name) => {
    const paths = {
      copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
      retry:'<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.8-2L20 12M4 12l2.6 5a7 7 0 0 0 11.8-2"/>',
      up:'<path d="m7 10 5-5 5 5"/><path d="M12 5v14"/>',
      down:'<path d="m7 14 5 5 5-5"/><path d="M12 19V5"/>',
      sound:'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || "") + '</svg>';
  };

  function toast(message) {
    const box = $("toastMessage");
    box.textContent = message;
    box.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove("visible"), 2800);
  }
  function loadStore() {
    try {
      const value = JSON.parse(localStorage.getItem("teslafield.conversations.v3") || localStorage.getItem("teslafield.conversations.v2") || "[]");
      chats = Array.isArray(value) ? value.filter((chat) => chat && typeof chat.id === "string" && Array.isArray(chat.messages)) : [];
    } catch (error) {
      chats = [];
    }
  }
  function saveStore() {
    try {
      localStorage.setItem("teslafield.conversations.v3", JSON.stringify(chats.slice(0, MAX_HISTORY)));
      localStorage.setItem("teslafield.conversations.v2", JSON.stringify(chats.slice(0, MAX_HISTORY)));
    } catch (error) {
      toast("This browser could not save the conversation history.");
    }
  }
  function activeChat() { return chats.find((chat) => chat.id === activeId) || null; }
  function scrollBottom() {
    const area = $("conversationScroll");
    requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
  }
  function inlineMarkup(text) {
    let value = escapeHtml(text);
    value = value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    value = value.replace(/\*(.+?)\*/g, "<em>$1</em>");
    value = value.replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>");
    value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return value;
  }
  function renderMarkdown(source) {
    const chunks = safeText(source).split(/\x60\x60\x60/);
    return chunks.map((chunk, index) => {
      if (index % 2 === 1) {
        const lines = chunk.split("\n");
        if (lines.length > 1 && /^[a-z0-9_+#.-]{1,24}$/i.test(lines[0].trim())) lines.shift();
        return "<pre><code>" + escapeHtml(lines.join("\n").trim()) + "</code></pre>";
      }
      const lines = chunk.split("\n");
      let html = "", paragraph = [], list = "";
      const flushParagraph = () => {
        if (paragraph.length) {
          html += "<p>" + paragraph.map(inlineMarkup).join("<br>") + "</p>";
          paragraph = [];
        }
      };
      const closeList = () => {
        if (list) { html += list === "ul" ? "</ul>" : "</ol>"; list = ""; }
      };
      lines.forEach((line) => {
        const value = line.trim();
        if (!value) { flushParagraph(); closeList(); return; }
        const heading = value.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          flushParagraph(); closeList();
          const level = Math.min(heading[1].length + 1, 4);
          html += "<h" + level + ">" + inlineMarkup(heading[2]) + "</h" + level + ">";
          return;
        }
        if (/^---+$/.test(value)) { flushParagraph(); closeList(); html += "<hr>"; return; }
        const bullet = value.match(/^[-*]\s+(.+)$/);
        const numbered = value.match(/^\d+[.)]\s+(.+)$/);
        if (bullet || numbered) {
          flushParagraph();
          const next = bullet ? "ul" : "ol";
          if (list !== next) { closeList(); list = next; html += next === "ul" ? "<ul>" : "<ol>"; }
          html += "<li>" + inlineMarkup((bullet || numbered)[1]) + "</li>";
          return;
        }
        const quote = value.match(/^>\s?(.*)$/);
        if (quote) { flushParagraph(); closeList(); html += "<blockquote>" + inlineMarkup(quote[1]) + "</blockquote>"; return; }
        closeList(); paragraph.push(value);
      });
      flushParagraph(); closeList();
      return html;
    }).join("");
  }
  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      toast("Copied");
    } catch (error) {
      const field = document.createElement("textarea");
      field.value = value; document.body.appendChild(field); field.select();
      try { document.execCommand("copy"); toast("Copied"); }
      catch (copyError) { toast("Clipboard access is unavailable in this browser."); }
      field.remove();
    }
  }
  function renderMessage(message, index, chat) {
    const row = document.createElement("article");
    row.className = "message-row " + message.role;
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = message.role === "assistant" ? "T" : "";
    const body = document.createElement("div");
    body.className = "message-content";
    body.innerHTML = renderMarkdown(message.content);
    if (message.role === "user") row.append(body);
    else row.append(avatar, body);
    messageList.appendChild(row);

    const actions = document.createElement("div");
    actions.className = "message-actions";
    if (message.role === "assistant") {
      const copy = document.createElement("button");
      copy.type = "button"; copy.innerHTML = icon("copy") + "<span>Copy</span>";
      copy.setAttribute("aria-label", "Copy response");
      copy.onclick = () => copyText(message.content);
      const read = document.createElement("button");
      read.type = "button"; read.innerHTML = icon("sound") + "<span>Read aloud</span>";
      read.onclick = () => speak(message.content);
      const like = document.createElement("button");
      like.type = "button"; like.innerHTML = icon("up"); like.title = "Helpful";
      like.onclick = () => toast("Thanks for the feedback.");
      const dislike = document.createElement("button");
      dislike.type = "button"; dislike.innerHTML = icon("down"); dislike.title = "Not helpful";
      dislike.onclick = () => toast("Feedback noted for this device.");
      actions.append(copy, read, like, dislike);
      if (index === chat.messages.length - 1) {
        const retry = document.createElement("button");
        retry.type = "button"; retry.innerHTML = icon("retry") + "<span>Regenerate</span>";
        retry.onclick = regenerateLast;
        actions.append(retry);
      }
    } else {
      const copy = document.createElement("button");
      copy.type = "button"; copy.innerHTML = icon("copy") + "<span>Copy</span>";
      copy.onclick = () => copyText(message.content);
      const edit = document.createElement("button");
      edit.type = "button"; edit.innerHTML = icon("edit") + "<span>Edit</span>";
      edit.onclick = () => editUserMessage(index);
      actions.append(copy, edit);
    }
    messageList.appendChild(actions);
  }
  function renderConversation() {
    const chat = activeChat();
    messageList.innerHTML = "";
    welcome.hidden = !!(chat && chat.messages.length);
    if (chat) chat.messages.forEach((message, index) => renderMessage(message, index, chat));
    scrollBottom();
    renderHistory();
  }
  function dateGroup(timestamp) {
    const d = new Date(timestamp || Date.now());
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const time = d.getTime();
    if (time >= startToday) return "Today";
    const yesterday = startToday - 86400000;
    if (time >= yesterday) return "Yesterday";
    if (time >= startToday - 7 * 86400000) return "Previous 7 days";
    if (time >= startToday - 30 * 86400000) return "Previous 30 days";
    return "Older";
  }
  function closeMenus(except) {
    ["modelMenu", "plusMenu", "accountMenu"].forEach((id) => {
      if (id === except) return;
      const element = $(id);
      if (element) element.hidden = true;
    });
    ["modelButton", "plusButton", "accountButton"].forEach((id) => {
      if (id === except) return;
      const element = $(id);
      if (element) element.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".history-row-menu").forEach((menu) => menu.remove());
  }
  function renderHistory() {
    const list = $("historyList");
    const query = $("historySearch").value.trim().toLowerCase();
    list.innerHTML = "";
    const visible = chats.filter((chat) => !query || safeText(chat.title).toLowerCase().includes(query) || chat.messages.some((m) => safeText(m.content).toLowerCase().includes(query)));
    const groups = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
    groups.forEach((groupName) => {
      const items = visible.filter((chat) => dateGroup(chat.updated || chat.created) === groupName);
      if (!items.length) return;
      const group = document.createElement("div");
      group.className = "history-group";
      const label = document.createElement("div");
      label.className = "history-group-label";
      label.textContent = groupName;
      group.appendChild(label);
      items.sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0)).forEach((chat) => {
        const row = document.createElement("div");
        row.className = "history-row" + (chat.id === activeId ? " active" : "");
        const open = document.createElement("button");
        open.type = "button"; open.className = "history-title";
        open.textContent = chat.title || "New chat";
        open.onclick = () => openChat(chat.id);
        const more = document.createElement("button");
        more.type = "button"; more.className = "history-more"; more.textContent = "•••";
        more.setAttribute("aria-label", "Conversation actions");
        more.onclick = (event) => {
          event.stopPropagation();
          closeMenus();
          const menu = document.createElement("div");
          menu.className = "history-row-menu";
          const rename = document.createElement("button");
          rename.type = "button"; rename.textContent = "Rename";
          rename.onclick = () => {
            const title = window.prompt("Rename conversation", chat.title || "");
            if (title && title.trim()) { chat.title = title.trim().slice(0, 80); saveStore(); renderHistory(); }
          };
          const remove = document.createElement("button");
          remove.type = "button"; remove.className = "danger"; remove.textContent = "Delete";
          remove.onclick = () => {
            chats = chats.filter((item) => item.id !== chat.id);
            if (activeId === chat.id) { activeId = null; messageList.innerHTML = ""; welcome.hidden = false; }
            saveStore(); renderHistory();
          };
          menu.append(rename, remove); row.appendChild(menu);
        };
        row.append(open, more); group.appendChild(row);
      });
      list.appendChild(group);
    });
    $("historyEmpty").hidden = visible.length > 0;
    $("historyEmpty").textContent = query ? "No matching conversations." : "Your conversations will appear here.";
    $("clearSearch").hidden = !query;
  }
  function openChat(id) {
    if (generating) stopGeneration();
    activeId = id;
    renderConversation();
    closeSidebar();
  }
  function closeSidebar() {
    $("sidebar").classList.remove("mobile-open");
    $("sidebarScrim").classList.remove("visible");
  }
  function openSidebar() {
    $("sidebar").classList.add("mobile-open");
    $("sidebarScrim").classList.add("visible");
  }
  function newChat() {
    if (generating) stopGeneration();
    activeId = null;
    messageList.innerHTML = "";
    welcome.hidden = false;
    promptInput.value = "";
    promptInput.style.height = "auto";
    selectedFiles = [];
    renderAttachments();
    renderHistory();
    closeMenus();
    closeSidebar();
    promptInput.focus();
  }
  function setGenerating(value) {
    generating = value;
    const button = $("sendButton");
    button.classList.toggle("stop", value);
    button.setAttribute("aria-label", value ? "Stop generating" : "Send message");
    button.title = value ? "Stop generating" : "Send message";
  }
  function showTyping() {
    const row = document.createElement("div");
    row.id = "typingIndicator";
    row.className = "message-row assistant";
    row.innerHTML = '<div class="message-avatar">T</div><div class="typing-dots"><i></i><i></i><i></i></div>';
    messageList.appendChild(row);
    scrollBottom();
  }
  function stopGeneration() {
    if (controller) controller.abort();
    controller = null;
    const typing = $("typingIndicator");
    if (typing) typing.remove();
    setGenerating(false);
    toast("Response stopped.");
  }
  function speak(text) {
    if (!("speechSynthesis" in window)) { toast("Read aloud is not supported in this browser."); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = document.documentElement.lang || "en";
    window.speechSynthesis.speak(utterance);
  }
  function editUserMessage(index) {
    const chat = activeChat();
    if (!chat || chat.messages[index].role !== "user") return;
    promptInput.value = chat.messages[index].content;
    chat.messages = chat.messages.slice(0, index);
    chat.updated = Date.now();
    saveStore();
    renderConversation();
    promptInput.focus();
    promptInput.dispatchEvent(new Event("input"));
  }
  async function requestReply(chat) {
    showTyping();
    setGenerating(true);
    controller = new AbortController();
    try {
      const response = await fetch(API + "/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chat.messages.slice(-30) }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      const typing = $("typingIndicator");
      if (typing) typing.remove();
      if (!response.ok) throw new Error(data.message || data.error || "AI request failed (" + response.status + ").");
      const reply = data.reply || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
      if (typeof reply !== "string" || !reply.trim()) throw new Error("The connected model returned an empty response.");
      chat.messages.push({ role: "assistant", content: reply });
      chat.updated = Date.now();
      saveStore();
      renderConversation();
    } catch (error) {
      const typing = $("typingIndicator");
      if (typing) typing.remove();
      if (error.name !== "AbortError") {
        const message = error.message || "The AI service could not complete this request.";
        chat.messages.push({ role: "assistant", content: "**TESLAFIELD service notice**\\n\\n" + message + "\\n\\nYour prompt is saved in this conversation. You can retry after the service is connected." });
        chat.updated = Date.now();
        saveStore();
        renderConversation();
        toast(message);
      }
    } finally {
      controller = null;
      setGenerating(false);
      renderHistory();
    }
  }
  async function sendMessage(value) {
    const text = safeText(value === undefined ? promptInput.value : value).trim();
    if (!text || generating) return;
    if (selectedFiles.length) {
      toast("File reading is not connected yet. Remove attachments and send text only.");
      return;
    }
    let chat = activeChat();
    if (!chat) {
      chat = { id: makeId(), title: text.replace(/\s+/g, " ").slice(0, 48), messages: [], created: Date.now(), updated: Date.now() };
      chats.unshift(chat);
      activeId = chat.id;
    }
    chat.messages.push({ role: "user", content: text });
    chat.updated = Date.now();
    promptInput.value = "";
    promptInput.style.height = "auto";
    welcome.hidden = true;
    saveStore();
    renderConversation();
    closeSidebar();
    await requestReply(chat);
  }
  async function regenerateLast() {
    const chat = activeChat();
    if (!chat || generating) return;
    if (chat.messages.length && chat.messages[chat.messages.length - 1].role === "assistant") chat.messages.pop();
    if (!chat.messages.length || chat.messages[chat.messages.length - 1].role !== "user") {
      toast("There is no user message to regenerate.");
      return;
    }
    saveStore();
    renderConversation();
    await requestReply(chat);
  }
  function renderAttachments() {
    const strip = $("attachmentStrip");
    strip.innerHTML = "";
    if (!selectedFiles.length) { strip.hidden = true; return; }
    strip.hidden = false;
    const notice = document.createElement("div");
    notice.textContent = "Attachments are selected locally. File analysis is not connected yet.";
    strip.appendChild(notice);
    selectedFiles.forEach((file, index) => {
      const chip = document.createElement("span");
      chip.className = "attachment-chip";
      chip.textContent = file.name;
      const remove = document.createElement("button");
      remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", "Remove " + file.name);
      remove.onclick = () => { selectedFiles.splice(index, 1); renderAttachments(); };
      chip.appendChild(remove); strip.appendChild(chip);
    });
  }
  async function checkConnection() {
    try {
      const response = await fetch(API + "/api/v1/status", { signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error("offline");
      const data = await response.json().catch(() => ({}));
      $("connectionStatus").classList.add("online");
      $("connectionStatus").querySelector("span").textContent = "API online";
      const configured = Boolean(data.integrations && data.integrations.textChat);
      $("modelStatus").textContent = configured ? "Text AI provider configured on server." : "Text AI provider needs a private server credential.";
      $("composerProviderNote").textContent = configured ? "Check important information in AI responses." : "Text AI is awaiting provider configuration.";
    } catch (error) {
      $("connectionStatus").classList.remove("online");
      $("connectionStatus").querySelector("span").textContent = "API offline";
      $("modelStatus").textContent = "Cannot reach the TESLAFIELD API.";
      $("composerProviderNote").textContent = "The chat API is currently unreachable.";
    }
  }
  function toggleMenu(menuId, buttonId) {
    const menu = $(menuId);
    const willOpen = menu.hidden;
    closeMenus();
    menu.hidden = !willOpen;
    $(buttonId).setAttribute("aria-expanded", String(willOpen));
  }
  function applyTheme(theme) {
    root.classList.toggle("dark", theme === "dark");
    $("themeLabel").textContent = theme === "dark" ? "Dark" : "Light";
    try { localStorage.setItem("teslafield.appearance", theme); } catch (error) {}
  }
  function toggleTheme() {
    applyTheme(root.classList.contains("dark") ? "light" : "dark");
    closeMenus();
  }

  $("newChat").onclick = newChat;
  $("mobileMenu").onclick = openSidebar;
  $("sidebarClose").onclick = closeSidebar;
  $("sidebarScrim").onclick = closeSidebar;
  $("desktopMenu").onclick = () => document.body.classList.remove("sidebar-collapsed");
  $("sidebarCollapse").onclick = () => document.body.classList.add("sidebar-collapsed");
  $("searchChats").onclick = () => { closeSidebar(); $("historySearch").focus(); };
  $("composer").onsubmit = (event) => { event.preventDefault(); if (generating) stopGeneration(); else sendMessage(); };
  $("sendButton").onclick = (event) => { if (generating) { event.preventDefault(); stopGeneration(); } };
  promptInput.oninput = () => {
    promptInput.style.height = "auto";
    promptInput.style.height = Math.min(promptInput.scrollHeight, 185) + "px";
  };
  promptInput.onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!generating) sendMessage();
    }
  };
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.onclick = () => sendMessage(button.dataset.prompt);
  });
  $("historySearch").oninput = renderHistory;
  $("clearSearch").onclick = () => { $("historySearch").value = ""; renderHistory(); $("historySearch").focus(); };
  $("clearHistory").onclick = () => {
    if (!chats.length) { toast("There are no saved conversations."); return; }
    if (window.confirm("Delete all conversations saved on this device?")) {
      chats = []; saveStore(); newChat(); toast("Chat history cleared.");
    }
  };
  $("appearanceButton").onclick = toggleTheme;
  $("accountAppearance").onclick = toggleTheme;
  $("accountClear").onclick = () => { closeMenus(); $("clearHistory").click(); };
  $("accountButton").onclick = () => toggleMenu("accountMenu", "accountButton");
  $("modelButton").onclick = () => toggleMenu("modelMenu", "modelButton");
  $("plusButton").onclick = () => toggleMenu("plusMenu", "plusButton");
  $("uploadFileAction").onclick = () => { closeMenus(); $("fileInput").click(); };
  $("fileInput").onchange = (event) => {
    selectedFiles = selectedFiles.concat(Array.from(event.target.files || []));
    renderAttachments();
    if (selectedFiles.length) toast("Selected locally. File analysis is not connected yet.");
    event.target.value = "";
  };
  $("voiceButton").onclick = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { toast("Dictation is not supported in this browser."); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const words = event.results[0][0].transcript;
      promptInput.value = (promptInput.value ? promptInput.value + " " : "") + words;
      promptInput.dispatchEvent(new Event("input"));
      promptInput.focus();
    };
    recognition.onerror = () => toast("Could not access speech recognition. Check microphone permission.");
    recognition.start();
    toast("Listening… speak now.");
  };
  $("voiceModeButton").onclick = () => toast("Full live voice conversation is not connected yet. Use the microphone for dictation.");
  $("shareChat").onclick = () => {
    const chat = activeChat();
    if (!chat) { toast("Start a conversation first."); return; }
    copyText(chat.messages.map((m) => (m.role === "user" ? "You: " : "TESLAFIELD: ") + m.content).join("\n\n"));
  };
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".model-wrap") && !event.target.closest(".tool-menu-wrap") && !event.target.closest(".account-wrap") && !event.target.closest(".history-more")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "k") { event.preventDefault(); newChat(); }
    if ((event.ctrlKey || event.metaKey) && key === "f") { event.preventDefault(); $("historySearch").focus(); }
    if (event.key === "Escape") { closeMenus(); closeSidebar(); }
  });

  loadStore();
  try {
    const theme = localStorage.getItem("teslafield.appearance") || "light";
    applyTheme(theme);
  } catch (error) { applyTheme("light"); }
  renderHistory();
  checkConnection();
  setInterval(checkConnection, 60000);
})();