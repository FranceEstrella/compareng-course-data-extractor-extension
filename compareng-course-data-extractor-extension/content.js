console.log("Content script loaded! [build 1.1.0-oses-login-m1]");

const currentPath = window.location.pathname;
const isOfferingsPage = currentPath.startsWith("/course/offerings");
const isRegistrationPage = currentPath.startsWith("/course/registration");
const isTopWindow = window.top === window;
const isOSESHost = window.location.hostname === "oses.feutech.edu.ph";

const blockAutomationState = {
  inFlight: false,
  clickedBlockButton: false,
  lastRequestedBlock: "",
  selectedBlock: false,
  registerClicked: false
};

const confirmationAutomationState = {
  inFlight: false,
  clicked: false,
  lastRequestedBlock: ""
};

const loginAutomationState = {
  inFlight: false,
  lastClickedAt: 0
};

function hasUsableExtensionContext() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function safeSendRuntimeMessage(payload, callback) {
  if (!hasUsableExtensionContext()) return false;
  try {
    if (typeof callback === "function") {
      chrome.runtime.sendMessage(payload, callback);
    } else {
      chrome.runtime.sendMessage(payload);
    }
    return true;
  } catch {
    return false;
  }
}

function safeStorageSet(values) {
  if (!hasUsableExtensionContext()) return false;
  try {
    chrome.storage.local.set(values);
    return true;
  } catch {
    return false;
  }
}

function safeStorageRemove(keys) {
  if (!hasUsableExtensionContext()) return false;
  try {
    chrome.storage.local.remove(keys);
    return true;
  } catch {
    return false;
  }
}

function readStorage(keys) {
  return new Promise((resolve) => {
    if (!hasUsableExtensionContext()) {
      resolve({});
      return;
    }

    try {
      chrome.storage.local.get(keys, (result) => {
        resolve(result || {});
      });
    } catch {
      resolve({});
    }
  });
}

function postOSESStatus(stage, message, details = {}) {
  safeSendRuntimeMessage({
    action: "osesAutomationStatus",
    data: {
      stage,
      message,
      page: window.location.href,
      updatedAt: Date.now(),
      ...details
    }
  });
}

async function runOSESAutomation() {
  if (!isTopWindow || !isRegistrationPage) return;

  const monitor = window.OSESIFrameMonitor;

  if (!monitor) {
    postOSESStatus("failed", "OSES helper modules unavailable.", {
      reason: "helpers-missing"
    });
    return;
  }

  postOSESStatus("detecting_iframe", "Looking for OSES frame...");
  const frame = await monitor.waitForFrame(15000);

  if (!frame) {
    postOSESStatus("failed", "OSES iframe was not found on the page.", {
      reason: "iframe-not-found"
    });
    return;
  }

  postOSESStatus("waiting_oses", "OSES frame found. Waiting for content...");
  const readyResult = await monitor.waitForFrameReady(frame, 15000);

  if (!readyResult.ready) {
    postOSESStatus("failed", "OSES iframe did not become ready in time.", {
      reason: readyResult.reason
    });
    return;
  }

  postOSESStatus("waiting_oses", "Waiting for OSES iframe script to report login status...");
}

function detectFrameAuthState() {
  const authState = window.OSESAuthState;
  if (!authState || !document || !document.querySelector) return null;

  const referrer = document.referrer || "";
  const hostname = window.location.hostname || "";
  const pathname = window.location.pathname || "";
  const href = window.location.href || "";
  const onOSESHost = hostname === "oses.feutech.edu.ph";
  const fromSolarOrigin = referrer.includes("solar.feutech.edu.ph");
  const fromRegistrationPage = referrer.includes("/course/registration");
  const pathLooksLikeOSES = /\/oses\b/i.test(pathname) || /\/oses\b/i.test(href);
  const likelyRegistrationChildFrame = onOSESHost || fromRegistrationPage || fromSolarOrigin || pathLooksLikeOSES;
  if (!likelyRegistrationChildFrame) return null;

  const topRightExists = Boolean(document.querySelector("div.topright, .topright, #topright"));
  const loginFormExists = Boolean(document.querySelector("input[type='password'], form button[type='submit'], form"));
  const enrollmentMarkerExists = Boolean(document.querySelector("#block_enrolled, iframe#frm-block, #course_enrolled"));
  if (!topRightExists && !loginFormExists && !enrollmentMarkerExists) return null;

  return authState.getAuthState(document);
}

