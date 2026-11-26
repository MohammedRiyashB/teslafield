(() => {
  "use strict";
  const API = "https://teslafield-api.onrender.com";
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const syncVisualViewport = () => {
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    root.style.setProperty("--visual-viewport-height", Math.round(viewportHeight) + "px");
  };
  syncVisualViewport();
  window.addEventListener("resize", syncVisualViewport, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", syncVisualViewport, { passive: true });
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
  let mediaRecorder = null;
  let voiceModeEnabled = false;
  let healthRequest = null;
  let reconnectTimer = null;
  let authClient = null;
  let currentUser = null;
  let authReady = false;
  let resolveAuthReady;
  const authReadyPromise = new Promise((resolve) => { resolveAuthReady = resolve; });

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

  function updateAccountUI() {
    const signedIn = !!currentUser;
    $("accountStatus").textContent = signedIn
      ? "Signed in securely. Your chat history stays on this device."
      : "Sign in with Google to use TESLAFIELD securely.";
    $("accountSignUp").hidden = signedIn;
    $("accountLogIn").hidden = signedIn;
    $("accountSignOut").hidden = !signedIn;
    $("accountDelete").hidden = !signedIn;
    const accountSubtitle = document.querySelector(".account-copy small");
    if (accountSubtitle) accountSubtitle.textContent = signedIn ? "Signed-in account" : "Secure sign-in required";
  }

  function initializeFirebaseAuth() {
    if (!window.firebase || !window.firebase.apps || !window.firebase.apps.length) {
      authReady = true;
      resolveAuthReady();
      updateAccountUI();
      return;
    }
    try {
      authClient = window.firebase.auth();
      authClient.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
      authClient.onAuthStateChanged((user) => {
        const previousUid = currentUser && currentUser.uid;
        const nextUid = user && user.uid;
        currentUser = user || null;
        authReady = true;
        resolveAuthReady();
        if (previousUid !== nextUid) {
          if (generating) stopGeneration();
          chats = [];
          activeId = null;
          if (currentUser) {
            loadStore();
            activeId = chats.length ? chats[0].id : null;
          }
          messageList.innerHTML = "";
          renderConversation();
        } else {
          updateAccountUI();
        }
      });
      authClient.getRedirectResult().catch((error) => {
        if (error && error.code !== "auth/no-auth-event") {
          toast("Google sign-in could not be completed. Please try again.");
        }
      });
    } catch (error) {
      authReady = true;
      resolveAuthReady();
      authClient = null;
      updateAccountUI();
    }
  }

  async function requireAuthentication() {
    await authReadyPromise;
    if (currentUser) return true;
    $("accountMenu").hidden = false;
    $("accountButton").setAttribute("aria-expanded", "true");
    toast(authClient
      ? "Sign in with Google before using TESLAFIELD."
      : "Secure sign-in is not available on this page yet. Open TESLAFIELD from its website.");
    return false;
  }

  async function getAuthToken() {
    await authReadyPromise;
    if (!authClient || !currentUser) throw new Error("Sign in with Google to continue.");
    return currentUser.getIdToken();
  }

  async function accountEntry() {
    if (!authClient || !window.firebase) {
      toast("Firebase Authentication is not initialized on this site.");
      return;
    }
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    closeMenus();
    try {
      if (window.matchMedia("(max-width: 760px)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await authClient.signInWithRedirect(provider);
      } else {
        await authClient.signInWithPopup(provider);
      }
    } catch (error) {
      if (error && error.code === "auth/popup-blocked") {
        try { await authClient.signInWithRedirect(provider); return; } catch (redirectError) {}
      }
      if (error && error.code === "auth/popup-closed-by-user") return;
      if (error && error.code === "auth/operation-not-allowed") {
        toast("Google sign-in is not enabled in Firebase Authentication yet.");
      } else if (error && error.code === "auth/unauthorized-domain") {
        toast("Add teslafieldai.web.app to Firebase Authentication authorized domains.");
      } else {
        toast("Google sign-in failed. Check your connection and try again.");
      }
    }
  }

  async function deleteAccountAndLocalData() {
    if (!currentUser) return;
    const uid = currentUser.uid;
    if (!window.confirm("Permanently delete this TESLAFIELD sign-in account and its locally saved chats on this device? This cannot be undone. This does not erase records that external AI providers may retain under their own policies.")) return;
    try {
      await currentUser.delete();
      localStorage.removeItem("teslafield.conversations.v4." + uid);
      localStorage.removeItem("teslafield.conversations.v2");
      localStorage.removeItem("teslafield.conversations.v3");
      chats = [];
      activeId = null;
      renderConversation();
      toast("Your account and its local chat data were deleted.");
    } catch (error) {
      if (error && error.code === "auth/requires-recent-login") {
        toast("For security, sign in again with Google and retry account deletion.");
      } else {
        toast("Account deletion failed. Please sign in again and retry.");
      }
    }
  }
  function conversationStoreKey() {
    return currentUser ? "teslafield.conversations.v4." + currentUser.uid : null;
  }
  function loadStore() {
    chats = [];
    const key = conversationStoreKey();
    if (!key) return;
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      chats = Array.isArray(value) ? value.filter((chat) => chat && typeof chat.id === "string" && Array.isArray(chat.messages)) : [];
    } catch (error) {
      chats = [];
    }
  }
  function saveStore() {
    const key = conversationStoreKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(chats.slice(0, MAX_HISTORY)));
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
    const body = document.createElement("div");
    body.className = "message-content";
    body.innerHTML = renderMarkdown(message.content);
    if (message.role === "user") row.append(body);
    else row.append(body);
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
    ["plusMenu", "accountMenu"].forEach((id) => {
      if (id === except) return;
      const element = $(id);
      if (element) element.hidden = true;
    });
    ["plusButton", "accountButton"].forEach((id) => {
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
            if (!window.confirm("Delete this conversation from this browser?")) return;
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
    row.innerHTML = '<div class="typing-dots"><i></i><i></i><i></i></div>';
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
  async function speak(text) {
    try {
      await speakWithSpace(text);
    } catch (error) {
      if (!("speechSynthesis" in window)) {
        toast(error.message || "TESLAFIELD voice is temporarily unavailable.");
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[\u0B80-\u0BFF]/.test(text) ? "ta-IN" : "en-IN";
      window.speechSynthesis.speak(utterance);
      toast("TESLAFIELD Voice is unavailable; using your device voice.");
    }
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
  async function speakWithSpace(text) {
    const token = await getAuthToken();
    const response = await fetch(API + "/api/v1/voice/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ text: String(text).slice(0, 1500), language: /[\u0B80-\u0BFF]/.test(text) ? "Tamil" : "English", voice: "ahana" }),
      signal: AbortSignal.timeout(180000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.audio) throw new Error(data.message || "Voice generation is temporarily unavailable.");
    const audio = new Audio(data.audio);
    await new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = () => reject(new Error("Generated voice audio could not be played."));
      audio.play().catch(reject);
    });
  }

  async function startRecording(mode) {
    if (mediaRecorder) return;
    if (!(await requireAuthentication())) { voiceModeEnabled = false; return; }
    try {
      if (localStorage.getItem("teslafield.audioProcessingConsent.v1") !== "accepted") {
        const consent = window.confirm("Microphone audio will be recorded on this device and sent over HTTPS to TESLAFIELD and an external transcription AI service for processing. Avoid recording passwords, payment details or other sensitive information. Continue?");
        if (!consent) { voiceModeEnabled = false; return; }
        localStorage.setItem("teslafield.audioProcessingConsent.v1", "accepted");
      }
    } catch (error) {
      toast("Microphone consent could not be saved. Please check browser settings.");
      voiceModeEnabled = false;
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast("Audio recording is not supported here. Allow microphone access or use a supported browser.");
      voiceModeEnabled = false;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      const chunks = [];
      mediaRecorder = recorder;
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorder = null;
        const clip = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!clip.size) {
          if (mode === "conversation" && voiceModeEnabled) startRecording("conversation");
          else toast("No audio was recorded. Try again.");
          return;
        }
        try {
          const bytes = new Uint8Array(await clip.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          const token = await getAuthToken();
          const response = await fetch(API + "/api/v1/speech/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ audioBase64: btoa(binary), mimeType: clip.type, language: "Auto detect" }),
            signal: AbortSignal.timeout(180000)
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.message || "Whisper could not transcribe this recording.");
          const transcript = String(data.transcript || "").trim();
          if (!transcript) {
            toast("No speech detected. Please try again.");
            if (mode === "conversation" && voiceModeEnabled) startRecording("conversation");
            return;
          }
          if (mode === "conversation") {
            await sendMessage(transcript);
          } else {
            promptInput.value = (promptInput.value ? promptInput.value + " " : "") + transcript;
            promptInput.dispatchEvent(new Event("input"));
            promptInput.focus();
            toast("Speech converted to text.");
          }
        } catch (error) {
          toast(error.message || "Speech recognition failed. Please retry.");
          if (mode === "conversation" && voiceModeEnabled) startRecording("conversation");
        }
      };
      recorder.start();
      toast(mode === "conversation" ? "Voice conversation listening… tap Voice Mode to finish." : "Listening… tap the microphone again to finish.");
    } catch (error) {
      mediaRecorder = null;
      voiceModeEnabled = false;
      toast("Microphone permission is needed. Allow it in your browser settings and try again.");
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }

  async function requestReply(chat) {
    showTyping();
    setGenerating(true);
    controller = new AbortController();
    try {
      await waitForApiReady(90000);
      const token = await getAuthToken();
      const chatRequest = {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ messages: chat.messages.slice(-30) }),
        signal: controller.signal
      };
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await fetch(API + "/api/v1/chat/completions", chatRequest);
          if (response.ok || ![502, 503, 504].includes(response.status) || attempt === 2) break;
        } catch (networkError) {
          if (networkError.name === "AbortError" || attempt === 2) throw networkError;
        }
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, attempt === 0 ? 1800 : 4500);
          controller.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Request cancelled", "AbortError"));
          }, { once: true });
        });
      }
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
      if (voiceModeEnabled) {
        try { await speakWithSpace(reply); }
        catch (voiceError) { toast(voiceError.message || "Voice playback failed."); }
      }
    } catch (error) {
      const typing = $("typingIndicator");
      if (typing) typing.remove();
      if (error.name !== "AbortError") {
        const message = error.message || "The AI service could not complete this request.";
        chat.messages.push({ role: "assistant", content: "**TESLAFIELD service notice**\n\n" + message + "\n\nYour prompt is saved in this conversation. You can retry after the service is connected." });
        chat.updated = Date.now();
        saveStore();
        renderConversation();
        toast(message);
      }
    } finally {
      controller = null;
      setGenerating(false);
      renderHistory();
      if (voiceModeEnabled && !mediaRecorder) startRecording("conversation");
    }
  }
  async function sendMessage(value) {
    const text = safeText(value === undefined ? promptInput.value : value).trim();
    if (!text || generating) return;
    if (!(await requireAuthentication())) return;
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
    if (!(await requireAuthentication())) return;
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
    notice.textContent = "Selected on this device only — not uploaded. File analysis is not enabled.";
    strip.appendChild(notice);
    selectedFiles.forEach((file, index) => {
      const chip = document.createElement("span");
      chip.className = "attachment-chip";
      chip.textContent = file.name + " · " + Math.max(1, Math.ceil(file.size / 1024)) + " KB";
      const remove = document.createElement("button");
      remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", "Remove " + file.name);
      remove.onclick = () => { selectedFiles.splice(index, 1); renderAttachments(); };
      chip.appendChild(remove); strip.appendChild(chip);
    });
  }
  const SAFE_FILE_TYPES = {
    ".png": ["image/png"],
    ".jpg": ["image/jpeg"],
    ".jpeg": ["image/jpeg"],
    ".webp": ["image/webp"],
    ".pdf": ["application/pdf"],
    ".txt": ["text/plain"],
    ".csv": ["text/csv", "application/vnd.ms-excel", "text/plain"],
    ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
  };
  async function validateSelectedFile(file) {
    const dot = file.name.lastIndexOf(".");
    const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    const acceptedMimes = SAFE_FILE_TYPES[extension];
    if (!acceptedMimes) return "This file type is not allowed.";
    if (!file.size || file.size > 10 * 1024 * 1024) return "Each file must be between 1 byte and 10 MB.";
    if (file.type && !acceptedMimes.includes(file.type.toLowerCase())) return "The file extension and reported type do not match.";
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const ascii = (start, count) => String.fromCharCode(...bytes.slice(start, start + count));
    let valid = false;
    if (extension === ".png") valid = bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 3) === "PNG";
    else if (extension === ".jpg" || extension === ".jpeg") valid = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    else if (extension === ".webp") valid = bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    else if (extension === ".pdf") valid = ascii(0, 5) === "%PDF-";
    else if (extension === ".docx") valid = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    else if (extension === ".txt" || extension === ".csv") {
      const sample = new Uint8Array(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer());
      valid = !sample.some((byte) => byte === 0);
    }
    return valid ? null : "The file content does not match its allowed file type.";
  }

  async function pingApi() {
    if (healthRequest) return healthRequest;
    healthRequest = (async () => {
      const response = await fetch(API + "/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error("API is starting");
      return true;
    })();
    try {
      return await healthRequest;
    } catch (error) {
      return false;
    } finally {
      healthRequest = null;
    }
  }
  async function waitForApiReady(maxWaitMs) {
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      if (await pingApi()) return true;
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 1200 + attempt * 700)));
      attempt += 1;
    }
    throw new Error("TESLAFIELD is temporarily unavailable. Please retry shortly.");
  }
  async function checkConnection() {
    const online = await pingApi();
    if (online || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      checkConnection();
    }, 5000);
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
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", theme === "dark" ? "#000000" : "#ffffff");
    $("themeLabel").textContent = theme === "dark" ? "Dark" : "Light";
    try { localStorage.setItem("teslafield.appearance.v2", theme); } catch (error) {}
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
    if (window.confirm("Delete all conversations for this signed-in account from this browser?")) {
      chats = [];
      saveStore();
      try {
        localStorage.removeItem("teslafield.conversations.v2");
        localStorage.removeItem("teslafield.conversations.v3");
      } catch (error) {}
      newChat();
      toast("Chat history cleared from this browser.");
    }
  };
  $("appearanceButton").onclick = toggleTheme;
  $("accountSignUp").onclick = accountEntry;
  $("accountLogIn").onclick = accountEntry;
  $("accountSignOut").onclick = async () => {
    if (!authClient) return;
    try { await authClient.signOut(); closeMenus(); toast("Signed out. Your chats remain in this browser under your account profile."); }
    catch (error) { toast("Sign out failed. Please retry."); }
  };
  $("accountDelete").onclick = deleteAccountAndLocalData;
  $("accountButton").onclick = () => toggleMenu("accountMenu", "accountButton");
  $("plusButton").onclick = () => toggleMenu("plusMenu", "plusButton");
  $("uploadFileAction").onclick = () => {
    closeMenus();
    const approved = window.confirm("Choose files from this device. TESLAFIELD currently checks their type and size but does not upload or analyse file contents. Continue?");
    if (approved) $("fileInput").click();
  };
  $("fileInput").onchange = async (event) => {
    const incoming = Array.from(event.target.files || []);
    event.target.value = "";
    const remaining = Math.max(0, 5 - selectedFiles.length);
    if (!remaining) { toast("You can select up to 5 files at a time."); return; }
    for (const file of incoming.slice(0, remaining)) {
      const problem = await validateSelectedFile(file).catch(() => "This file could not be checked.");
      if (problem) { toast(file.name + ": " + problem); continue; }
      selectedFiles.push(file);
    }
    if (incoming.length > remaining) toast("Only 5 files can be selected at once.");
    renderAttachments();
    if (selectedFiles.length) toast("Files checked and kept on this device. They have not been uploaded.");
  };
  $("voiceButton").onclick = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
    else startRecording("dictation");
  };
  $("voiceModeButton").onclick = () => {
    if (voiceModeEnabled) {
      voiceModeEnabled = false;
      stopRecording();
      toast("Voice conversation stopped.");
    } else {
      voiceModeEnabled = true;
      startRecording("conversation");
    }
  };
  $("shareChat").onclick = () => {
    const chat = activeChat();
    if (!chat) { toast("Start a conversation first."); return; }
    copyText(chat.messages.map((m) => (m.role === "user" ? "You: " : "TESLAFIELD: ") + m.content).join("\n\n"));
  };
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".tool-menu-wrap") && !event.target.closest(".account-wrap") && !event.target.closest(".history-more")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "k") { event.preventDefault(); newChat(); }
    if ((event.ctrlKey || event.metaKey) && key === "f") { event.preventDefault(); $("historySearch").focus(); }
    if (event.key === "Escape") { closeMenus(); closeSidebar(); }
  });

  initializeFirebaseAuth();
  try {
    const theme = localStorage.getItem("teslafield.appearance.v2") || "dark";
    applyTheme(theme);
  } catch (error) { applyTheme("dark"); }
  renderHistory();
  let connectionTimer = null;
  function startConnectionMonitor() {
    if (connectionTimer) clearInterval(connectionTimer);
    checkConnection();
    connectionTimer = setInterval(checkConnection, 5 * 60 * 1000);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") startConnectionMonitor();
    else if (connectionTimer) { clearInterval(connectionTimer); connectionTimer = null; }
  });
  startConnectionMonitor();
})();