"use strict";

(() => {
  const API = "https://teslafield-api.onrender.com";
  const requestId = new URLSearchParams(window.location.search).get("request_id") || "";
  const loginPanel = document.getElementById("loginPanel");
  const consentPanel = document.getElementById("consentPanel");
  const signInButton = document.getElementById("signInButton");
  const approveButton = document.getElementById("approveButton");
  const denyButton = document.getElementById("denyButton");
  const switchAccountButton = document.getElementById("switchAccountButton");
  const loginNotice = document.getElementById("loginNotice");
  const consentNotice = document.getElementById("consentNotice");
  const accountEmail = document.getElementById("accountEmail");
  let auth = null;
  let activeUser = null;
  let busy = false;

  function message(element, value) {
    if (element) element.textContent = String(value || "");
  }

  function setBusy(value) {
    busy = value;
    [signInButton, approveButton, denyButton, switchAccountButton].forEach((button) => {
      if (button) button.disabled = value;
    });
  }

  function showConsent(user) {
    activeUser = user;
    accountEmail.textContent = user && user.email ? user.email : "Signed in to TESLAFIELD";
    loginPanel.classList.add("hidden");
    consentPanel.classList.remove("hidden");
    message(loginNotice, "");
  }

  function showLogin() {
    activeUser = null;
    consentPanel.classList.add("hidden");
    loginPanel.classList.remove("hidden");
  }

  async function signIn() {
    if (busy || !auth) return;
    setBusy(true);
    message(loginNotice, "Opening secure Google sign-in…");
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      const result = await auth.signInWithPopup(provider);
      if (!result || !result.user) throw new Error("No TESLAFIELD account was returned.");
      showConsent(result.user);
    } catch (error) {
      const code = error && error.code;
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/web-storage-unsupported"].includes(code)) {
        try {
          await auth.signInWithRedirect(provider);
          return;
        } catch (redirectError) {
          message(loginNotice, "Google sign-in could not open. Retry in Chrome or check Firebase Authorized domains.");
        }
      } else if (code === "auth/unauthorized-domain") {
        message(loginNotice, "Firebase blocked this sign-in domain. Add teslafieldai.web.app to Firebase Authentication → Settings → Authorized domains.");
      } else if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        message(loginNotice, "Sign-in was cancelled.");
      } else {
        message(loginNotice, "Could not sign in to TESLAFIELD. Please retry.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function postJson(path, body) {
    const response = await fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      cache: "no-store",
      credentials: "omit",
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.message || "The TESLAFIELD service could not complete this request.");
    return data;
  }

  async function approve() {
    if (busy || !activeUser || !requestId) return;
    setBusy(true);
    message(consentNotice, "Verifying your TESLAFIELD account…");
    try {
      const idToken = await activeUser.getIdToken();
      const result = await postJson("/oauth/consent", { request_id: requestId, id_token: idToken });
      if (!result || !result.redirect) throw new Error("The authorization server returned an invalid response.");
      try { await auth.signOut(); } catch (error) {}
      window.location.assign(result.redirect);
    } catch (error) {
      message(consentNotice, error.message || "Authorization failed. Please retry.");
      setBusy(false);
    }
  }

  async function deny() {
    if (busy || !requestId) return;
    setBusy(true);
    message(consentNotice, "Cancelling connection…");
    try {
      const result = await postJson("/oauth/deny", { request_id: requestId });
      if (!result || !result.redirect) throw new Error("The authorization server returned an invalid response.");
      try { if (auth) await auth.signOut(); } catch (error) {}
      window.location.assign(result.redirect);
    } catch (error) {
      message(consentNotice, error.message || "Could not cancel this connection.");
      setBusy(false);
    }
  }

  async function switchAccount() {
    if (busy || !auth) return;
    setBusy(true);
    try { await auth.signOut(); } catch (error) {}
    showLogin();
    message(loginNotice, "Choose the TESLAFIELD account you want to connect.");
    setBusy(false);
  }

  async function initialize() {
    if (!requestId || requestId.length > 128) {
      message(loginNotice, "This connection link is missing or invalid. Return to ChatGPT and try connecting again.");
      signInButton.disabled = true;
      return;
    }
    if (!window.firebase || !Array.isArray(firebase.apps) || !firebase.apps.length) {
      message(loginNotice, "TESLAFIELD sign-in could not initialize. Reload this page or try again later.");
      signInButton.disabled = true;
      return;
    }
    try {
      auth = firebase.auth();
      await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
      const redirectResult = await auth.getRedirectResult();
      if (redirectResult && redirectResult.user) {
        showConsent(redirectResult.user);
        return;
      }
      auth.onAuthStateChanged((user) => {
        if (user) showConsent(user);
      });
    } catch (error) {
      message(loginNotice, "TESLAFIELD sign-in is temporarily unavailable. Please reload and retry.");
      signInButton.disabled = true;
    }
  }

  signInButton.addEventListener("click", signIn);
  approveButton.addEventListener("click", approve);
  denyButton.addEventListener("click", deny);
  switchAccountButton.addEventListener("click", switchAccount);
  initialize();
})();