function postFrameStatusIfRelevant() {
  if (isTopWindow) return;

  const state = detectFrameAuthState();
  if (!state) return;

  const enrollmentUiReady = Boolean(document.querySelector("#block_enrolled, iframe#frm-block, #course_enrolled"));

  if (state.state === "authenticated") {
    postOSESStatus("logged_in_verified", "OSES session verified via student number in topright.", {
      reason: state.reason,
      studentNumber: state.studentNumber || "",
      source: "iframe"
    });
    runRegularBlockEnrollment();
    return;
  }

  if (state.state === "unauthenticated") {
    postOSESStatus("failed", "OSES login form is visible. Existing portal session is not authenticated for OSES.", {
      reason: state.reason,
      source: "iframe"
    });
    return;
  }

  if (state.state === "unknown" && enrollmentUiReady) {
    postOSESStatus("logged_in_verified", "OSES enrollment page is ready. Proceeding with block automation.", {
      reason: "enrollment-ui-detected",
      studentNumber: state.studentNumber || "",
      source: "iframe"
    });
    runRegularBlockEnrollment();
    return;
  }

  postOSESStatus("waiting_oses", "OSES is still loading account details. Waiting for student number verification...", {
    reason: state.reason || "unknown",
    source: "iframe"
  });
}

function isLikelyOSESLoginContext() {
  if (isTopWindow) return false;

  const referrer = document.referrer || "";
  const fromRegistrationPage = referrer.includes("/course/registration");
  const fromSolarOrigin = referrer.includes("solar.feutech.edu.ph");
  const hasLoginDom = Boolean(
    document.querySelector(
      "input[type='password'], input[name*='password' i], input[id*='password' i], button.x-btn-text.login, button[id^='ext-gen'].x-btn-text"
    )
  );

  return isOSESHost || fromRegistrationPage || fromSolarOrigin || hasLoginDom;
}

function findOSESLoginButton(root) {
  if (!root || !root.querySelector) return null;

  const exact = root.querySelector(
    "button#ext-gen15.x-btn-text.login, button[type='button'].x-btn-text.login, button[id^='ext-gen'].x-btn-text.login"
  );
  if (exact && isElementVisible(exact)) return exact;

  const candidates = Array.from(root.querySelectorAll("button:not([disabled]), input[type='button']:not([disabled]), input[type='submit']:not([disabled]), .x-btn-text"));
  return candidates.find((el) => {
    if (!isElementVisible(el)) return false;
    const text = String(el.textContent || el.innerText || el.value || el.getAttribute("title") || "").trim();
    if (!/^login$/i.test(text)) return false;
    const className = String(el.className || "").toLowerCase();
    return className.includes("x-btn-text") || className.includes("login");
  }) || null;
}

function runAutoLoginClick() {
  if (!isLikelyOSESLoginContext()) return;
  if (loginAutomationState.inFlight) return;

  loginAutomationState.inFlight = true;
  try {
    const enrollmentUiReady = Boolean(document.querySelector("#block_enrolled, iframe#frm-block, #course_enrolled"));
    if (enrollmentUiReady) return;

    const auth = detectFrameAuthState();
    if (auth?.state === "authenticated") return;

    const button = findOSESLoginButton(document);
    if (!button) return;

    const now = Date.now();
    if ((now - loginAutomationState.lastClickedAt) < 5000) return;

    clickElementBestEffort(button);
    loginAutomationState.lastClickedAt = now;

    postOSESStatus("login_button_clicked", "Detected OSES login button and clicked Login.", {
      reason: "auto-login-button-click",
      source: "iframe"
    });
  } finally {
    loginAutomationState.inFlight = false;
  }
}

function isInsideOSESMainEnrollmentPage() {
  if (isTopWindow) return false;
  if (currentPath.includes("/oses/block.php")) return false;
  return Boolean(document.querySelector("#block_enrolled, iframe#frm-block, #course_enrolled"));
}

