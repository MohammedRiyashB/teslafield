(() => {
  "use strict";
  const API = "https://teslafield-api.onrender.com";
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  let connectReturnFocus = null;
  let gmailAccessToken = null;
  // Protect TeslafieldAI brand artwork only; regular website images remain downloadable.
  document.addEventListener("contextmenu", (event) => {
    if (event.target && event.target.closest && event.target.closest('img[src*="teslafieldai-logo"]')) {
      event.preventDefault();
    }
  }, true);
  document.addEventListener("dragstart", (event) => {
    if (event.target && event.target.closest && event.target.closest('img[src*="teslafieldai-logo"]')) {
      event.preventDefault();
    }
  }, true);

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
  const welcomeSubtitle = welcome.querySelector(".welcome-subtitle");
  const welcomeMessageGroups = [
    ["A little curiosity can lead somewhere amazing.", "Your next big idea could start with one question.", "Every great discovery begins with exploration.", "Think boldly. Start anywhere.", "There is always something new to learn.", "Let's make your next thought count.", "Big plans begin with small steps.", "Bring your questions, ideas, and imagination.", "A fresh perspective is one message away.", "Your space to think, create, and discover is ready."],
    ["Explore a new topic and understand it clearly.", "Turn a complex problem into simple next steps.", "Brainstorm ideas and shape them into a real plan.", "Write something meaningful and make it shine.", "Build, experiment, and bring your ideas to life.", "Find answers, uncover insights, and keep learning.", "Work through a challenge one step at a time.", "Discover a smarter way to approach your next task.", "Create something original from a simple thought.", "Ask freely and follow wherever your curiosity leads."],
    ["Let's get started.", "I'm ready when you are.", "What shall we explore first?", "Your journey starts with a question.", "Let's make it happen.", "Start with whatever is on your mind.", "The next step is yours.", "Let's turn that thought into progress.", "One message can open a new direction.", "Make today a day of discovery."]
  ];
  let welcomeMessageDeck = [];
  let welcomeMessageIndex = 0;
  function buildWelcomeMessageDeck() {
    welcomeMessageDeck = [];
    welcomeMessageGroups[0].forEach((a) => welcomeMessageGroups[1].forEach((b) => welcomeMessageGroups[2].forEach((c) => welcomeMessageDeck.push(a + " " + b + " " + c))));
    for (let i = welcomeMessageDeck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [welcomeMessageDeck[i], welcomeMessageDeck[j]] = [welcomeMessageDeck[j], welcomeMessageDeck[i]];
    }
    welcomeMessageIndex = 0;
  }
  function showNextWelcomeMessage() {
    if (!welcomeSubtitle || !welcomeMessageDeck.length) return;
    welcomeSubtitle.classList.add("welcome-message-changing");
    const message = welcomeMessageDeck[welcomeMessageIndex];
    welcomeMessageIndex = (welcomeMessageIndex + 1) % welcomeMessageDeck.length;
    if (welcomeMessageIndex === 0) buildWelcomeMessageDeck();
    window.setTimeout(() => {
      welcomeSubtitle.textContent = message;
      welcomeSubtitle.classList.remove("welcome-message-changing");
    }, 180);
  }
  buildWelcomeMessageDeck();
  if (welcomeSubtitle) welcomeSubtitle.textContent = welcomeMessageDeck[0];
  welcomeMessageIndex = 1;
  window.setInterval(() => {
    if (document.visibilityState === "visible" && !welcome.hidden) showNextWelcomeMessage();
  }, 5500);
  const composerArea = $("composerArea");
  const composerHome = document.createComment("TeslafieldAI composer home");
  composerArea.parentNode.insertBefore(composerHome, composerArea);
  const MAX_HISTORY = 100;
  let chats = [];
  let activeId = null;
  let generating = false;
  let sendPending = false;
  let controller = null;
  let mediaRecorder = null;
  let mediaRecorderStream = null;
  let recordingTimer = null;
  let voiceStartPending = false;
  let voiceStartAttempt = 0;
  let selectedFiles = [];
  let toastTimer = null;
  let healthRequest = null;
  let reconnectTimer = null;
  let authClient = null;
  let currentUser = null;
  let authReady = false;
  let pendingGuestPrompt = "";
  let guestConversationStarted = false;
  let userPreferences = { responseStyle: "balanced", textSize: "standard", reduceMotion: false, model: "teslafield" };
  let availableModels = [{ id: "teslafield", name: "Teslafield B1", free: true, provider: "TeslafieldAI" }];
  let cloudSyncReady = false;
  let cloudSyncBusy = false;
  let cloudSyncTimer = null;
  let cloudSyncFingerprints = new Map();
  let cloudDeletedIds = new Set();
  let cloudSyncedDeletedIds = new Set();
  let cloudHistoryWarningShown = false;
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
      up:'<path d="M7 10v10H4V10h3Zm3 10h6.2a2 2 0 0 0 1.9-1.4l2-6A2 2 0 0 0 17.2 10H13l.7-3.1A2.4 2.4 0 0 0 11.4 4L7 10v10h3Z"/>',
      down:'<path d="M7 14V4H4v10h3Zm3-10h6.2a2 2 0 0 1 1.9 1.4l2 6A2 2 0 0 1 17.2 14H13l.7 3.1a2.4 2.4 0 0 1-2.3 2.9L7 14V4h3Z"/>',
      sound:'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/>',
      share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4M8.7 13.3l6.6 4.4"/>',
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

  let deferredInstallPrompt = null;
  const installBannerStorageKey = "teslafield.installBanner.lastShown.v1";
  const installBannerCooldown = 5 * 60 * 1000;

  function isTeslafieldAIInstalled() {
    const standaloneMode = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    return !!(standaloneMode || window.navigator.standalone === true);
  }

  function initializePwaInstall() {
    const banner = $("installExperienceBanner");
    const installButton = $("installExperienceDownload");
    const closeButton = $("installExperienceClose");
    if (!banner || !installButton || !closeButton) return;

    const hideBanner = () => {
      banner.classList.remove("is-visible");
      window.setTimeout(() => {
        if (!banner.classList.contains("is-visible")) banner.hidden = true;
      }, 220);
    };

    const showBannerWhenDue = (chat) => {
      if (!currentUser || !chat || activeChat() !== chat || isTeslafieldAIInstalled()) return;
      let completedExchanges = 0;
      for (let index = 0; index < chat.messages.length - 1; index += 1) {
        if (chat.messages[index].role === "user" && chat.messages[index + 1].role === "assistant" && String(chat.messages[index + 1].content || "").trim()) {
          completedExchanges += 1;
        }
      }
      if (completedExchanges < 2) return;
      let lastShown = 0;
      try { lastShown = Number(localStorage.getItem(installBannerStorageKey)) || 0; } catch (error) {}
      if (lastShown && Date.now() - lastShown < installBannerCooldown) return;
      banner.hidden = false;
      window.requestAnimationFrame(() => banner.classList.add("is-visible"));
      try { localStorage.setItem(installBannerStorageKey, String(Date.now())); } catch (error) {}
    };
    window.showBannerWhenDue = showBannerWhenDue;

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      hideBanner();
      toast("TeslafieldAI has been installed on your device.");
    });

    closeButton.addEventListener("click", hideBanner);
    installButton.addEventListener("click", async () => {
      if (isTeslafieldAIInstalled()) {
        hideBanner();
        toast("TeslafieldAI is already installed.");
        return;
      }
      try {
        if (typeof navigator.install === "function") {
          await navigator.install();
          hideBanner();
          return;
        }
        if (deferredInstallPrompt) {
          const promptEvent = deferredInstallPrompt;
          deferredInstallPrompt = null;
          await promptEvent.prompt();
          const choice = await promptEvent.userChoice;
          if (choice && choice.outcome === "accepted") hideBanner();
          return;
        }
        const userAgent = navigator.userAgent || "";
        if (/iphone|ipad|ipod/i.test(userAgent)) {
          toast("To add TeslafieldAI: tap Share in Safari, choose Add to Home Screen, then tap Add.");
        } else {
          toast("To install TeslafieldAI, open your browser menu ⋮ and choose Install app or Add to Home screen.");
        }
      } catch (error) {
        toast("The install prompt could not open. Use your browser menu to install TeslafieldAI.");
      }
    });

    if ("serviceWorker" in navigator) {
      const registerServiceWorker = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
      if (document.readyState === "complete") registerServiceWorker();
      else window.addEventListener("load", registerServiceWorker, { once: true });
    }
  }


  function setGuestLayout(guest) {
    document.body.classList.toggle("guest-mode", !!guest);
    document.body.classList.toggle("guest-conversation-mode", !!guest && guestConversationStarted);
    if (guest) {
      if (guestConversationStarted) {
        const mainPanel = document.querySelector(".main-panel");
        if (composerArea.parentElement !== mainPanel) mainPanel.appendChild(composerArea);
      } else if (composerArea.parentElement !== welcome) {
        const starterGrid = welcome.querySelector(".starter-grid");
        welcome.insertBefore(composerArea, starterGrid || null);
      }
    } else if (composerArea.parentElement !== composerHome.parentNode) {
      composerHome.parentNode.insertBefore(composerArea, composerHome.nextSibling);
    }
  }

  function openSignupPrompt() {
    $("signupPromptModal").hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => $("signupPromptSignUp").focus(), 40);
  }

  function closeSignupPrompt() {
    $("signupPromptModal").hidden = true;
    if ($("cookieSettingsBackdrop").hidden) document.body.classList.remove("modal-open");
  }

  function savePendingGuestPrompt(value) {
    pendingGuestPrompt = String(value || "").trim().slice(0, 12000);
    try {
      if (pendingGuestPrompt) sessionStorage.setItem("teslafield.pendingGuestPrompt.v1", pendingGuestPrompt);
      else sessionStorage.removeItem("teslafield.pendingGuestPrompt.v1");
    } catch (error) {}
  }

  function readPendingGuestPrompt() {
    if (pendingGuestPrompt) return pendingGuestPrompt;
    try { return sessionStorage.getItem("teslafield.pendingGuestPrompt.v1") || ""; }
    catch (error) { return ""; }
  }

  function clearPendingGuestPrompt() {
    pendingGuestPrompt = "";
    try { sessionStorage.removeItem("teslafield.pendingGuestPrompt.v1"); } catch (error) {}
  }

  function updateAccountUI() {
    const signedIn = !!currentUser;
    document.body.classList.toggle("signed-in", signedIn);
    const modelSelectorRow = document.querySelector(".composer-model-row");
    if (modelSelectorRow) modelSelectorRow.hidden = !signedIn;
    const attachmentControl = $("attachmentButton");
    if (attachmentControl) attachmentControl.hidden = !signedIn;
    const displayName = signedIn ? (currentUser.displayName || (currentUser.email || "Google user").split("@")[0]) : "TeslafieldAI";
    $("accountDisplayName").textContent = displayName;
    $("accountDisplayEmail").textContent = signedIn ? (currentUser.email || "Google account") : "Sign in to your account";
    $("accountAvatarFallback").textContent = displayName.trim().charAt(0).toUpperCase() || "T";
    const avatarImage = $("accountAvatarImage");
    if (signedIn && currentUser.photoURL) {
      avatarImage.src = currentUser.photoURL;
      avatarImage.hidden = false;
      $("accountAvatarFallback").hidden = true;
    } else {
      avatarImage.removeAttribute("src");
      avatarImage.hidden = true;
      $("accountAvatarFallback").hidden = false;
    }
    if (signedIn) {
      guestConversationStarted = false;
      document.body.classList.remove("guest-mode", "guest-conversation-mode");
      const heading = welcome.querySelector("h1");
      const subtitle = welcome.querySelector(".welcome-subtitle");
      if (heading) heading.textContent = "Welcome to TeslafieldAI";
      if (subtitle) showNextWelcomeMessage();
    } else {
      const heading = welcome.querySelector("h1");
      const subtitle = welcome.querySelector(".welcome-subtitle");
      if (heading) heading.textContent = "What would you like to explore?";
      if (subtitle) showNextWelcomeMessage();
    }
    setGuestLayout(!signedIn);
    $("accountStatus").textContent = signedIn
      ? "Signed in securely. Your chats are saved locally and sync when cloud history is enabled."
      : "Sign in with Google to use TeslafieldAI securely.";
    $("accountSignUp").hidden = signedIn;
    $("accountLogIn").hidden = signedIn;
    $("accountSignOut").hidden = !signedIn;
    $("accountDelete").hidden = !signedIn;
    $("topSignUp").hidden = signedIn;
    $("topLogIn").hidden = signedIn;
  }


  function openConnectPage() {
    connectReturnFocus = document.activeElement;
    document.body.classList.add("connect-page-mode");
    $("appShell").hidden = true; $("connectPage").hidden = false;
    $("gmailDetailCard").hidden = true; $("connectAppList").hidden = false;
    $("connectSearchInput").value = ""; $("connectNoResults").hidden = true;
    $("connectBackButton").focus();
    if (location.pathname !== "/connect") history.pushState({ teslafieldPage: "connect" }, "", "/connect");
  }
  function closeConnectPage(fromPopState) {
    $("connectPage").hidden = true; $("appShell").hidden = false;
    document.body.classList.remove("connect-page-mode");
    if (!fromPopState && location.pathname === "/connect") history.pushState({ teslafieldPage: "home" }, "", "/");
    if (connectReturnFocus && connectReturnFocus.focus) connectReturnFocus.focus();
  }
  function updateGmailConnectionUI() {
    const connected = !!gmailAccessToken;
    $("gmailStatus").textContent = connected ? "Connected for this session" : "Not connected";
    $("gmailDetailStatus").textContent = connected ? "Connected for this session" : "Not connected";
    $("gmailConnectAction").innerHTML = connected ? "Manage" : '<span aria-hidden="true">＋</span> Connect';
    $("gmailDetailConnect").hidden = connected; $("gmailDisconnect").hidden = !connected;
    $("gmailSetupNote").textContent = connected ? "Gmail access is temporary for this browser session. Disconnect at any time." : "Google OAuth setup is required before Gmail can be connected. Your Gmail password is never shared with TeslafieldAI.";
  }
  function showGmailDetails() { $("connectAppList").hidden = true; $("gmailDetailCard").hidden = false; updateGmailConnectionUI(); $("gmailDetailBack").focus(); }
  function beginGmailConnect() { showGmailDetails(); toast("Gmail connection is not activated yet. Google OAuth client setup is required first."); }
  function disconnectGmail() {
    if (gmailAccessToken && window.google && google.accounts && google.accounts.oauth2) { try { google.accounts.oauth2.revoke(gmailAccessToken, () => {}); } catch (error) {} }
    gmailAccessToken = null; updateGmailConnectionUI(); toast("Gmail disconnected.");
  }

  function initializeCookieChoices() {
    const key = "teslafield.cookieConsent.v1";
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch (error) {}
    if (!saved || saved.version !== 1 || typeof saved.essential !== "boolean") {
      $("cookieBanner").hidden = false;
      return;
    }
    $("cookieAnalytics").checked = !!saved.analytics;
    $("cookieAdvertising").checked = !!saved.advertising;
  }

  function storeCookieChoices(analytics, advertising) {
    const value = {
      version: 1,
      essential: true,
      analytics: !!analytics,
      advertising: !!advertising,
      savedAt: new Date().toISOString()
    };
    try { localStorage.setItem("teslafield.cookieConsent.v1", JSON.stringify(value)); }
    catch (error) { toast("Your cookie preference could not be saved in this browser."); }
    $("cookieBanner").hidden = true;
    $("cookieSettingsBackdrop").hidden = true;
    document.body.classList.remove("modal-open");
  }

  function openCookieSettings() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("teslafield.cookieConsent.v1") || "null"); } catch (error) {}
    $("cookieAnalytics").checked = !!(saved && saved.analytics);
    $("cookieAdvertising").checked = !!(saved && saved.advertising);
    $("cookieSettingsBackdrop").hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => $("closeCookieSettings").focus(), 40);
  }

  function applyFirebaseUser(user) {
    const previousUid = currentUser && currentUser.uid;
    const nextUid = user && user.uid;
    currentUser = user || null;
    authReady = true;
    resolveAuthReady();
    updateAccountUI();
    if (previousUid !== nextUid) {
      if (generating) stopGeneration();
      chats = [];
      activeId = null;
      cloudSyncReady = false;
      cloudSyncFingerprints = new Map();
      cloudDeletedIds = new Set();
      cloudSyncedDeletedIds = new Set();
      if (cloudSyncTimer) { clearTimeout(cloudSyncTimer); cloudSyncTimer = null; }
      if (currentUser) {
        loadStore();
        loadDeletedConversationIds();
        activeId = chats.length ? chats[0].id : null;
        syncCloudHistory();
      }
      messageList.innerHTML = "";
      renderConversation();
    }
    if (currentUser) {
      guestConversationStarted = false;
      setGuestLayout(false);
      closeSignupPrompt();
      const pending = readPendingGuestPrompt();
      if (pending) {
        clearPendingGuestPrompt();
        activeId = null;
        welcome.hidden = false;
        renderConversation();
        promptInput.value = pending;
        window.setTimeout(() => sendMessage(pending), 120);
      } else if (!activeChat()) {
        welcome.hidden = false;
        renderConversation();
      }
    }
  }

  async function initializeFirebaseAuth() {
    if (!window.firebase || !window.firebase.apps || !window.firebase.apps.length) {
      authReady = true;
      resolveAuthReady();
      updateAccountUI();
      toast("Firebase Authentication is unavailable. Reload TeslafieldAI and try again.");
      return;
    }
    try {
      authClient = window.firebase.auth();

      // Prefer a remembered session, but do not let unsupported browser storage
      // prevent the auth listener or Google sign-in from starting.
      try {
        await authClient.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
      } catch (localError) {
        try {
          await authClient.setPersistence(window.firebase.auth.Auth.Persistence.SESSION);
        } catch (sessionError) {
          try {
            await authClient.setPersistence(window.firebase.auth.Auth.Persistence.NONE);
          } catch (memoryError) {
            // Firebase can still attempt an in-memory popup sign-in.
          }
        }
      }

      // Always attach the observer before consuming a possible redirect result.
      authClient.onAuthStateChanged(
        (user) => applyFirebaseUser(user),
        (error) => {
          authReady = true;
          resolveAuthReady();
          updateAccountUI();
          toast("TeslafieldAI could not restore your sign-in session. Please sign in again.");
        }
      );

      try {
        const result = await authClient.getRedirectResult();
        if (result && result.user) applyFirebaseUser(result.user);
        else if (authClient.currentUser) applyFirebaseUser(authClient.currentUser);
      } catch (error) {
        if (authClient.currentUser) applyFirebaseUser(authClient.currentUser);
        const code = error && error.code;
        if (code && code !== "auth/no-auth-event") {
          const messages = {
            "auth/unauthorized-domain": "Google sign-in domain is not authorized in Firebase.",
            "auth/operation-not-allowed": "Google sign-in is disabled in Firebase Authentication.",
            "auth/network-request-failed": "Network interrupted Google sign-in. Please try again.",
            "auth/web-storage-unsupported": "This browser is blocking sign-in storage. Open TeslafieldAI in Chrome and allow site storage."
          };
          toast(messages[code] || ("Google sign-in could not finish (" + code + "). Please try again."));
        }
      }
    } catch (error) {
      if (authClient && authClient.currentUser) {
        applyFirebaseUser(authClient.currentUser);
        return;
      }
      authReady = true;
      resolveAuthReady();
      authClient = null;
      updateAccountUI();
      toast("TeslafieldAI could not initialize Google sign-in. Reload and try again.");
    }
  }

  async function requireAuthentication(promptText) {
    await authReadyPromise;
    if (currentUser) return true;
    if (promptText) {
      savePendingGuestPrompt(promptText);
      promptInput.value = promptText;
    }
    if (!authClient) toast("Google sign-in is not initialized on this site yet.");
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
    closeSignupPrompt();
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    closeMenus();
    try {
      // Try the direct popup flow first, including on Android. It avoids the
      // cross-site redirect helper storage issue seen in some mobile browsers.
      const result = await authClient.signInWithPopup(provider);
      if (result && result.user) applyFirebaseUser(result.user);
    } catch (error) {
      const code = error && error.code;
      const canFallbackToRedirect = [
        "auth/popup-blocked",
        "auth/operation-not-supported-in-this-environment",
        "auth/web-storage-unsupported"
      ].includes(code);
      if (canFallbackToRedirect) {
        try {
          await authClient.signInWithRedirect(provider);
          return;
        } catch (redirectError) {
          const redirectCode = redirectError && redirectError.code;
          toast(redirectCode === "auth/unauthorized-domain"
            ? "Firebase blocked the return address. Add teslafieldai.web.app to Authorized domains."
            : "Google sign-in could not return to TeslafieldAI. Please retry in Chrome.");
          return;
        }
      }
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      if (code === "auth/operation-not-allowed") {
        toast("Google sign-in is disabled in Firebase Authentication. Enable the Google provider.");
      } else if (code === "auth/unauthorized-domain") {
        toast("Add teslafieldai.web.app to Firebase Authentication authorized domains.");
      } else {
        toast("Google sign-in failed (" + (code || "unknown error") + "). Please try again.");
      }
    }
  }

  async function deleteAccountAndLocalData() {
    if (!currentUser) return;
    const user = currentUser;
    const uid = user.uid;
    if (!window.confirm("Permanently delete your TeslafieldAI account and its cloud conversations? This also removes local chat data on this device. External AI providers may retain data under their own policies. This cannot be undone.")) return;
    try {
      const token = await user.getIdToken();
      const remote = await cloudHistoryRequest("GET", token);
      const ids = new Set([
        ...chats.map((chat) => chat.id),
        ...(Array.isArray(remote.conversations) ? remote.conversations.map((chat) => chat.id) : []),
        ...(Array.isArray(remote.deleted) ? remote.deleted.map((item) => item.id) : [])
      ]);
      for (const id of ids) {
        if (currentUser !== user) throw new Error("ACCOUNT_CHANGED");
        await cloudHistoryRequest("DELETE", token, null, id);
      }
      await user.delete();
      localStorage.removeItem("teslafield.conversations.v4." + uid);
      localStorage.removeItem("teslafield.conversations.deleted.v1." + uid);
      localStorage.removeItem("teslafield.conversations.v2");
      localStorage.removeItem("teslafield.conversations.v3");
      chats = [];
      cloudDeletedIds = new Set();
      cloudSyncedDeletedIds = new Set();
      activeId = null;
      renderConversation();
      toast("Your TeslafieldAI account and cloud chat data were deleted.");
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
  function deletedConversationStoreKey() {
    return currentUser ? "teslafield.conversations.deleted.v1." + currentUser.uid : null;
  }
  function loadDeletedConversationIds() {
    cloudDeletedIds = new Set();
    const key = deletedConversationStoreKey();
    if (!key) return;
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(value)) value.filter((id) => typeof id === "string").forEach((id) => cloudDeletedIds.add(id));
    } catch (error) {}
  }
  function saveDeletedConversationIds() {
    const key = deletedConversationStoreKey();
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(Array.from(cloudDeletedIds).slice(-500))); } catch (error) {}
  }
  function markConversationDeleted(id) {
    if (typeof id !== "string" || !id) return;
    cloudDeletedIds.add(id);
    saveDeletedConversationIds();
    queueCloudHistorySync();
  }
  function exportConversationHistory() {
    const payload = {
      exportedAt: new Date().toISOString(),
      product: "TeslafieldAI",
      conversations: chats
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "teslafieldai-chat-history-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("Your visible chat history export is ready.");
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
      if (cloudSyncReady) queueCloudHistorySync();
    } catch (error) {
      toast("This browser could not save the conversation history.");
    }
  }
  function cloudConversationFingerprint(chat) {
    return JSON.stringify(chat);
  }

  async function cloudHistoryRequest(method, token, payload, id) {
    const url = API + "/api/v1/conversations" + (id ? "?id=" + encodeURIComponent(id) : "");
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {})
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || "Cloud history request failed.");
      error.code = data.error || "CLOUD_HISTORY_ERROR";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function syncCloudHistory() {
    if (!currentUser || cloudSyncBusy) return;
    const user = currentUser;
    cloudSyncBusy = true;
    cloudSyncReady = false;
    try {
      const token = await user.getIdToken();
      const result = await cloudHistoryRequest("GET", token);
      if (currentUser !== user) return;
      const remote = Array.isArray(result.conversations) ? result.conversations : [];
      const remoteDeleted = Array.isArray(result.deleted) ? result.deleted.map((item) => item && item.id).filter(Boolean) : [];
      remoteDeleted.forEach((id) => cloudDeletedIds.add(id));
      cloudSyncedDeletedIds = new Set(remoteDeleted);
      saveDeletedConversationIds();
      const deletedIds = new Set(cloudDeletedIds);
      chats = chats.filter((chat) => !deletedIds.has(chat.id));
      const liveRemote = remote.filter((chat) => !deletedIds.has(chat.id));
      const local = chats.slice(0, MAX_HISTORY);
      const merged = new Map(liveRemote.map((chat) => [chat.id, chat]));
      local.forEach((chat) => {
        const existing = merged.get(chat.id);
        if (!existing || Number(chat.updated || 0) >= Number(existing.updated || 0)) merged.set(chat.id, chat);
      });
      chats = Array.from(merged.values()).sort((a, b) => Number(b.updated || b.created || 0) - Number(a.updated || a.created || 0)).slice(0, MAX_HISTORY);
      if (!activeId || !chats.some((chat) => chat.id === activeId)) activeId = chats.length ? chats[0].id : null;
      try { localStorage.setItem(conversationStoreKey(), JSON.stringify(chats)); } catch (error) {}
      cloudSyncFingerprints = new Map(liveRemote.map((chat) => [chat.id, cloudConversationFingerprint(chat)]));
      cloudSyncReady = true;
      renderConversation();
      cloudSyncBusy = false;
      await pushCloudHistoryChanges();
    } catch (error) {
      cloudSyncReady = false;
      if (!cloudHistoryWarningShown) {
        cloudHistoryWarningShown = true;
        const message = error.code === "FIRESTORE_NOT_READY"
          ? "Cloud history is not enabled yet. Your chats remain saved on this device."
          : "Cloud history could not sync right now. Your chats remain saved on this device.";
        toast(message);
      }
    } finally {
      cloudSyncBusy = false;
      if (currentUser && currentUser !== user) syncCloudHistory();
    }
  }

  function queueCloudHistorySync() {
    if (!currentUser || !cloudSyncReady) return;
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
      cloudSyncTimer = null;
      pushCloudHistoryChanges();
    }, 900);
  }

  async function pushCloudHistoryChanges() {
    if (!currentUser || !cloudSyncReady || cloudSyncBusy) return;
    const user = currentUser;
    cloudSyncBusy = true;
    try {
      const token = await user.getIdToken();
      const local = chats.slice(0, MAX_HISTORY);
      const currentIds = new Set(local.map((chat) => chat.id));
      for (const id of cloudDeletedIds) {
        if (currentUser !== user) return;
        if (cloudSyncedDeletedIds.has(id)) continue;
        await cloudHistoryRequest("DELETE", token, null, id);
        cloudSyncedDeletedIds.add(id);
        cloudSyncFingerprints.delete(id);
      }
      for (const chat of local) {
        if (currentUser !== user) return;
        const fingerprint = cloudConversationFingerprint(chat);
        if (cloudSyncFingerprints.get(chat.id) === fingerprint) continue;
        await cloudHistoryRequest("PUT", token, { conversation: chat });
        cloudSyncFingerprints.set(chat.id, fingerprint);
      }
      for (const id of Array.from(cloudSyncFingerprints.keys())) {
        if (currentUser !== user) return;
        if (currentIds.has(id)) continue;
        await cloudHistoryRequest("DELETE", token, null, id);
        cloudSyncFingerprints.delete(id);
      }
    } catch (error) {
      if (!cloudHistoryWarningShown) {
        cloudHistoryWarningShown = true;
        toast("Cloud history sync paused. Your local chat is still saved.");
      }
    } finally {
      cloudSyncBusy = false;
      if (currentUser && currentUser !== user) syncCloudHistory();
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
  function renderMarkdownTable(rows) {
    const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    const header = cells(rows[0]);
    const body = rows.slice(1).map(cells);
    const headHtml = "<thead><tr>" + header.map((cell) => "<th>" + inlineMarkup(cell) + "</th>").join("") + "</tr></thead>";
    const bodyHtml = body.length
      ? "<tbody>" + body.map((row) => "<tr>" + header.map((_, index) => "<td>" + inlineMarkup(row[index] || "") + "</td>").join("") + "</tr>").join("") + "</tbody>"
      : "";
    return "<div class=\"table-scroll\"><table class=\"response-table\">" + headHtml + bodyHtml + "</table></div>";
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
      let html = "", paragraph = [], list = "", tableRows = null;
      const flushParagraph = () => {
        if (paragraph.length) { html += "<p>" + paragraph.map(inlineMarkup).join("<br>") + "</p>"; paragraph = []; }
      };
      const closeList = () => { if (list) { html += list === "ul" ? "</ul>" : "</ol>"; list = ""; } };
      const flushTable = () => { if (tableRows && tableRows.length) html += renderMarkdownTable(tableRows); tableRows = null; };
      const isTableRule = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
      lines.forEach((line, lineIndex) => {
        const value = line.trim();
        if (tableRows) {
          if (isTableRule(value)) return;
          if (value.startsWith("|")) { tableRows.push(value); return; }
          flushTable();
        }
        if (value.startsWith("|") && lineIndex + 1 < lines.length && isTableRule(lines[lineIndex + 1])) {
          flushParagraph(); closeList(); tableRows = [value]; return;
        }
        if (!value) { flushParagraph(); closeList(); return; }
        const heading = value.match(/^(#{1,3})\s+(.+)$/);
        if (heading) { flushParagraph(); closeList(); const level = Math.min(heading[1].length + 1, 4); html += "<h" + level + ">" + inlineMarkup(heading[2]) + "</h" + level + ">"; return; }
        if (/^---+$/.test(value)) { flushParagraph(); closeList(); html += "<hr>"; return; }
        const bullet = value.match(/^[-*]\s+(.+)$/);
        const numbered = value.match(/^\d+[.)]\s+(.+)$/);
        if (bullet || numbered) {
          flushParagraph(); const next = bullet ? "ul" : "ol";
          if (list !== next) { closeList(); list = next; html += next === "ul" ? "<ul>" : "<ol>"; }
          html += "<li>" + inlineMarkup((bullet || numbered)[1]) + "</li>"; return;
        }
        const quote = value.match(/^>\s?(.*)$/);
        if (quote) { flushParagraph(); closeList(); html += "<blockquote>" + inlineMarkup(quote[1]) + "</blockquote>"; return; }
        closeList(); paragraph.push(value);
      });
      flushParagraph(); closeList(); flushTable();
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
    const stack = document.createElement("div");
    stack.className = "message-stack " + message.role + "-stack";
    const body = document.createElement("div");
    body.className = "message-content";
    body.innerHTML = renderMarkdown(message.content);
    body.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      if (!code) return;
      const copyCode = document.createElement("button");
      copyCode.type = "button";
      copyCode.className = "code-copy-button";
      copyCode.innerHTML = icon("copy") + "<span>Copy code</span>";
      copyCode.setAttribute("aria-label", "Copy code block");
      copyCode.onclick = () => copyText(code.textContent || "");
      pre.appendChild(copyCode);
    });
    stack.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "message-actions";
    if (message.role === "assistant") {
      const copy = document.createElement("button");
      copy.type = "button"; copy.innerHTML = icon("copy") + "<span>Copy</span>";
      copy.setAttribute("aria-label", "Copy response");
      copy.onclick = () => copyText(message.content);
      const read = document.createElement("button");
      read.type = "button"; read.innerHTML = icon("sound") + "<span>Read aloud</span>";
      read.setAttribute("aria-label", "Read aloud");
      read.onclick = () => speak(message.content);
      const like = document.createElement("button");
      like.type = "button"; like.innerHTML = icon("up"); like.title = "Helpful"; like.setAttribute("aria-label", "Helpful");
      like.onclick = () => { like.classList.add("selected"); dislike.classList.remove("selected"); toast("Thanks for the feedback."); };
      const dislike = document.createElement("button");
      dislike.type = "button"; dislike.innerHTML = icon("down"); dislike.title = "Not helpful"; dislike.setAttribute("aria-label", "Not helpful");
      dislike.onclick = () => { dislike.classList.add("selected"); like.classList.remove("selected"); toast("Feedback noted."); };
      actions.append(copy, read, like, dislike);
      if (index === chat.messages.length - 1) {
        const retry = document.createElement("button");
        retry.type = "button"; retry.innerHTML = icon("retry") + "<span>Regenerate</span>";
        retry.setAttribute("aria-label", "Regenerate response");
        retry.onclick = regenerateLast;
        actions.append(retry);
      }
      const share = document.createElement("button");
      share.type = "button"; share.innerHTML = icon("share") + "<span>Share</span>";
      share.setAttribute("aria-label", "Share this response");
      share.onclick = () => shareAssistantMessage(message.content);
      actions.append(share);
    } else {
      const copy = document.createElement("button");
      copy.type = "button"; copy.innerHTML = icon("copy") + "<span>Copy</span>";
      copy.onclick = () => copyText(message.content);
      const edit = document.createElement("button");
      edit.type = "button"; edit.innerHTML = icon("edit") + "<span>Edit</span>";
      edit.onclick = () => editUserMessage(index);
      actions.append(copy, edit);
    }
    stack.appendChild(actions);
    row.appendChild(stack);
    messageList.appendChild(row);
  }
  async function shareAssistantMessage(content) {
    try {
      const payload = JSON.stringify({ content: String(content || ""), createdAt: new Date().toISOString() });
      const bytes = new TextEncoder().encode(payload);
      let encoded = "j" + base64UrlEncode(bytes);
      // Use gzip only when both ends of the share flow support it, and only when it shortens the URL.
      if ("CompressionStream" in window && "DecompressionStream" in window) {
        try {
          const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
          const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
          const gzipEncoded = "g" + base64UrlEncode(compressed);
          if (gzipEncoded.length < encoded.length) encoded = gzipEncoded;
        } catch (error) {}
      }
      const id = Array.from(crypto.getRandomValues(new Uint8Array(18)), (v, i) => String(i === 0 ? (v % 9) + 1 : v % 10)).join("");
      // Keep response data in a query parameter; messaging apps often discard URL fragments.
      const shareUrl = location.origin + "/share/" + id + "?data=" + encodeURIComponent(encoded);
      if (navigator.share) {
        try {
          await navigator.share({ title: "TeslafieldAI AI response", text: "A response shared from TeslafieldAI AI", url: shareUrl });
          return;
        } catch (error) { if (error && error.name === "AbortError") return; }
      }
      await copyText(shareUrl);
      toast("Share link copied. Send it to anyone.");
    } catch (error) {
      toast("This response could not be prepared for sharing. Please try again.");
    }
  }

  function base64UrlEncode(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlDecode(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  async function openSharedMessagePage() {
    if (!/^\/share\/\d{12,24}\/?$/.test(location.pathname)) return false;
    const appShell = document.querySelector(".app-shell");
    if (appShell) appShell.hidden = true;
    $("sharedMessagePage").hidden = false;
    try {
      const query = new URLSearchParams(location.search);
      // Prefer the query payload used by current links; retain fragment support for older links.
      const payload = query.get("data") || location.hash.slice(1);
      if (!payload || !/^[gj][A-Za-z0-9_-]+$/.test(payload)) throw new Error("Missing or invalid share data");
      let bytes = base64UrlDecode(payload.slice(1));
      if (payload[0] === "g") {
        if (!("DecompressionStream" in window)) throw new Error("This browser cannot open this compressed share link");
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Shared response is too large");
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (!data || typeof data.content !== "string" || !data.content.trim()) throw new Error("Invalid share data");
      $("sharedMessageContent").innerHTML = renderMarkdown(data.content);
      $("copySharedMessage").hidden = false;
      $("copySharedMessage").onclick = () => copyText(data.content);
      $("sharedMessageTitle").textContent = "A response shared from TeslafieldAI";
      document.title = "Shared response | TeslafieldAI AI";
    } catch (error) {
      $("sharedMessageTitle").textContent = "This shared response is unavailable";
      $("sharedMessageContent").textContent = "The link is incomplete or its response data was removed. Ask the sender to create a fresh share link.";
      $("copySharedMessage").hidden = true;
    }
    return true;
  }

  function renderConversation() {
    const chat = activeChat();
    messageList.innerHTML = "";
    // Keep the starter screen visible for a signed-in account with no messages yet.
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
    ["attachmentButton", "accountButton"].forEach((id) => {
      if (id === except) return;
      const element = $(id);
      if (element) element.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".history-row-menu").forEach((menu) => menu.remove());
  }
  function renderHistory() {
    const list = $("historyList");
    list.innerHTML = "";
    const query = ($("historySearch") && $("historySearch").value || "").trim().toLowerCase();
    const visible = chats.filter((chat) => !query ||
      (chat.title || "").toLowerCase().includes(query) ||
      chat.messages.some((message) => String(message.content || "").toLowerCase().includes(query)));
    const groups = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
    groups.forEach((groupName) => {
      const items = visible.filter((chat) => groupName === "Pinned"
        ? !!chat.pinned
        : !chat.pinned && dateGroup(chat.updated || chat.created) === groupName);
      if (!items.length) return;
      const group = document.createElement("div");
      group.className = "history-group";
      const label = document.createElement("div");
      label.className = "history-group-label";
      label.textContent = groupName;
      group.appendChild(label);
      items.sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0)).forEach((chat) => {
        const row = document.createElement("div");
        row.className = "history-row" + (chat.id === activeId ? " active" : "") + (chat.pinned ? " pinned" : "");
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
            markConversationDeleted(chat.id);
            if (activeId === chat.id) { activeId = null; messageList.innerHTML = ""; welcome.hidden = false; }
            saveStore(); renderHistory();
          };
          const pin = document.createElement("button");
          pin.type = "button"; pin.textContent = chat.pinned ? "Unpin conversation" : "Pin conversation";
          pin.onclick = () => { chat.pinned = !chat.pinned; saveStore(); renderHistory(); };
          menu.append(pin, rename, remove); row.appendChild(menu);
        };
        row.append(open, more); group.appendChild(row);
      });
      list.appendChild(group);
    });
    $("historyEmpty").hidden = visible.length > 0;
    $("historyEmpty").textContent = query ? "No matching conversations." : "Your conversations will appear here.";
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
    guestConversationStarted = false;
    setGuestLayout(!currentUser);
    clearPendingGuestPrompt();
    messageList.innerHTML = "";
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
    row.className = "message-row assistant typing-row";
    row.setAttribute("role", "status");
    row.setAttribute("aria-label", "TeslafieldAI is preparing a response");
    row.innerHTML = '<div class="typing-status"><span class="typing-dots"><i></i><i></i><i></i></span><span>Thinking…</span></div>';
    messageList.appendChild(row);
    scrollBottom();
    return row;
  }
  function stopGeneration() {
    const activeController = controller;
    if (activeController) activeController.abort();
    if (controller === activeController) controller = null;
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
        toast(error.message || "TeslafieldAI voice is temporarily unavailable.");
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[\u0B80-\u0BFF]/.test(text) ? "ta-IN" : "en-IN";
      window.speechSynthesis.speak(utterance);
      toast("TeslafieldAI Voice is unavailable; using your device voice.");
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

  async function startVoiceRecording() {
    if (voiceStartPending || (mediaRecorder && mediaRecorder.state !== "inactive")) return;
    if (!currentUser) {
      toast("Sign in to use voice input.");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast("Voice recording is not supported by this browser. Try Chrome on Android.");
      return;
    }
    const attempt = ++voiceStartAttempt;
    voiceStartPending = true;
    let acquiredStream = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      acquiredStream = stream;
      // Permission prompts cannot be cancelled by the browser. Ignore stale grants.
      if (attempt !== voiceStartAttempt || !currentUser) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      let chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        recorder.failed = true;
        clearTimeout(recordingTimer);
        stream.getTracks().forEach((track) => track.stop());
        if (mediaRecorder === recorder) mediaRecorder = null;
        if (mediaRecorderStream === stream) mediaRecorderStream = null;
        resetMicButton();
        toast("The microphone recording failed. Please try again.");
      };
      recorder.onstop = async () => {
        clearTimeout(recordingTimer);
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorder = null;
        mediaRecorderStream = null;
        chunks = chunks || [];
        if (recorder.cancelled || recorder.failed) {
          chunks = [];
          resetMicButton();
          return;
        }
        const audioBlob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        chunks = [];
        resetMicButton();
        if (!audioBlob.size) {
          toast("No audio was captured. Please try again.");
          return;
        }
        if (audioBlob.size > 8 * 1024 * 1024) {
          toast("That recording is too large. Please record a shorter message.");
          return;
        }
        await transcribeVoiceRecording(audioBlob);
      };
      mediaRecorder = recorder;
      mediaRecorderStream = stream;
      recorder.start(250);
      const button = $("micButton");
      button.classList.add("recording");
      button.setAttribute("aria-label", "Finish voice recording");
      button.title = "Finish voice recording";
      $("composer").classList.add("voice-recording");
      const cancelButton = $("attachmentButton");
      cancelButton.classList.add("cancel-recording");
      cancelButton.setAttribute("aria-label", "Cancel voice recording");
      cancelButton.title = "Cancel voice recording";
      recordingTimer = setTimeout(() => stopVoiceRecording(), 45000);
      toast("Listening… tap the waveform to finish, or × to cancel.");
    } catch (error) {
      if (acquiredStream) acquiredStream.getTracks().forEach((track) => track.stop());
      if (mediaRecorderStream) mediaRecorderStream.getTracks().forEach((track) => track.stop());
      mediaRecorder = null;
      mediaRecorderStream = null;
      resetMicButton();
      const message = error && error.name === "NotAllowedError"
        ? "Allow microphone access in your browser settings, then try again."
        : "TeslafieldAI could not start the microphone. Please try again.";
      toast(message);
    } finally {
      if (attempt === voiceStartAttempt) voiceStartPending = false;
    }
  }

  function resetVoiceModeUI() {
    const composer = $("composer");
    const cancelButton = $("attachmentButton");
    if (composer) composer.classList.remove("voice-recording");
    if (cancelButton) {
      cancelButton.classList.remove("cancel-recording");
      cancelButton.setAttribute("aria-label", "Add files");
      cancelButton.title = "Add files";
    }
  }

  function resetMicButton() {
    const button = $("micButton");
    if (!button) return;
    button.classList.remove("recording", "transcribing");
    button.disabled = false;
    button.setAttribute("aria-label", "Record voice message");
    button.title = "Record voice message";
    resetVoiceModeUI();
  }

  function cancelVoiceRecording() {
    // Invalidate an unresolved permission prompt so a late grant cannot start recording.
    voiceStartAttempt += 1;
    voiceStartPending = false;
    clearTimeout(recordingTimer);
    const recorder = mediaRecorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.cancelled = true;
      recorder.stop();
    }
    if (mediaRecorderStream) mediaRecorderStream.getTracks().forEach((track) => track.stop());
    mediaRecorder = null;
    mediaRecorderStream = null;
    resetMicButton();
    toast("Voice recording cancelled.");
  }

  function stopVoiceRecording() {
    clearTimeout(recordingTimer);
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      resetVoiceModeUI();
      const button = $("micButton");
      button.classList.remove("recording");
      button.classList.add("transcribing");
      button.disabled = true;
      button.setAttribute("aria-label", "Transcribing voice");
      button.title = "Transcribing voice…";
    }
  }

  async function transcribeVoiceRecording(audioBlob) {
    const button = $("micButton");
    button.classList.add("transcribing");
    button.disabled = true;
    button.setAttribute("aria-label", "Transcribing voice");
    button.title = "Transcribing voice…";
    try {
      const token = await getAuthToken();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("The microphone recording could not be read."));
        reader.readAsDataURL(audioBlob);
      });
      const response = await fetch(API + "/api/v1/speech/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({
          audioBase64: dataUrl,
          mimeType: audioBlob.type || "audio/webm",
          language: "Auto detect"
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Speech recognition could not transcribe this recording.");
      const transcript = safeText(data.transcript).trim();
      if (!transcript) {
        toast(data.message || "No speech detected. Please try again.");
        return;
      }
      promptInput.value = (promptInput.value.trim() ? promptInput.value.trim() + " " : "") + transcript;
      promptInput.dispatchEvent(new Event("input", { bubbles: true }));
      promptInput.focus();
      toast("Voice transcribed. Review your message, then tap Send.");
    } catch (error) {
      toast(error.message || "Voice transcription is temporarily unavailable.");
    } finally {
      resetMicButton();
    }
  }

  async function requestReply(chat) {
    const idempotencyKey = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : makeId() + "-" + Date.now().toString(36);
    const requestController = new AbortController();
    const requestSignal = requestController.signal;
    controller = requestController;
    const typingIndicator = showTyping();
    setGenerating(true);
    try {
      await waitForApiReady(90000, requestSignal);
      if (requestSignal.aborted) throw new DOMException("Request cancelled", "AbortError");
      const token = await getAuthToken();
      if (requestSignal.aborted) throw new DOMException("Request cancelled", "AbortError");
      const chatRequest = {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ messages: chat.messages.slice(-30), response_style: userPreferences.responseStyle, model: userPreferences.model }),
        signal: requestSignal
      };
      let response;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (requestSignal.aborted) throw new DOMException("Request cancelled", "AbortError");
        response = await fetch(API + "/api/v1/chat/completions", chatRequest);
        if (response.ok || ![502, 503, 504].includes(response.status) || attempt === 2) break;
        await new Promise((resolve, reject) => {
          let timer;
          const abort = () => { clearTimeout(timer); reject(new DOMException("Request cancelled", "AbortError")); };
          timer = setTimeout(() => { requestSignal.removeEventListener("abort", abort); resolve(); }, attempt === 0 ? 1800 : 4500);
          requestSignal.addEventListener("abort", abort, { once: true });
          if (requestSignal.aborted) abort();
        });
      }
      if (requestSignal.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (!response) throw new Error("TeslafieldAI could not reach the chat service. Please retry.");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || "AI request failed (" + response.status + ").");
      const replyText = safeText(data.reply).trim();
      if (!replyText) throw new Error("The connected model returned an empty response.");
      if (requestSignal.aborted) throw new DOMException("Request cancelled", "AbortError");
      chat.messages.push({ role: "assistant", content: replyText });
      chat.updated = Date.now();
      saveStore();
      if (typeof window.showBannerWhenDue === "function") window.showBannerWhenDue(chat);
    } catch (error) {
      if (error.name !== "AbortError" && !requestSignal.aborted) {
        const message = error.message || "The AI service could not complete this request.";
        chat.messages.push({ role: "assistant", content: "**TeslafieldAI service notice**\n\n" + message + "\n\nYour prompt is saved in this conversation. You can retry after the service is connected." });
        chat.updated = Date.now();
        saveStore();
        toast(message);
      }
    } finally {
      typingIndicator.remove();
      if (controller === requestController) {
        controller = null;
        setGenerating(false);
        if (activeChat() === chat) renderConversation();
        else renderHistory();
      }
    }
  }
  function showGuestContinueCard() {
    const card = document.createElement("section");
    card.className = "guest-continue-card";
    card.innerHTML = '<div class="guest-continue-kicker">YOUR TeslafieldAI CHAT</div><h2>Want to continue?</h2><p>Create a free account to keep going with your message. Already have an account? Or continue the chat from <strong>Log in</strong>.</p><div class="guest-continue-actions"><button type="button" class="guest-continue-primary" id="guestContinueSignup">Sign up for free</button><button type="button" class="guest-continue-secondary" id="guestContinueLogin">Log in to continue</button></div><div class="guest-continue-footnote"><span class="guest-ready-dot"></span>Your message is ready. Continue securely with Google.</div>';
    messageList.appendChild(card);
    $("guestContinueSignup").onclick = accountEntry;
    $("guestContinueLogin").onclick = accountEntry;
    scrollBottom();
  }

  async function sendMessage(value) {
    const text = safeText(value === undefined ? promptInput.value : value).trim();
    if (!text || generating || sendPending) return;
    sendPending = true;
    try {
      if (!currentUser) {
        savePendingGuestPrompt(text);
        guestConversationStarted = true;
        welcome.hidden = true;
        setGuestLayout(true);
        messageList.innerHTML = "";
        const row = document.createElement("article");
        row.className = "message-row user guest-pending-message";
        const body = document.createElement("div");
        body.className = "message-content";
        body.textContent = text;
        row.appendChild(body);
        messageList.appendChild(row);
        showGuestContinueCard();
        promptInput.value = "";
        promptInput.style.height = "auto";
        return;
      }
      if (!(await requireAuthentication(text))) return;
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
    } finally {
      sendPending = false;
    }
  }
  async function regenerateLast() {
    const chat = activeChat();
    if (!chat || generating || sendPending) return;
    sendPending = true;
    try {
      if (!(await requireAuthentication())) return;
      if (chat.messages.length && chat.messages[chat.messages.length - 1].role === "assistant") chat.messages.pop();
      if (!chat.messages.length || chat.messages[chat.messages.length - 1].role !== "user") {
        toast("There is no user message to regenerate.");
        return;
      }
      saveStore();
      renderConversation();
      await requestReply(chat);
    } finally {
      sendPending = false;
    }
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
    if (extension === ".png") valid = bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
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
  async function waitForApiReady(maxWaitMs, signal) {
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      if (signal && signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (await pingApi()) return true;
      if (signal && signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      await new Promise((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("Request cancelled", "AbortError"));
        };
        const timer = setTimeout(() => {
          if (signal) signal.removeEventListener("abort", abort);
          resolve();
        }, Math.min(5000, 1200 + attempt * 700));
        if (signal) {
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }
      });
      attempt += 1;
    }
    throw new Error("TeslafieldAI is temporarily unavailable. Please retry shortly.");
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
  function readPersonalization() {
    try {
      const saved = JSON.parse(localStorage.getItem("teslafield.preferences.v1") || "null");
      if (saved && typeof saved === "object") {
        userPreferences = {
          responseStyle: ["concise", "balanced", "detailed"].includes(saved.responseStyle) ? saved.responseStyle : "balanced",
          textSize: ["small", "standard", "large"].includes(saved.textSize) ? saved.textSize : "standard",
          reduceMotion: saved.reduceMotion === true,
          model: typeof saved.model === "string" && /^[A-Za-z0-9._:/-]{1,160}$/.test(saved.model) ? saved.model : "teslafield"
        };
      }
    } catch (error) {}
    applyPersonalization();
  }
  function applyPersonalization() {
    root.dataset.chatSize = userPreferences.textSize;
    root.dataset.motion = userPreferences.reduceMotion ? "reduced" : "full";
  }
  function openPersonalize() {
    closeMenus();
    $("preferenceResponseStyle").value = userPreferences.responseStyle;
    $("preferenceTextSize").value = userPreferences.textSize;
    $("preferenceReduceMotion").checked = userPreferences.reduceMotion;
    $("personalizeModal").hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => $("preferenceResponseStyle").focus(), 40);
  }
  function closePersonalize() {
    $("personalizeModal").hidden = true;
    if ($("signupPromptModal").hidden && $("cookieSettingsBackdrop").hidden) document.body.classList.remove("modal-open");
  }
  function savePersonalize() {
    userPreferences = {
      responseStyle: $("preferenceResponseStyle").value,
      textSize: $("preferenceTextSize").value,
      reduceMotion: $("preferenceReduceMotion").checked,
      model: userPreferences.model || "teslafield"
    };
    try { localStorage.setItem("teslafield.preferences.v1", JSON.stringify(userPreferences)); }
    catch (error) { toast("Your preferences could not be saved in this browser."); }
    applyPersonalization();
    try { localStorage.setItem("teslafield.preferences.v1", JSON.stringify(userPreferences)); } catch (error) {}
    closePersonalize();
    toast("Your TeslafieldAI preferences are saved.");
  }

  function renderModelSelector() {
    const select = $("modelSelector");
    if (!select) return;
    const preferred = userPreferences.model || "teslafield";
    select.replaceChildren();
    const groups = [
      { label: "FREE / $0 MODELS", models: availableModels.filter((model) => model.free) },
      { label: "PAID MODELS · OPENROUTER", models: availableModels.filter((model) => !model.free) }
    ];
    groups.forEach((group) => {
      if (!group.models.length) return;
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      group.models.forEach((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        const formatPrice = (value) => Number(value || 0).toFixed(6).replace(/\.?0+$/, "");
        const price = model.free ? (model.provider === "OpenRouter" && model.id !== "openrouter/free" && model.freeTier !== true ? "$0 model price · account conditions may apply" : "Free") :
          "$" + formatPrice(model.promptPerMillion) + " USD in / $" + formatPrice(model.completionPerMillion) + " USD out per 1M tokens";
        option.textContent = model.name + " · " + price;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });
    if (availableModels.some((model) => model.id === preferred)) {
      select.value = preferred;
    } else {
      userPreferences.model = "teslafield";
      select.value = "teslafield";
      try { localStorage.setItem("teslafield.preferences.v1", JSON.stringify(userPreferences)); } catch (error) {}
    }
    const hint = $("modelSelectorHint");
    if (hint) {
      const routerReady = availableModels.some((model) => model.provider === "OpenRouter");
      hint.textContent = routerReady
        ? "When selected, messages are sent to OpenRouter. Paid models use your account. Some $0 models may still require account credits; :free variants are free but rate-limited. Prices are shown per 1M tokens."
        : "TeslafieldAI Free is active. More choices require a server-side OpenRouter key.";
    }
  }

  function renderModelPicker() {
    const list = $("modelPickerList");
    const button = $("modelPickerButton");
    const selectedLogo = $("modelPickerCurrentLogo");
    const selectedName = $("modelPickerCurrentName");
    if (!list || !button || !selectedLogo || !selectedName) return;
    const selected = availableModels.find((model) => model.id === (userPreferences.model || "teslafield")) ||
      availableModels.find((model) => model.id === "teslafield");
    if (selected) {
      selectedName.textContent = selected.id === "teslafield" ? "Teslafield B1" : selected.name;
      selectedLogo.src = selected.provider === "OpenRouter" ? "https://openrouter.ai/favicon.ico" : "/teslafieldai-logo.png?v=20261127-02";
      selectedLogo.alt = "";
    }
    list.replaceChildren();
    const own = availableModels.filter((model) => model.id === "teslafield");
    const allRouterFree = availableModels.filter((model) => model.provider === "OpenRouter" && model.free);
    const routerFree = allRouterFree.slice(0, 13);
    if (selected && selected.provider === "OpenRouter" && selected.free && !routerFree.some((model) => model.id === selected.id)) routerFree[12] = selected;
    const routerPaid = availableModels.filter((model) => model.provider === "OpenRouter" && !model.free);
    const groups = [
      { title: "TESLAFIELD", models: own },
      { title: "OPENROUTER · FREE MODELS", models: routerFree },
      { title: "OPENROUTER · PAID MODELS", models: routerPaid }
    ];
    groups.forEach((group) => {
      if (!group.models.length) return;
      const heading = document.createElement("div");
      heading.className = "model-picker-group-title";
      if (group.title.startsWith("OPENROUTER")) {
        const logo = document.createElement("img");
        logo.src = "https://openrouter.ai/favicon.ico";
        logo.alt = "";
        logo.className = "model-provider-logo";
        heading.appendChild(logo);
      } else {
        const logo = document.createElement("img");
        logo.src = "/teslafieldai-logo.png?v=20261127-02";
        logo.alt = "";
        logo.className = "model-provider-logo";
        heading.appendChild(logo);
      }
      const label = document.createElement("span");
      label.textContent = group.title;
      heading.appendChild(label);
      list.appendChild(heading);
      group.models.forEach((model) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "model-picker-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(model.id === (userPreferences.model || "teslafield")));
        option.dataset.modelId = model.id;
        const logo = document.createElement("img");
        logo.src = model.provider === "OpenRouter" ? "https://openrouter.ai/favicon.ico" : "/teslafieldai-logo.png?v=20261127-02";
        logo.alt = "";
        logo.className = "model-option-logo";
        logo.onerror = () => { logo.hidden = true; };
        const copy = document.createElement("span");
        copy.className = "model-option-copy";
        const name = document.createElement("strong");
        name.textContent = model.id === "teslafield" ? "Teslafield B1" : model.name;
        const meta = document.createElement("small");
        meta.textContent = model.free
          ? (model.provider === "OpenRouter" ? "FREE · OpenRouter" : "FREE · TeslafieldAI")
          : "PAID · $" + Number(model.promptPerMillion || 0).toFixed(4) + " in / $" + Number(model.completionPerMillion || 0).toFixed(4) + " out per 1M tokens";
        copy.append(name, meta);
        const check = document.createElement("span");
        check.className = "model-option-check";
        check.textContent = model.id === (userPreferences.model || "teslafield") ? "✓" : "";
        option.append(logo, copy, check);
        option.addEventListener("click", () => {
          const select = $("modelSelector");
          select.value = model.id;
          userPreferences.model = model.id;
          try { localStorage.setItem("teslafield.preferences.v1", JSON.stringify(userPreferences)); } catch (error) {}
          renderModelSelector();
          renderModelPicker();
          closeModelPicker();
          if (model.provider === "OpenRouter") {
            toast(model.free ? "OpenRouter free model selected. Provider limits and availability apply." : "Paid OpenRouter model selected. Usage charges may apply.");
          } else {
            toast("Teslafield B1 selected.");
          }
        });
        list.appendChild(option);
      });
    });
  }

  function openModelPicker() {
    const popup = $("modelPickerPopup");
    if (!popup) return;
    closeMenus("modelPickerButton");
    popup.hidden = false;
    $("modelPickerButton").setAttribute("aria-expanded", "true");
    $("modelPickerWrap").classList.add("is-open");
  }

  function closeModelPicker() {
    const popup = $("modelPickerPopup");
    if (!popup) return;
    popup.hidden = true;
    $("modelPickerButton").setAttribute("aria-expanded", "false");
    $("modelPickerWrap").classList.remove("is-open");
  }

  async function loadModelCatalog() {
    try {
      const response = await fetch(API + "/api/v1/models", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("MODEL_CATALOG_UNAVAILABLE");
      const data = await response.json();
      if (!data || !Array.isArray(data.models)) throw new Error("MODEL_CATALOG_INVALID");
      availableModels = data.models.filter((model) =>
        model && typeof model.id === "string" && typeof model.name === "string" &&
        typeof model.free === "boolean" && /^[A-Za-z0-9._:/-]{1,160}$/.test(model.id)
      );
      if (!availableModels.some((model) => model.id === "teslafield")) {
        availableModels.unshift({ id: "teslafield", name: "Teslafield B1", free: true, provider: "TeslafieldAI" });
      }
    } catch (error) {
      // Keep the local free model available when the catalogue service is sleeping.
    }
    renderModelSelector();
    renderModelPicker();
  }

  $("modelSelector").addEventListener("change", () => {
    const selected = $("modelSelector").value;
    if (!availableModels.some((model) => model.id === selected)) return;
    userPreferences.model = selected;
    try { localStorage.setItem("teslafield.preferences.v1", JSON.stringify(userPreferences)); } catch (error) {}
    renderModelPicker();
    const model = availableModels.find((item) => item.id === selected);
    if (model.provider === "OpenRouter") {
      toast(model.free ? "OpenRouter $0 model selected. Your messages go to OpenRouter; provider limits and account conditions apply." : "Paid OpenRouter model selected. Your messages go to OpenRouter and usage charges may apply.");
    } else {
      toast("Preferred model: " + model.name);
    }
  });

  $("modelPickerButton").addEventListener("click", () => {
    if ($("modelPickerPopup").hidden) openModelPicker();
    else closeModelPicker();
  });
  document.addEventListener("click", (event) => {
    if (!$("modelPickerWrap").contains(event.target)) closeModelPicker();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("modelPickerPopup").hidden) {
      closeModelPicker();
      $("modelPickerButton").focus();
    }
  });
  window.addEventListener("focus", () => {
    if (currentUser) syncCloudHistory();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentUser) syncCloudHistory();
  });
  $("newChat").onclick = newChat;
  $("connectEntryButton").onclick = openConnectPage;
  $("connectBackButton").onclick = () => closeConnectPage(false);
  $("gmailConnectAction").onclick = () => gmailAccessToken ? showGmailDetails() : beginGmailConnect();
  $("gmailDetailConnect").onclick = beginGmailConnect;
  $("gmailDisconnect").onclick = disconnectGmail;
  $("gmailDetailBack").onclick = () => { $("gmailDetailCard").hidden = true; $("connectAppList").hidden = false; };
  $("connectSearchInput").oninput = () => { const q = $("connectSearchInput").value.trim().toLowerCase(); const card = document.querySelector(".connect-app-card"); const match = !q || card.dataset.appSearch.includes(q); card.hidden = !match; $("connectNoResults").hidden = match; };
  $("mobileMenu").onclick = openSidebar;
  $("sidebarClose").onclick = closeSidebar;
  $("sidebarScrim").onclick = closeSidebar;
  $("desktopMenu").onclick = () => document.body.classList.remove("sidebar-collapsed");
  $("sidebarCollapse").onclick = () => document.body.classList.add("sidebar-collapsed");
  $("composer").onsubmit = (event) => { event.preventDefault(); if (generating) stopGeneration(); else sendMessage(); };
  $("micButton").onclick = () => { if (mediaRecorder && mediaRecorder.state !== "inactive") stopVoiceRecording(); else startVoiceRecording(); };
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
  $("exportHistory").onclick = exportConversationHistory;
  $("clearHistory").onclick = () => {
    const hasLegacyHistory = !!(localStorage.getItem("teslafield.conversations.v2") || localStorage.getItem("teslafield.conversations.v3"));
    if (!chats.length && !hasLegacyHistory) { toast("There are no saved conversations."); return; }
    if (window.confirm("Delete all conversations for this signed-in account and remove older unassigned device history?")) {
      chats.forEach((chat) => markConversationDeleted(chat.id));
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
  $("personalizeButton").onclick = openPersonalize;
  $("closePersonalize").onclick = closePersonalize;
  $("closePersonalizeSecondary").onclick = closePersonalize;
  $("savePersonalize").onclick = savePersonalize;
  $("personalizeModal").addEventListener("click", (event) => { if (event.target === $("personalizeModal")) closePersonalize(); });
  $("historySearch").oninput = renderHistory;
  $("historySearchClear").onclick = () => { $("historySearch").value = ""; renderHistory(); $("historySearch").focus(); };
  $("accountSignUp").onclick = accountEntry;
  $("accountLogIn").onclick = accountEntry;
  $("topSignUp").onclick = accountEntry;
  $("topLogIn").onclick = accountEntry;
  $("signupPromptSignUp").onclick = accountEntry;
  $("signupPromptLogIn").onclick = accountEntry;
  $("closeSignupPrompt").onclick = closeSignupPrompt;
  $("signupPromptModal").addEventListener("click", (event) => {
    if (event.target === $("signupPromptModal")) closeSignupPrompt();
  });
  $("cookieRejectAll").onclick = () => storeCookieChoices(false, false);
  $("cookieAcceptAll").onclick = () => storeCookieChoices(true, true);
  $("cookieSettingsOpen").onclick = openCookieSettings;
  $("privacyChoices").onclick = () => { closeMenus(); openCookieSettings(); };
  $("closeCookieSettings").onclick = () => {
    $("cookieSettingsBackdrop").hidden = true;
    if ($("signupPromptModal").hidden) document.body.classList.remove("modal-open");
  };
  $("cookieSettingsBackdrop").addEventListener("click", (event) => {
    if (event.target === $("cookieSettingsBackdrop")) {
      $("cookieSettingsBackdrop").hidden = true;
      if ($("signupPromptModal").hidden) document.body.classList.remove("modal-open");
    }
  });
  $("cookieSettingsReject").onclick = () => storeCookieChoices(false, false);
  $("cookieSettingsAccept").onclick = () => storeCookieChoices(true, true);
  $("cookieSaveChoices").onclick = () => storeCookieChoices($("cookieAnalytics").checked, $("cookieAdvertising").checked);
  $("accountSignOut").onclick = async () => {
    if (!authClient) return;
    try { await authClient.signOut(); closeMenus(); toast("Signed out. Your chats remain in this browser under your account profile."); }
    catch (error) { toast("Sign out failed. Please retry."); }
  };
  $("accountDelete").onclick = deleteAccountAndLocalData;
  $("accountButton").onclick = () => toggleMenu("accountMenu", "accountButton");
  $("attachmentButton").onclick = () => {
    if ($("attachmentButton").classList.contains("cancel-recording")) {
      cancelVoiceRecording();
      return;
    }
    closeMenus();
    $("fileInput").click();
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
    if (selectedFiles.length) toast("Files selected on this device. File upload and analysis are not connected yet.");
  };
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".tool-menu-wrap") && !event.target.closest(".account-wrap") && !event.target.closest(".history-more")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "k") { event.preventDefault(); newChat(); }
    if (event.key === "Escape") {
      if (!$("connectPage").hidden) { closeConnectPage(false); return; }
      if (!$("personalizeModal").hidden) { closePersonalize(); return; }
      closeMenus();
      closeSidebar();
      if (!$("signupPromptModal").hidden) closeSignupPrompt();
      if (!$("cookieSettingsBackdrop").hidden) {
        $("cookieSettingsBackdrop").hidden = true;
        if ($("signupPromptModal").hidden) document.body.classList.remove("modal-open");
      }
    }
  });


  // Rotate a large set of welcome ideas continuously on the signed-out start screen.
  const welcomeHour = new Date().getHours();
  const welcomeTimeGreeting = welcomeHour < 12 ? "Good morning" : welcomeHour < 17 ? "Good afternoon" : "Good evening";
  let returningVisitor = false;
  try {
    returningVisitor = Boolean(localStorage.getItem("teslafield.welcome.visit.v1"));
    localStorage.setItem("teslafield.welcome.visit.v1", String(Date.now()));
  } catch (error) {}
  const dynamicWelcomeLine = returningVisitor
    ? welcomeTimeGreeting + ". Welcome back. What shall we explore today?"
    : welcomeTimeGreeting + ". A fresh space for your next idea starts here.";
  const exploreIdeas = [
    dynamicWelcomeLine,
    "What would you like to explore?","Turn a big idea into a real plan.","What can we create together today?","Discover something you have never learned.","Make your next great idea happen.","What are you curious about right now?","Build something remarkable from scratch.","Find a smarter way to solve a problem.","Imagine it. Explore it. Create it.","What would you love to understand?",
    "Learn a new skill, one step at a time.","Let's make your ideas clearer.","What challenge can we solve today?","Explore the future of technology.","Create a plan for your next project.","Find inspiration for something original.","Make complex topics feel simple.","What could you invent today?","Let's turn questions into answers.","Discover a new perspective.",
    "Write something worth sharing.","Build a better workflow.","What do you want to bring to life?","Explore science, space and discovery.","Find the words for your big idea.","Let's brainstorm something fresh.","Make your next decision with clarity.","What would you like to design?","Understand the world in a new way.","Start with a question. Go anywhere.",
    "Create a story people remember.","Explore a new business idea.","Let's make learning exciting.","What can you improve today?","Plan a journey into the unknown.","Turn creativity into progress.","Find a solution that fits.","What would you like to master?","Explore code and build something useful.","Make a difficult task feel easy.",
    "Let's shape your next breakthrough.","What is one thing you want to change?","Discover ideas beyond the ordinary.","Create something uniquely yours.","Explore a topic that fascinates you.","Let's map out your next move.","What can you make more efficient?","Find a fresh angle on an old problem.","Learn by asking better questions.","Bring a creative vision to life.",
    "What would you like to research?","Let's make your goals actionable.","Explore design, art and imagination.","Build confidence with clear explanations.","What new opportunity can you find?","Create a smarter daily routine.","Let's solve it together.","Discover how things really work.","What idea deserves your attention?","Make progress on something important.",
    "Explore the power of AI.","Write, refine and communicate clearly.","What would you like to launch?","Let's find your next inspiration.","Turn information into understanding.","Create a step-by-step roadmap.","What can you discover in five minutes?","Explore a world of possibilities.","Let's make your vision practical.","Find a better way forward.",
    "What would you like to experiment with?","Design your next big concept.","Let's unlock a new perspective.","Make your next presentation shine.","Explore history and untold stories.","What skill should we practise today?","Build a project from the first idea.","Let's make something meaningful.","Find clarity in a complicated topic.","What would you like to transform?",
    "Explore new ways to think.","Create a clear plan for tomorrow.","Let's make your work simpler.","What question have you always had?","Discover tools for your next project.","Turn curiosity into knowledge.","What could your next chapter look like?","Let's develop an original concept.","Explore possibilities, then take action.","Make your ideas easier to explain.",
    "What would you like to achieve this week?","Let's create something useful.","Find the insight hidden in the details.","Explore a new creative direction.","What problem should we tackle first?","Make your next idea unforgettable.","Let's learn something surprising.","Build, write, plan and discover.","Where will your curiosity take you?","Your next great idea starts here."
  ];
  const exploreHeading = welcome.querySelector("h1");
  let exploreIndex = 0;
  if (exploreHeading) {
    exploreHeading.textContent = dynamicWelcomeLine;
    window.setInterval(() => {
      if (!document.body.classList.contains("guest-mode")) return;
      exploreHeading.classList.remove("glass-form-in");
      exploreHeading.classList.add("glass-shatter-out");
      window.setTimeout(() => {
        exploreIndex = (exploreIndex + 1) % exploreIdeas.length;
        exploreHeading.textContent = exploreIdeas[exploreIndex];
        exploreHeading.classList.remove("glass-shatter-out");
        exploreHeading.classList.add("glass-form-in");
        window.setTimeout(() => exploreHeading.classList.remove("glass-form-in"), 520);
      }, 430);
    }, 3400);
  }

  window.addEventListener("popstate", () => { if (location.pathname !== "/connect" && !$("connectPage").hidden) closeConnectPage(true); else if (location.pathname === "/connect" && $("connectPage").hidden) openConnectPage(); });
  if (location.pathname === "/connect") openConnectPage();
  if (location.pathname.startsWith("/share/")) {
    openSharedMessagePage();
    return;
  }
  setGuestLayout(true);
  initializeFirebaseAuth();
  initializeCookieChoices();
  initializePwaInstall();
  try {
    const theme = localStorage.getItem("teslafield.appearance.v2") || "dark";
    applyTheme(theme);
  } catch (error) { applyTheme("dark"); }
  renderHistory();
  readPersonalization();
  loadModelCatalog();
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