function listAvailableBlocks(blockDoc) {
  return Array.from(blockDoc.querySelectorAll("input[type='radio'][name='radio']"))
    .map((radio) => String(radio.value || "").trim().toUpperCase())
    .filter(Boolean);
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findRegisterBlockButton(root) {
  if (!root || !root.querySelector) return null;

  const directMatch = root.querySelector(
    "#register_block, #btn_register_block, button[id*='register'][id*='block'], input[type='button'][value*='Register Block' i], input[type='submit'][value*='Register Block' i], button[title*='Register Block' i]"
  );
  if (directMatch) return directMatch;

  const clickable = Array.from(root.querySelectorAll("button, input[type='button'], input[type='submit'], a"));
  return clickable.find((el) => {
    const text = String(el.textContent || el.value || el.getAttribute("title") || "").trim();
    return /register\s*block/i.test(text);
  }) || null;
}

function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isConfirmationAutomationContext() {
  if (isTopWindow && isRegistrationPage) return true;
  if (isOSESHost) return true;
  if (!isTopWindow && document?.querySelector) {
    return Boolean(document.querySelector("#block_enrolled, iframe#frm-block, .x-window, .x-message-box, .swal2-container"));
  }
  return false;
}

function clickElementBestEffort(el) {
  if (!el) return;
  try {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  } catch {
    // Fallback to direct click if synthetic events fail.
  }

  try {
    el.click();
  } catch {
    // Ignore click failures so automation can retry.
  }
}

function findConfirmationOkButton(root) {
  if (!root || !root.querySelector) return null;

  const swalConfirm = root.querySelector(".swal2-container .swal2-confirm:not([disabled])");
  if (swalConfirm && isElementVisible(swalConfirm)) return swalConfirm;

  const isInsideDialogLikeContainer = (el) => {
    if (!el || !el.closest) return false;
    return Boolean(
      el.closest(
        ".swal2-container, .x-window, .x-window-dlg, .x-message-box, [role='dialog'], .modal, .modal-dialog"
      )
    );
  };

  const candidates = Array.from(
    root.querySelectorAll("button:not([disabled]), input[type='button']:not([disabled]), input[type='submit']:not([disabled]), a, .x-btn-text")
  );

  return candidates.find((el) => {
    if (!isElementVisible(el)) return false;
    if (!isInsideDialogLikeContainer(el)) return false;
    const text = String(el.textContent || el.innerText || el.value || el.getAttribute("title") || "").trim();
    return /^ok$/i.test(text) || /^okay$/i.test(text);
  }) || null;
}

async function clickConfirmationOkIfVisible(desiredBlock) {
  if (!isConfirmationAutomationContext()) return false;

  // Confirmation dialog can appear several seconds after the register click.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const okButton = findConfirmationOkButton(document);
    if (okButton) {
      const target = okButton.matches(".x-btn-text") && okButton.tagName !== "BUTTON"
        ? (okButton.closest("button, a, [role='button']") || okButton)
        : okButton;
      clickElementBestEffort(target);
      postOSESStatus("block_confirmation_accepted", `Clicked OK on block confirmation for ${desiredBlock}.`, {
        reason: "block-confirmation-ok-clicked",
        blockSection: desiredBlock,
        source: "block-automation"
      });
      return true;
    }
    await waitMs(250);
  }

  return false;
}

async function runBlockConfirmationAutomation() {
  if (!isConfirmationAutomationContext()) return;
  if (confirmationAutomationState.inFlight) return;

  confirmationAutomationState.inFlight = true;
  try {
    const store = await readStorage(["osesAutomationStatus", "osesBlockEnrollmentRequest", "osesPendingConfirmation"]);
    const status = store.osesAutomationStatus;
    const request = store.osesBlockEnrollmentRequest;
    const pendingConfirmation = store.osesPendingConfirmation;
    const desiredBlock = String(request?.blockSection || "").trim().toUpperCase();
    if (!desiredBlock) return;

    if (confirmationAutomationState.lastRequestedBlock !== desiredBlock) {
      confirmationAutomationState.clicked = false;
      confirmationAutomationState.lastRequestedBlock = desiredBlock;
    }

    if (confirmationAutomationState.clicked) return;

  const pendingBlock = String(pendingConfirmation?.blockSection || "").trim().toUpperCase();
  const pendingAt = Number(pendingConfirmation?.requestedAt || 0);
  const pendingMatches = pendingBlock === desiredBlock;
  const pendingNotExpired = pendingAt > 0 && (Date.now() - pendingAt) <= 120000;
  const statusTriggered = status?.stage === "block_registration_submitted";

  if (!statusTriggered && !(pendingMatches && pendingNotExpired)) return;

    postOSESStatus("confirming_block", `Waiting for confirmation dialog for ${desiredBlock}...`, {
      reason: "block-confirmation-awaiting",
      blockSection: desiredBlock,
      source: "block-automation"
    });

    const okClicked = await clickConfirmationOkIfVisible(desiredBlock);
    if (!okClicked) {
      postOSESStatus("failed", `Register Block was clicked for ${desiredBlock}, but confirmation OK button was not found.`, {
        reason: "block-confirmation-ok-not-found",
        blockSection: desiredBlock,
        source: "block-automation"
      });
      return;
    }

    confirmationAutomationState.clicked = true;
    safeStorageRemove(["osesPendingConfirmation"]);
  } finally {
    confirmationAutomationState.inFlight = false;
  }
}

function installConfirmationObserver() {
  if (!isConfirmationAutomationContext() || !document.documentElement) return;

  const observer = new MutationObserver(() => {
    runBlockConfirmationAutomation();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true
  });

  setTimeout(() => observer.disconnect(), 90000);

  if (hasUsableExtensionContext()) {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        if (changes.osesAutomationStatus || changes.osesBlockEnrollmentRequest) {
          runBlockConfirmationAutomation();
        }
      });
    } catch {
      // Extension context can be invalidated when extension reloads.
    }
  }
}

async function clickRegisterBlockButton(blockDoc, desiredBlock) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const inFrame = findRegisterBlockButton(blockDoc);
    const inParent = findRegisterBlockButton(document);
    const target = inFrame || inParent;

    if (target) {
      target.click();
      safeStorageSet({
        osesPendingConfirmation: {
          blockSection: desiredBlock,
          requestedAt: Date.now()
        }
      });
      postOSESStatus("block_registration_submitted", `Clicked Register Block for ${desiredBlock}.`, {
        reason: "register-block-clicked",
        blockSection: desiredBlock,
        source: "block-automation"
      });
      return true;
    }

    await waitMs(150);
  }

  return false;
}

async function runRegularBlockEnrollment() {
  if (!isInsideOSESMainEnrollmentPage()) return;
  if (blockAutomationState.inFlight) return;

  blockAutomationState.inFlight = true;
  try {
    const store = await readStorage(["osesBlockEnrollmentRequest"]);
    const request = store.osesBlockEnrollmentRequest;
    if (!request || request.isRegular !== true) return;

    const desiredBlock = String(request.blockSection || "").trim().toUpperCase();
    if (!desiredBlock) {
      postOSESStatus("failed", "Regular student request received, but block section is missing.", {
        reason: "missing-block-section",
        source: "block-automation"
      });
      return;
    }

    if (blockAutomationState.lastRequestedBlock !== desiredBlock) {
      blockAutomationState.clickedBlockButton = false;
      blockAutomationState.selectedBlock = false;
      blockAutomationState.registerClicked = false;
      blockAutomationState.lastRequestedBlock = desiredBlock;
    }

    const modalFrame = document.querySelector("iframe#frm-block");
    if (!modalFrame && !blockAutomationState.clickedBlockButton) {
      const blockButton = document.querySelector("#block_enrolled button, #block_enrolled");
      if (!blockButton) {
        postOSESStatus("failed", "Block Section button was not found on OSES page.", {
          reason: "block-button-not-found",
          source: "block-automation"
        });
        return;
      }

      blockButton.click();
      blockAutomationState.clickedBlockButton = true;
      postOSESStatus("opening_block_window", `Opening block section window for ${desiredBlock}...`, {
        blockSection: desiredBlock,
        source: "block-automation"
      });
      return;
    }

    if (!modalFrame) return;

    let blockDoc;
    try {
      blockDoc = modalFrame.contentDocument;
      if (!blockDoc) throw new Error("frm-block document is null");
    } catch (error) {
      postOSESStatus("failed", "Cannot access block list frame.", {
        reason: "block-frame-access-failed",
        error: error?.message || String(error),
        source: "block-automation"
      });
      return;
    }

    const radios = Array.from(blockDoc.querySelectorAll("input[type='radio'][name='radio']"));
    if (!radios.length) return;

    const targetRadio = radios.find((radio) => String(radio.value || "").trim().toUpperCase() === desiredBlock);
    if (!targetRadio) {
      postOSESStatus("failed", `Block section ${desiredBlock} is not available in OSES list.`, {
        reason: "target-block-not-found",
        blockSection: desiredBlock,
        availableBlocks: listAvailableBlocks(blockDoc),
        source: "block-automation"
      });
      return;
    }

    targetRadio.click();
    const hidden = blockDoc.querySelector("#tempBlock");
    const selected = String(hidden?.value || targetRadio.value || "").trim().toUpperCase();
    if (selected !== desiredBlock) {
      postOSESStatus("failed", `Could not apply block section ${desiredBlock} in the selector window.`, {
        reason: "block-selection-not-applied",
        blockSection: desiredBlock,
        source: "block-automation"
      });
      return;
    }

    blockAutomationState.selectedBlock = true;
    safeStorageSet({
      osesLastBlockSelection: {
        blockSection: desiredBlock,
        updatedAt: Date.now()
      }
    });

    postOSESStatus("block_selected", `Block section ${desiredBlock} was selected successfully.`, {
      reason: "block-selected",
      blockSection: desiredBlock,
      source: "block-automation"
    });

    if (!blockAutomationState.registerClicked) {
      postOSESStatus("registering_block", `Submitting Register Block for ${desiredBlock}...`, {
        reason: "register-block-pending",
        blockSection: desiredBlock,
        source: "block-automation"
      });

      const registerClicked = await clickRegisterBlockButton(blockDoc, desiredBlock);
      if (!registerClicked) {
        postOSESStatus("failed", `Block section ${desiredBlock} was selected, but Register Block button was not found.`, {
          reason: "register-block-button-not-found",
          blockSection: desiredBlock,
          source: "block-automation"
        });
        return;
      }

      blockAutomationState.registerClicked = true;
    }
  } finally {
    blockAutomationState.inFlight = false;
  }
}

function installFrameObserver() {
  if (isTopWindow || !document.documentElement) return;

  const observer = new MutationObserver(() => {
    runAutoLoginClick();
    postFrameStatusIfRelevant();
    runRegularBlockEnrollment();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true
  });

  setTimeout(() => observer.disconnect(), 300000);

  // Some OSES flows populate topright/login state late; periodic checks keep popup status in sync.
  let checks = 0;
  const intervalId = setInterval(() => {
    runAutoLoginClick();
    postFrameStatusIfRelevant();
    runRegularBlockEnrollment();
    checks += 1;
    if (checks >= 60) {
      clearInterval(intervalId);
    }
  }, 5000);
}

if (hasUsableExtensionContext()) {
  try {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "startRegularBlockEnrollment") {
        runRegularBlockEnrollment()
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
        return true;
      }

      if (request.action !== "startOSESAutomation") return false;

      runOSESAutomation()
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          postOSESStatus("failed", "Unexpected error while checking OSES login state.", {
            reason: "runtime-error",
            error: error?.message || String(error)
          });
          sendResponse({ success: false, error: error?.message || String(error) });
        });

      return true;
    });
  } catch {
    // Extension context can be invalidated when extension reloads.
  }
}

function getSelectContext(selectEl) {
  if (!selectEl) return "";

  const id = (selectEl.id || "").toLowerCase();
  const name = (selectEl.getAttribute("name") || "").toLowerCase();
  const ariaLabel = (selectEl.getAttribute("aria-label") || "").toLowerCase();
  const title = (selectEl.getAttribute("title") || "").toLowerCase();
  const className = (selectEl.className || "").toLowerCase();

  let labelText = "";
  if (selectEl.id) {
    const linkedLabel = document.querySelector(`label[for="${selectEl.id}"]`);
    labelText = linkedLabel?.textContent?.trim().toLowerCase() || "";
  }

  return `${id} ${name} ${ariaLabel} ${title} ${className} ${labelText}`.trim();
}

function getSelectedOptionText(selectEl) {
  if (!selectEl) return "";
  const selected = selectEl.options?.[selectEl.selectedIndex];
  const selectedText = selected?.textContent?.trim();
  const selectedValue = selectEl.value?.trim();
  return selectedText || selectedValue || "";
}

function normalizeSchoolYear(value) {
  if (!value) return "";
  const trimmed = value.trim();

  // Portal can emit compact format like 20252026.
  const compactMatch = trimmed.match(/^(20\d{2})(20\d{2})$/);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}`;
  }

  const match = trimmed.match(/(20\d{2})\s*[-/]\s*(20\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return trimmed;
}

function normalizeTerm(value) {
  if (!value) return "";
  const raw = value.trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, " ");

  if (raw === "1") return "Term 1";
  if (raw === "2") return "Term 2";
  if (raw === "3") return "Term 3";

  if (/\b(term\s*1|1st\s*term|first\s*term|1st\s*semester|first\s*semester)\b/i.test(normalized)) {
    return "Term 1";
  }

  if (/\b(term\s*2|2nd\s*term|second\s*term|2nd\s*semester|second\s*semester)\b/i.test(normalized)) {
    return "Term 2";
  }

  if (/\b(term\s*3|3rd\s*term|third\s*term|summer\s*term|summer)\b/i.test(normalized)) {
    return "Term 3";
  }

  return raw;
}

function findRegexInTextNodes(regex) {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const text = node.textContent?.trim() || "";
    if (text) {
      const match = text.match(regex);
      if (match && match[0]) {
        return match[0].trim();
      }
    }
    node = walker.nextNode();
  }

  return "";
}

function findInputLikeValue(keywordRegex) {
  const candidates = Array.from(document.querySelectorAll("input, [role='combobox'], [aria-haspopup='listbox']"));
  for (const candidate of candidates) {
    const id = (candidate.id || "").toLowerCase();
    const name = (candidate.getAttribute("name") || "").toLowerCase();
    const ariaLabel = (candidate.getAttribute("aria-label") || "").toLowerCase();
    const className = (candidate.className || "").toLowerCase();
    const title = (candidate.getAttribute("title") || "").toLowerCase();
    const context = `${id} ${name} ${ariaLabel} ${className} ${title}`;

    if (!keywordRegex.test(context)) continue;

    const value = candidate.value?.trim() || candidate.textContent?.trim() || candidate.getAttribute("value")?.trim() || "";
    if (value) return value;
  }
  return "";
}

function findTermValue() {
  const exactTermSelect = document.querySelector("#term");
  if (exactTermSelect) {
    const exactValue = getSelectedOptionText(exactTermSelect);
    const normalizedExactValue = normalizeTerm(exactValue);
    if (normalizedExactValue) return normalizedExactValue;
  }

  const selects = Array.from(document.querySelectorAll("select"));
  const termKeywords = ["term", "semester"];

  for (const selectEl of selects) {
    const context = getSelectContext(selectEl);
    const matchesTermSelect = termKeywords.some((keyword) => context.includes(keyword));
    if (!matchesTermSelect) continue;

    const value = getSelectedOptionText(selectEl);
    if (value) return normalizeTerm(value);
  }

  const inputLikeValue = findInputLikeValue(/term|semester/i);
  if (inputLikeValue) return normalizeTerm(inputLikeValue);

  const textFallback = findRegexInTextNodes(/(term\s*[123]|[123](st|nd|rd)\s*term|first\s*term|second\s*term|third\s*term|summer)/i);
  if (textFallback) return normalizeTerm(textFallback);

  return "";
}

function findSchoolYearValue() {
  const exactSchoolYearSelect = document.querySelector("#school_year");
  if (exactSchoolYearSelect) {
    const exactValue = getSelectedOptionText(exactSchoolYearSelect);
    const normalizedExactValue = normalizeSchoolYear(exactValue);
    if (normalizedExactValue) return normalizedExactValue;
  }

  const selects = Array.from(document.querySelectorAll("select"));

  for (const selectEl of selects) {
    const context = getSelectContext(selectEl);
    const matchesSchoolYearSelect =
      context.includes("school year") ||
      context.includes("academic year") ||
      context.includes("sy");

    if (!matchesSchoolYearSelect) continue;

    const value = getSelectedOptionText(selectEl);
    if (value) return normalizeSchoolYear(value);
  }

  // Fallback: pick a selected option that looks like YYYY-YYYY.
  for (const selectEl of selects) {
    const value = getSelectedOptionText(selectEl);
    if (/^\d{4}\s*-\s*\d{4}$/.test(value)) {
      return normalizeSchoolYear(value);
    }
  }

  const inputLikeValue = findInputLikeValue(/school\s*year|academic\s*year|\bsy\b/i);
  if (inputLikeValue) return normalizeSchoolYear(inputLikeValue);

  const textFallback = findRegexInTextNodes(/\b20\d{2}\s*[-/]\s*20\d{2}\b/);
  if (textFallback) return normalizeSchoolYear(textFallback);

  return "";
}

function extractCourseData() {
  const term = findTermValue();
  const schoolYear = findSchoolYearValue();

  if (!term || !schoolYear) {
    console.warn(`Could not fully detect term/school year from dropdowns. term="${term}", schoolYear="${schoolYear}"`);
  }

  const courseRows = document.querySelectorAll('#courseOfferingsTable tr'); // Select all rows in the table
  const totalRows = courseRows.length;

  console.log(`Starting to read ${totalRows} course rows...`);

  const courses = [];

  for (let i = 1; i < totalRows; i++) { // Start from the second row to skip the header
    const row = courseRows[i];
    const cells = row.querySelectorAll('td');

    console.log(`Row ${i + 1} has ${cells.length} cells.`); // Log the number of cells in each row

    if (cells.length >= 7) { // Check for a minimum of required columns
      const courseCode = cells[0]?.textContent?.trim();
      const section = cells[1]?.textContent?.trim();
      const classSize = cells[2]?.textContent?.trim();
      const remainingSlots = cells[3]?.textContent?.trim();
      const meetingDays = cells[4]?.textContent?.trim();
      const meetingTime = cells[5]?.textContent?.trim();
      const room = cells[6]?.textContent?.trim();
      const hasSlots = !row.classList.contains('out-of-stock') && parseInt(remainingSlots) > 0;

      if (courseCode && section) {
        courses.push({
          courseCode: courseCode,
          section: section,
          classSize: classSize,
          remainingSlots: remainingSlots,
          meetingDays: meetingDays,
          meetingTime: meetingTime,
          room: room,
          hasSlots: hasSlots,
          term: term,
          schoolYear: schoolYear
        });
      }
    } else {
      console.log(`Skipping row ${i + 1} due to insufficient columns (${cells.length}).`);
    }
  }

  console.log(`Finished reading ${totalRows} rows. Extracted ${courses.length} courses.`);
  return courses;
}

if (isOfferingsPage) {
  const extractedCourses = extractCourseData();
  console.log("Extracted Courses:", extractedCourses);
  safeSendRuntimeMessage({ action: "courseDataExtracted", data: extractedCourses });
}

if (isRegistrationPage) {
  runOSESAutomation();
  runBlockConfirmationAutomation();
  installConfirmationObserver();
}

if (!isTopWindow) {
  runAutoLoginClick();
  postFrameStatusIfRelevant();
  runRegularBlockEnrollment();
  runBlockConfirmationAutomation();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runAutoLoginClick, { once: true });
    document.addEventListener("DOMContentLoaded", postFrameStatusIfRelevant, { once: true });
    document.addEventListener("DOMContentLoaded", runRegularBlockEnrollment, { once: true });
    document.addEventListener("DOMContentLoaded", runBlockConfirmationAutomation, { once: true });
  }
  installFrameObserver();
  installConfirmationObserver();
}