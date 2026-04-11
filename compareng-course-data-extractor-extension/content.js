console.log("Content script loaded! [build 1.1.0-oses-login-m1]");

const currentPath = window.location.pathname;
const isOfferingsPage = currentPath.startsWith("/course/offerings");
const isRegistrationPage = currentPath.startsWith("/course/registration");
const isGradesPage = currentPath.startsWith("/student/grades");
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

const irregularAutomationState = {
  inFlight: false,
  runningRunId: "",
  stopRequested: false
};

const regularAutomationState = {
  pauseNotified: false
};

const loginAutomationState = {
  inFlight: false,
  lastClickedAt: 0
};

const gradeExtractionState = {
  inFlight: false,
  lastRunId: "",
  autoRunTried: false
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
    chrome.runtime.sendMessage(payload, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        // "No SW" can happen briefly while MV3 service worker spins up or reloads.
        if (typeof callback === "function") {
          callback({ success: false, message: runtimeError.message, runtimeError: true });
        }
        return;
      }

      if (typeof callback === "function") {
        callback(response);
      }
    });
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

async function isRegularAutomationPaused() {
  const store = await readStorage(["osesRegularAutoAddPaused"]);
  return store?.osesRegularAutoAddPaused === true;
}

async function isIrregularAutomationPaused() {
  const store = await readStorage(["osesIrregularAutoAddPaused"]);
  return store?.osesIrregularAutoAddPaused === true;
}

async function areNewFeaturesEnabled() {
  const store = await readStorage(["osesNewFeaturesEnabled"]);
  return store?.osesNewFeaturesEnabled === true;
}

async function runOSESAutomation() {
  if (!isTopWindow || !isRegistrationPage) return;
  if (!(await areNewFeaturesEnabled())) return;

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
    postOSESStatus("logged_in_verified", "Logged in verified.", {
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

async function runAutoLoginClick() {
  if (!isLikelyOSESLoginContext()) return;
  if (loginAutomationState.inFlight) return;
  if (!(await areNewFeaturesEnabled())) return;

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
  if (!(await areNewFeaturesEnabled())) return;

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
  if (!(await areNewFeaturesEnabled())) return;

  if (await isRegularAutomationPaused()) {
    if (!regularAutomationState.pauseNotified) {
      postOSESStatus("regular_paused", "Regular auto-add is paused. Press Start in popup to continue.", {
        source: "block-automation"
      });
      regularAutomationState.pauseNotified = true;
    }
    return;
  }

  regularAutomationState.pauseNotified = false;

  blockAutomationState.inFlight = true;
  try {
    const store = await readStorage(["osesBlockEnrollmentRequest", "osesIrregularEnrollmentRequest", "osesIrregularProgress"]);
    const irregularRequest = store.osesIrregularEnrollmentRequest;
    const irregularProgress = store.osesIrregularProgress;
    const irregularActive = Boolean(
      irregularRequest?.isIrregular &&
      Array.isArray(irregularRequest?.queue) &&
      irregularRequest.queue.length > 0 &&
      irregularProgress?.status !== "completed"
    );

    if (irregularActive) {
      postOSESStatus("waiting_oses", "Irregular queue is active. Regular block automation is skipped.", {
        reason: "irregular-mode-active",
        source: "block-automation"
      });
      return;
    }

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

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function removeExtMaskIfPresent() {
  const masks = Array.from(document.querySelectorAll(".ext-el-mask"));
  if (!masks.length) return false;

  masks.forEach((mask) => {
    try {
      mask.remove();
    } catch {
      mask.style.display = "none";
      mask.style.pointerEvents = "none";
      mask.style.opacity = "0";
    }
  });
  return true;
}

function findGridGroupByCourseCode(courseCode) {
  const desired = normalizeKey(courseCode);
  if (!desired) return null;

  const groups = Array.from(document.querySelectorAll(".x-grid-group-title"));
  return groups.find((group) => normalizeKey(group.textContent).includes(desired)) || null;
}

function expandGroup(groupTitle) {
  if (!groupTitle) return false;

  const groupRoot = groupTitle.closest(".x-grid-group") || groupTitle.parentElement;
  const collapsed = groupRoot?.classList?.contains("x-grid-group-collapsed") || groupTitle.getAttribute("aria-expanded") === "false";
  if (collapsed) {
    clickElementBestEffort(groupTitle);
    return true;
  }

  return false;
}

function getGroupRoot(groupTitle) {
  if (!groupTitle) return null;
  return groupTitle.closest(".x-grid-group") || groupTitle.parentElement || null;
}

function listSectionsInGroup(groupRoot) {
  if (!groupRoot || !groupRoot.querySelectorAll) return [];
  return Array.from(groupRoot.querySelectorAll(".x-grid3-cell-inner.x-grid3-col-2"))
    .map((cell) => String(cell.textContent || "").trim().toUpperCase())
    .filter(Boolean);
}

function findSectionCellInGroup(groupRoot, section) {
  const desired = normalizeKey(section);
  if (!desired) return null;

  const searchRoot = groupRoot && groupRoot.querySelectorAll ? groupRoot : document;
  const candidates = Array.from(searchRoot.querySelectorAll(".x-grid3-cell-inner.x-grid3-col-2"));

  const exact = candidates.find((cell) => normalizeKey(cell.textContent) === desired);
  if (exact) return exact;

  return candidates.find((cell) => normalizeKey(cell.textContent).includes(desired)) || null;
}

function selectSectionRowCheckbox(sectionCell) {
  if (!sectionCell) return false;

  const row = sectionCell.closest(".x-grid3-row") || sectionCell.closest("tr") || sectionCell.parentElement;
  if (!row) return false;

  const checkbox = row.querySelector("input[type='checkbox']");
  if (checkbox) {
    if (!checkbox.checked) clickElementBestEffort(checkbox);
    return true;
  }

  const checker = row.querySelector(".x-grid3-row-checker, .x-grid3-check-col, .x-grid3-cell-first");
  if (checker) {
    clickElementBestEffort(checker);
    if (row.classList.contains("x-grid3-row-selected") || row.getAttribute("aria-selected") === "true") return true;
  }

  // ExtJS fallback: selecting the row itself can toggle check model in some grids.
  clickElementBestEffort(row);
  const selectedAfterRowClick = row.classList.contains("x-grid3-row-selected") || row.getAttribute("aria-selected") === "true";
  if (selectedAfterRowClick) return true;

  return false;
}

function findAddCourseButton() {
  const direct = document.querySelector(
    "#add_course, #btn_add_course, button[id*='add'][id*='course'], input[type='button'][value*='Add Course' i], input[type='submit'][value*='Add Course' i]"
  );
  if (direct && isElementVisible(direct)) return direct;

  const candidates = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a, .x-btn-text"));
  return candidates.find((el) => {
    if (!isElementVisible(el)) return false;
    const text = String(el.textContent || el.innerText || el.value || el.getAttribute("title") || "").trim();
    return /add\s*course/i.test(text);
  }) || null;
}

async function clickYesConfirmationForIrregular(courseCode, section) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const candidates = Array.from(document.querySelectorAll("button:not([disabled]), input[type='button']:not([disabled]), input[type='submit']:not([disabled]), .x-btn-text"));
    const yesButton = candidates.find((el) => {
      if (!isElementVisible(el)) return false;
      const text = String(el.textContent || el.innerText || el.value || el.getAttribute("title") || "").trim();
      if (!/^yes$/i.test(text)) return false;
      const inDialog = Boolean(el.closest(".swal2-container, .x-window, .x-message-box, [role='dialog'], .modal"));
      return inDialog;
    });

    if (yesButton) {
      clickElementBestEffort(yesButton);
      postOSESStatus("irregular_confirmed", `Confirmed add-course prompt for ${courseCode} ${section}.`, {
        courseCode,
        section,
        source: "irregular-automation"
      });
      return true;
    }

    await waitMs(250);
  }

  return false;
}

function extractDialogOutcomeText() {
  const containers = Array.from(document.querySelectorAll(".swal2-container, .x-window, .x-message-box, [role='dialog'], .modal"));
  const text = containers
    .map((node) => String(node.textContent || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function classifyDialogOutcome(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return { status: "unknown", message: "" };

  const success = /(success|added|enrolled|saved|registered|successfully)/i.test(normalized);
  const failure = /(failed|error|cannot|unable|denied|conflict|not allowed|already enrolled|already taken|invalid)/i.test(normalized);

  if (success && !failure) return { status: "success", message: text };
  if (failure) return { status: "failure", message: text };
  return { status: "unknown", message: text };
}

function readUnitsValue(selector) {
  const el = document.querySelector(selector);
  const raw = String(el?.textContent || "").trim();
  const num = Number(raw.replace(/[^0-9]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function hasReachedMaximumUnits() {
  const total = readUnitsValue("#total-unit");
  const maximum = readUnitsValue("#maximum");
  if (!total || !maximum) return false;
  return total >= maximum;
}

function isMaxUnitsDialogMessage(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return false;
  return /(maximum\s+units|max\s+units|allowed\s+units|exceed(ed|s)?\s+.*units|units\s+limit)/i.test(normalized);
}

async function waitForAddDialogOutcome(courseCode, section, runId, timeoutMs = 8000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const text = extractDialogOutcomeText();
    if (text) {
      const outcome = classifyDialogOutcome(text);
      if (outcome.status === "success") {
        postOSESStatus("irregular_add_success_dialog", `Detected success dialog for ${courseCode} ${section}.`, {
          source: "irregular-automation",
          courseCode,
          section,
          runId,
          dialogText: outcome.message
        });
        return outcome;
      }

      if (outcome.status === "failure") {
        postOSESStatus("irregular_add_failed_dialog", `Detected failure dialog for ${courseCode} ${section}.`, {
          source: "irregular-automation",
          courseCode,
          section,
          runId,
          dialogText: outcome.message
        });
        return outcome;
      }
    }

    await waitMs(200);
  }

  return { status: "unknown", message: "" };
}

function isCourseInRegisteredList(courseCode, section) {
  const normalizedCode = normalizeKey(courseCode);
  const normalizedSection = normalizeKey(section);
  if (!normalizedCode || !normalizedSection) return false;

  const explicitRoots = Array.from(document.querySelectorAll("#enrolled-panel, #course_enrolled, #registered_courses"));
  const inferredRegisteredPanels = Array.from(document.querySelectorAll(".x-panel, .x-panel-body, .x-grid-panel")).filter((panel) => {
    const panelText = String(panel.textContent || "").toLowerCase();
    const hasRegisteredLabel = panelText.includes("registered courses") || panelText.includes("course_enrolled");
    const hasRows = Boolean(panel.querySelector(".x-grid3-row, tr"));
    return hasRegisteredLabel && hasRows;
  });

  const roots = [...explicitRoots, ...inferredRegisteredPanels];
  const searchRoots = roots.length ? roots : [document.documentElement || document.body];

  const rowHasCourseCode = (row) => {
    const courseCells = Array.from(
      row.querySelectorAll(
        ".x-grid3-cell-inner.x-grid3-col-course_enrolled, .x-grid3-cell-inner.x-grid3-col-course_open, .x-grid3-cell-inner.x-grid3-col-1"
      )
    );

    if (courseCells.length) {
      return courseCells.some((cell) => {
        const key = normalizeKey(cell.textContent || "");
        return key === normalizedCode || key.includes(normalizedCode);
      });
    }

    const rowText = normalizeKey(row.textContent || "");
    return rowText.includes(normalizedCode);
  };

  return searchRoots.some((root) => {
    const sectionCells = Array.from(root.querySelectorAll(".x-grid3-cell-inner.x-grid3-col-3, .x-grid3-cell-inner.x-grid3-col-2"));

    if (sectionCells.length) {
      return sectionCells.some((sectionCell) => {
        const sectionKey = normalizeKey(sectionCell.textContent || "");
        const sectionMatched = sectionKey === normalizedSection || sectionKey.includes(normalizedSection);
        if (!sectionMatched) return false;

        const row = sectionCell.closest(".x-grid3-row") || sectionCell.closest("tr") || sectionCell.parentElement;
        if (!row) return false;
        return rowHasCourseCode(row);
      });
    }

    const rows = Array.from(root.querySelectorAll(".x-grid3-row, tr"));
    return rows.some((row) => {
      const text = normalizeKey(row.textContent || "");
      return text.includes(normalizedCode) && text.includes(normalizedSection);
    });
  });
}

async function waitForCourseInRegisteredList(courseCode, section, runId, timeoutMs = 15000) {
  const startedAt = Date.now();
  let attempts = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    attempts += 1;
    removeExtMaskIfPresent();

    if (isCourseInRegisteredList(courseCode, section)) {
      postOSESStatus("irregular_verified_added", `Verified ${courseCode} ${section} in registered courses.`, {
        source: "irregular-automation",
        courseCode,
        section,
        runId,
        attempts
      });
      return true;
    }

    if (attempts === 1 || attempts % 10 === 0) {
      postOSESStatus("irregular_verifying_added", `Verifying ${courseCode} ${section} in registered list...`, {
        source: "irregular-automation",
        courseCode,
        section,
        runId,
        attempts
      });
    }

    await waitMs(250);
  }

  return false;
}

async function saveIrregularProgressPatch(patch) {
  const store = await readStorage(["osesIrregularProgress"]);
  const current = store?.osesIrregularProgress || {};
  safeStorageSet({
    osesIrregularProgress: {
      ...current,
      ...patch,
      updatedAt: Date.now()
    }
  });
}

async function runIrregularEnrollment() {
  if (isTopWindow) return;
  if (irregularAutomationState.inFlight) return;
  if (!(await areNewFeaturesEnabled())) return;

  if (await isIrregularAutomationPaused()) {
    postOSESStatus("irregular_paused", "Irregular auto-add is paused. Press Start in popup to continue.", {
      source: "irregular-automation"
    });
    await saveIrregularProgressPatch({
      status: "paused",
      prompt: {
        showRetryChoice: false,
        defaultChoice: "retry_once"
      }
    });
    return;
  }

  irregularAutomationState.inFlight = true;
  irregularAutomationState.stopRequested = false;

  try {
    const store = await readStorage(["osesIrregularEnrollmentRequest", "osesIrregularProgress", "osesIrregularRetryMode"]);
    const request = store?.osesIrregularEnrollmentRequest;
    if (!request?.isIrregular || !Array.isArray(request.queue) || !request.queue.length) return;

    const runId = String(request.runId || "").trim();
    if (!runId) return;
    irregularAutomationState.runningRunId = runId;

    const initialAdded = request.queue
      .map((item) => ({
        courseCode: String(item?.courseCode || "").trim().toUpperCase(),
        section: String(item?.section || "").trim().toUpperCase()
      }))
      .filter((item) => item.courseCode && item.section)
      .filter((item) => getRegisteredMatchState(item.courseCode, item.section).exact)
      .map((item) => ({ ...item, source: "already-registered" }));

    await saveIrregularProgressPatch({
      runId,
      status: "running",
      currentIndex: 0,
      total: request.queue.length,
      added: initialAdded,
      skipped: [],
      conflicts: [],
      missing: [],
      prompt: {
        showRetryChoice: false,
        defaultChoice: "retry_once"
      }
    });

    postOSESStatus("irregular_started", `Starting irregular add sequence for ${request.queue.length} course section(s).`, {
      source: "irregular-automation",
      runId
    });

    const added = [...initialAdded];
    const skipped = [];
    const conflicts = [];
    const missing = [];

    for (let index = 0; index < request.queue.length; index += 1) {
      if (irregularAutomationState.stopRequested) break;

      if (await isIrregularAutomationPaused()) {
        postOSESStatus("irregular_paused", "Irregular auto-add was paused mid-run.", {
          source: "irregular-automation",
          runId
        });
        await saveIrregularProgressPatch({
          status: "paused",
          currentIndex: index,
          added,
          skipped,
          conflicts,
          missing,
          prompt: {
            showRetryChoice: false,
            defaultChoice: "retry_once"
          }
        });
        return;
      }

      const item = request.queue[index];
      const courseCode = String(item.courseCode || "").trim().toUpperCase();
      const section = String(item.section || "").trim().toUpperCase();
      if (!courseCode || !section) continue;

      await saveIrregularProgressPatch({ currentIndex: index + 1 });
      postOSESStatus("irregular_processing", `Processing ${courseCode} ${section} (${index + 1}/${request.queue.length})...`, {
        source: "irregular-automation",
        courseCode,
        section,
        runId
      });

      const registeredState = getRegisteredMatchState(courseCode, section);
      if (registeredState.exact) {
        appendUniqueCourseSection(added, { courseCode, section, source: "already-registered" });
        postOSESStatus("irregular_already_registered_skipped", `Skipped ${courseCode} ${section}: already in Registered Courses.`, {
          source: "irregular-automation",
          courseCode,
          section,
          runId
        });
        continue;
      }

      if (registeredState.conflict) {
        conflicts.push({
          courseCode,
          section,
          reason: "section-conflict",
          conflictingSections: registeredState.conflictingSections
        });
        postOSESStatus(
          "irregular_section_conflict_skipped",
          `Skipped ${courseCode} ${section}: section conflict found (${registeredState.conflictingSections.join(", ")}). Remove conflicting section first, then add again.`,
          {
            source: "irregular-automation",
            courseCode,
            section,
            runId,
            conflictingSections: registeredState.conflictingSections
          }
        );
        continue;
      }

      removeExtMaskIfPresent();

      const groupTitle = findGridGroupByCourseCode(courseCode);
      if (!groupTitle) {
        missing.push({ courseCode, section, reason: "course-group-not-found" });
        continue;
      }

      expandGroup(groupTitle);
      const groupRoot = getGroupRoot(groupTitle);

      let sectionCell = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        sectionCell = findSectionCellInGroup(groupRoot, section);
        if (sectionCell) break;
        await waitMs(150);
      }

      if (!sectionCell) {
        const availableSections = listSectionsInGroup(groupRoot);
        postOSESStatus("irregular_section_not_found", `Section ${section} not found under course ${courseCode}.`, {
          source: "irregular-automation",
          courseCode,
          section,
          availableSections,
          runId
        });
        missing.push({ courseCode, section, reason: "section-not-found" });
        continue;
      }

      if (!selectSectionRowCheckbox(sectionCell)) {
        skipped.push({ courseCode, section, reason: "available-but-selection-failed" });
        continue;
      }

      const addCourseButton = findAddCourseButton();
      if (!addCourseButton) {
        skipped.push({ courseCode, section, reason: "available-but-add-button-missing" });
        continue;
      }

      clickElementBestEffort(addCourseButton);
      postOSESStatus("irregular_add_clicked", `Clicked Add Course for ${courseCode} ${section}.`, {
        source: "irregular-automation",
        courseCode,
        section,
        runId
      });

      const confirmed = await clickYesConfirmationForIrregular(courseCode, section);
      if (!confirmed) {
        skipped.push({ courseCode, section, reason: "available-but-confirmation-missing" });
        continue;
      }

      const dialogOutcome = await waitForAddDialogOutcome(courseCode, section, runId);
      if (dialogOutcome.status === "failure") {
        const maxUnitsHit = isMaxUnitsDialogMessage(dialogOutcome.message) || hasReachedMaximumUnits();
        skipped.push({
          courseCode,
          section,
          reason: maxUnitsHit ? "max-units-reached" : "add-failed-dialog-after-available"
        });
        if (maxUnitsHit) {
          postOSESStatus("irregular_max_units_skipped", `Skipped ${courseCode} ${section}: maximum units reached.`, {
            source: "irregular-automation",
            courseCode,
            section,
            runId
          });
        }
        continue;
      }

      const verified = await waitForCourseInRegisteredList(courseCode, section, runId);
      if (verified) {
        appendUniqueCourseSection(added, { courseCode, section });
      } else if (dialogOutcome.status === "success") {
        // Grid refresh can lag even after success dialog; treat this as added and continue.
        appendUniqueCourseSection(added, { courseCode, section, inferred: "success-dialog" });
      } else {
        const maxUnitsHit = hasReachedMaximumUnits() || isMaxUnitsDialogMessage(dialogOutcome.message);
        skipped.push({
          courseCode,
          section,
          reason: maxUnitsHit ? "max-units-reached" : "available-but-not-added"
        });
        if (maxUnitsHit) {
          postOSESStatus("irregular_max_units_skipped", `Skipped ${courseCode} ${section}: maximum units reached.`, {
            source: "irregular-automation",
            courseCode,
            section,
            runId
          });
        }
      }
    }

    const retryMode = store?.osesIrregularRetryMode === "retry_until_all" ? "retry_until_all" : "retry_once";
    const showPrompt = missing.length > 0;

    await saveIrregularProgressPatch({
      status: showPrompt ? "awaiting_retry_decision" : "completed",
      added,
      skipped,
      conflicts,
      missing,
      prompt: {
        showRetryChoice: showPrompt,
        defaultChoice: retryMode
      }
    });

    if (showPrompt) {
      postOSESStatus("irregular_retry_prompt", `Some irregular courses were not added (${missing.length}). Choose a retry mode to continue.`, {
        source: "irregular-automation",
        runId,
        missingCount: missing.length
      });
    } else {
      postOSESStatus("irregular_completed", `Irregular add sequence finished. Added ${added.length}, skipped ${skipped.length}, conflicts ${conflicts.length}.`, {
        source: "irregular-automation",
        runId,
        addedCount: added.length,
        skippedCount: skipped.length,
        conflictCount: conflicts.length
      });
    }
  } finally {
    irregularAutomationState.inFlight = false;
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

      if (request.action === "startIrregularEnrollment") {
        runIrregularEnrollment()
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

function getRegisteredCourseEntries() {
  const roots = Array.from(document.querySelectorAll("#enrolled-panel, #course_enrolled, #registered_courses"));
  const searchRoots = roots.length ? roots : [document.documentElement || document.body];
  const entries = [];

  searchRoots.forEach((root) => {
    const rows = Array.from(root.querySelectorAll(".x-grid3-row, tr"));
    rows.forEach((row) => {
      const courseCell = row.querySelector(
        ".x-grid3-cell-inner.x-grid3-col-course_enrolled, .x-grid3-cell-inner.x-grid3-col-course_open"
      );
      const sectionCell = row.querySelector(
        ".x-grid3-cell-inner.x-grid3-col-3, .x-grid3-cell-inner.x-grid3-col-2"
      );

      const courseCode = String(courseCell?.textContent || "").trim().toUpperCase();
      const section = String(sectionCell?.textContent || "").trim().toUpperCase();
      if (!courseCode || !section) return;

      entries.push({ courseCode, section });
    });
  });

  return entries;
}

function getRegisteredMatchState(courseCode, section) {
  const desiredCourse = normalizeKey(courseCode);
  const desiredSection = normalizeKey(section);
  if (!desiredCourse || !desiredSection) {
    return { exact: false, conflict: false, conflictingSections: [] };
  }

  const entries = getRegisteredCourseEntries();
  const sameCourse = entries.filter((entry) => normalizeKey(entry.courseCode) === desiredCourse);

  if (!sameCourse.length) {
    return { exact: false, conflict: false, conflictingSections: [] };
  }

  const exact = sameCourse.some((entry) => normalizeKey(entry.section) === desiredSection);
  if (exact) {
    return { exact: true, conflict: false, conflictingSections: [] };
  }

  const conflictingSections = sameCourse
    .map((entry) => String(entry.section || "").trim().toUpperCase())
    .filter(Boolean);

  return {
    exact: false,
    conflict: conflictingSections.length > 0,
    conflictingSections
  };
}

function courseSectionKey(courseCode, section) {
  return `${normalizeKey(courseCode)}__${normalizeKey(section)}`;
}

function appendUniqueCourseSection(list, item) {
  if (!Array.isArray(list) || !item) return;
  const key = courseSectionKey(item.courseCode, item.section);
  if (!key || key === "__") return;
  const exists = list.some((entry) => courseSectionKey(entry.courseCode, entry.section) === key);
  if (!exists) list.push(item);
}

function getGradeExtractionStatusSummary(stage, extra = {}) {
  return {
    stage,
    status: stage,
    updatedAt: Date.now(),
    ...extra
  };
}

function postGradeExtractionStatus(stage, extra = {}) {
  safeSendRuntimeMessage({
    action: "osesGradeExtractionStatus",
    data: getGradeExtractionStatusSummary(stage, extra)
  });
}

async function isGradeExtractionPaused() {
  const store = await readStorage(["osesGradeExtractionPaused"]);
  return store?.osesGradeExtractionPaused === true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTextContent(el) {
  return String(el?.textContent || "").replace(/\s+/g, " ").trim();
}

function normalizeCourseCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function isLikelyCourseCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return false;
  // Accept mixed curriculum-style codes and avoid dropping potential unmatched courses.
  return /[A-Z]/.test(code) && code.length >= 3;
}

function pickGradeTableRows() {
  const tables = Array.from(document.querySelectorAll("table"));
  for (const table of tables) {
    const headerCells = Array.from(table.querySelectorAll("thead th, tr th, tr:first-child td")).map((cell) => getTextContent(cell).toLowerCase());
    const hasCourseColumn = headerCells.some((h) => /course|subject|code/.test(h));
    const hasGradeColumn = headerCells.some((h) => /final\s*grade|\bfinal\b|\bgrade\b/.test(h));
    if (!hasCourseColumn || !hasGradeColumn) continue;

    const rows = Array.from(table.querySelectorAll("tbody tr, tr")).filter((row) => row.querySelectorAll("td").length >= 2);
    if (rows.length > 0) return { table, rows, headerCells };
  }
  return { table: null, rows: [], headerCells: [] };
}

function findColumnIndexes(headerCells) {
  let courseIndex = -1;
  let gradeIndex = -1;
  let finalIndex = -1;

  headerCells.forEach((header, index) => {
    const h = String(header || "").toLowerCase();
    if (courseIndex < 0 && /course\s*code|subject\s*code|course|subject|code/.test(h)) {
      courseIndex = index;
    }
    if (finalIndex < 0 && /\bfinal\b/.test(h)) {
      finalIndex = index;
    }
    if (gradeIndex < 0 && /final\s*grade|grade/.test(h)) {
      gradeIndex = index;
    }
  });

  if (courseIndex < 0) courseIndex = 0;
  if (finalIndex >= 0) {
    gradeIndex = finalIndex;
  }
  if (gradeIndex < 0) gradeIndex = 1;

  return { courseIndex, gradeIndex };
}

function isIgnorableGrade(grade) {
  const value = String(grade || "").trim().toLowerCase();
  if (!value) return true;
  return value === "--" || value === "n/a" || value === "na" || value === "inc";
}

function getTermOrder(termLabel) {
  const normalized = normalizeTerm(termLabel || "");
  if (normalized === "Term 1") return 1;
  if (normalized === "Term 2") return 2;
  if (normalized === "Term 3") return 3;
  return 99;
}

function getSchoolYearStart(value) {
  const text = String(value || "").trim();
  const standard = text.match(/(20\d{2})\s*[-/]\s*(20\d{2})/);
  if (standard) return Number.parseInt(standard[1], 10);

  const compact = text.match(/(20\d{2})(20\d{2})/);
  if (compact) return Number.parseInt(compact[1], 10);

  return NaN;
}

function sortGradeTermOptionsChronologically(options) {
  return [...options].sort((a, b) => {
    const aText = getTextContent(a);
    const bText = getTextContent(b);

    const aYear = getSchoolYearStart(aText);
    const bYear = getSchoolYearStart(bText);
    const aHasYear = Number.isFinite(aYear);
    const bHasYear = Number.isFinite(bYear);

    if (aHasYear && bHasYear && aYear !== bYear) {
      return aYear - bYear;
    }

    const aTerm = getTermOrder(aText);
    const bTerm = getTermOrder(bText);
    if (aTerm !== bTerm) {
      return aTerm - bTerm;
    }

    const aIndex = Number(a.index ?? 0);
    const bIndex = Number(b.index ?? 0);
    return aIndex - bIndex;
  });
}

function readSchoolYearFromPage() {
  const year = findSchoolYearValue();
  if (year) return year;
  const textMatch = getTextContent(document.body).match(/20\d{2}\s*[-/]\s*20\d{2}/);
  return textMatch ? normalizeSchoolYear(textMatch[0]) : "";
}

function findGradesTermSelect() {
  const selects = Array.from(document.querySelectorAll("select"));
  const preferred = selects.find((selectEl) => {
    const context = getSelectContext(selectEl).toLowerCase();
    const options = Array.from(selectEl.options || []);
    return /term|semester/.test(context) && options.length > 1;
  });
  if (preferred) return preferred;

  return selects.find((selectEl) => {
    const options = Array.from(selectEl.options || []).map((option) => getTextContent(option).toLowerCase());
    const hits = options.filter((t) => /term|semester|1st|2nd|3rd|summer/.test(t));
    return hits.length >= 2;
  }) || null;
}

function findGradesSchoolYearSelect() {
  const selects = Array.from(document.querySelectorAll("select"));
  const preferred = selects.find((selectEl) => {
    const context = getSelectContext(selectEl).toLowerCase();
    const options = Array.from(selectEl.options || []);
    const hasSchoolYearHint = /school\s*year|academic\s*year|\bsy\b/.test(context);
    return hasSchoolYearHint && options.length > 1;
  });
  if (preferred) return preferred;

  return selects.find((selectEl) => {
    const options = Array.from(selectEl.options || []).map((option) => getTextContent(option));
    const yearHits = options.filter((text) => Number.isFinite(getSchoolYearStart(text)));
    return yearHits.length >= 2;
  }) || null;
}

function isCombinedTermSchoolYearSelect(selectEl) {
  if (!selectEl) return false;
  const context = getSelectContext(selectEl).toLowerCase();
  if (context.includes("term") && context.includes("school year")) return true;

  const options = Array.from(selectEl.options || []).map((option) => getTextContent(option));
  return options.some((text) => /^\s*[123]\s*[-/]\s*20\d{4}\s*$/i.test(text) || /^\s*[123]\s*[-/]\s*20\d{2}\s*[-/]\s*20\d{2}\s*$/i.test(text));
}

function parseTermSchoolYearLabel(label) {
  const raw = String(label || "").trim();
  if (!raw) {
    return {
      term: "",
      schoolYear: ""
    };
  }

  const termMatch = raw.match(/^\s*([123])\b/);
  let term = "";
  if (termMatch?.[1] === "1") term = "Term 1";
  if (termMatch?.[1] === "2") term = "Term 2";
  if (termMatch?.[1] === "3") term = "Term 3";

  const yearMatch = raw.match(/(20\d{2}\s*[-/]\s*20\d{2}|20\d{2}20\d{2}|20\d{4})/);
  const schoolYear = yearMatch ? normalizeSchoolYear(yearMatch[1]) : "";

  return {
    term,
    schoolYear
  };
}

function toOptionSnapshot(option) {
  return {
    value: String(option?.value || ""),
    text: getTextContent(option),
    index: Number(option?.index ?? 0)
  };
}

function findOptionBySnapshot(selectEl, snapshot) {
  if (!selectEl || !snapshot) return null;
  const options = Array.from(selectEl.options || []);
  if (!options.length) return null;

  const desiredText = String(snapshot.text || "").trim().toLowerCase();
  const desiredIndex = Number(snapshot.index ?? -1);

  // Prefer text+index first so we do not get stuck when portals reuse option values.
  if (desiredText && Number.isFinite(desiredIndex) && desiredIndex >= 0) {
    const byTextAndIndex = options.find((option) => {
      return Number(option.index ?? -1) === desiredIndex && getTextContent(option).toLowerCase() === desiredText;
    });
    if (byTextAndIndex) return byTextAndIndex;
  }

  // Next, use index if it is valid for this refreshed select.
  if (Number.isFinite(desiredIndex) && desiredIndex >= 0 && desiredIndex < options.length) {
    return options[desiredIndex];
  }

  // Fallback to exact text matching.
  if (desiredText) {
    const byText = options.find((option) => getTextContent(option).toLowerCase() === desiredText);
    if (byText) return byText;

    const byTextContains = options.find((option) => getTextContent(option).toLowerCase().includes(desiredText));
    if (byTextContains) return byTextContains;
  }

  // Value is least reliable on this portal because it can be duplicated across options.
  const snapshotValue = String(snapshot.value || "");
  if (snapshotValue) {
    const byValue = options.find((option) => String(option.value || "") === snapshotValue);
    if (byValue) return byValue;
  }

  return null;
}

function dispatchSelectChange(selectEl, optionEl) {
  if (!selectEl || !optionEl) return false;
  selectEl.value = optionEl.value;
  if (typeof optionEl.index === "number") {
    selectEl.selectedIndex = optionEl.index;
  }
  selectEl.dispatchEvent(new Event("input", { bubbles: true }));
  selectEl.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function sortSchoolYearOptionsChronologically(options) {
  return [...options].sort((a, b) => {
    const aText = getTextContent(a);
    const bText = getTextContent(b);
    const aYear = getSchoolYearStart(aText);
    const bYear = getSchoolYearStart(bText);
    const aHasYear = Number.isFinite(aYear);
    const bHasYear = Number.isFinite(bYear);

    if (aHasYear && bHasYear && aYear !== bYear) {
      return aYear - bYear;
    }

    const aIndex = Number(a.index ?? 0);
    const bIndex = Number(b.index ?? 0);
    return aIndex - bIndex;
  });
}

function sortOptionsBottomFirst(options) {
  return [...options].sort((a, b) => Number(b?.index ?? 0) - Number(a?.index ?? 0));
}

function doesSelectionLookApplied(expectedTermLabel, expectedSchoolYear) {
  const expectedTerm = normalizeTerm(expectedTermLabel || "");
  const currentTerm = normalizeTerm(findTermValue() || "");
  if (expectedTerm && currentTerm && expectedTerm !== currentTerm) {
    return false;
  }

  const expectedYearStart = getSchoolYearStart(expectedSchoolYear || "");
  const currentYearStart = getSchoolYearStart(readSchoolYearFromPage() || "");
  if (Number.isFinite(expectedYearStart) && Number.isFinite(currentYearStart) && expectedYearStart !== currentYearStart) {
    return false;
  }

  return true;
}

function getSelectableOptions(selectEl) {
  if (!selectEl) return [];
  return Array.from(selectEl.options || []).filter((option) => String(option.value || "").trim());
}

function getOptionByReversePosition(selectEl, reversePosition) {
  const options = getSelectableOptions(selectEl);
  if (!options.length) return null;
  const idx = options.length - 1 - Number(reversePosition || 0);
  if (idx < 0 || idx >= options.length) return null;
  return options[idx];
}

function findGradesSubmitButton(anchorEl) {
  const selector = "button, input[type='button'], input[type='submit'], a";
  const candidates = [];

  const form = anchorEl?.closest?.("form");
  if (form) {
    candidates.push(...Array.from(form.querySelectorAll(selector)));
  }

  const controlsContainer = anchorEl?.closest?.(".x-panel, .x-form, .x-form-item, .toolbar, .filters, .filter, .search");
  if (controlsContainer) {
    candidates.push(...Array.from(controlsContainer.querySelectorAll(selector)));
  }

  if (!candidates.length) {
    candidates.push(...Array.from(document.querySelectorAll(selector)));
  }

  const seen = new Set();
  const uniqueCandidates = candidates.filter((el) => {
    if (seen.has(el)) return false;
    seen.add(el);
    return true;
  });

  return uniqueCandidates.find((el) => {
    if (!isElementVisible(el)) return false;

    const text = String(el.textContent || el.value || el.getAttribute("title") || "").trim().toLowerCase();
    if (!text) return false;

    if (/log\s*out|logout|sign\s*out|signout|exit/.test(text)) return false;

    return /\bsubmit\b|\bfilter\b|\bsearch\b|\bview\b|\bshow\b|\bgo\b/.test(text);
  }) || null;
}

async function applyGradesFilters({ schoolYearSnapshot = null, termSnapshot = null, schoolYearReverseOffset = null, termReverseOffset = null } = {}) {
  const schoolYearSelect = findGradesSchoolYearSelect();
  const termSelect = findGradesTermSelect();

  if (schoolYearSelect) {
    const yearOption = Number.isInteger(schoolYearReverseOffset)
      ? getOptionByReversePosition(schoolYearSelect, schoolYearReverseOffset)
      : (schoolYearSnapshot ? findOptionBySnapshot(schoolYearSelect, schoolYearSnapshot) : null);
    if (yearOption) {
      dispatchSelectChange(schoolYearSelect, yearOption);
    }
  }

  if (termSelect) {
    const termOption = Number.isInteger(termReverseOffset)
      ? getOptionByReversePosition(termSelect, termReverseOffset)
      : (termSnapshot ? findOptionBySnapshot(termSelect, termSnapshot) : null);
    if (termOption) {
      dispatchSelectChange(termSelect, termOption);
    }
  }

  const submit = findGradesSubmitButton(termSelect || schoolYearSelect);
  if (submit) {
    clickElementBestEffort(submit);
  }

  await sleep(1500);
}

const GRADE_COMBINED_SESSION_KEY = "osesGradeExtractionCombinedSession";

async function getGradeCombinedSession() {
  const store = await readStorage([GRADE_COMBINED_SESSION_KEY]);
  return store?.[GRADE_COMBINED_SESSION_KEY] || null;
}

function setGradeCombinedSession(session) {
  safeStorageSet({ [GRADE_COMBINED_SESSION_KEY]: session });
}

function clearGradeCombinedSession() {
  safeStorageRemove([GRADE_COMBINED_SESSION_KEY]);
}

function makeOptionKey(snapshot) {
  if (!snapshot) return "";
  const value = String(snapshot.value || "").trim();
  const text = String(snapshot.text || "").trim().toLowerCase();
  return `${value}::${text}`;
}

function isGradesAccessBlockedByBalance() {
  const pageText = getTextContent(document.body).toLowerCase();
  if (!pageText) return false;

  return (
    pageText.includes("grades currently inaccessible") ||
    pageText.includes("grade report currently inaccessible") ||
    (pageText.includes("inaccessible") && pageText.includes("account balance")) ||
    (pageText.includes("cannot") && pageText.includes("grade") && pageText.includes("account balance"))
  );
}

async function extractGradeAttemptsFromPage(runId, trigger = "manual") {
  const attempts = [];
  let chronology = 0;

  const collectCurrentGridRows = (portalTermLabelHint = "", schoolYearHint = "") => {
    const portalTermLabel = portalTermLabelHint || findTermValue() || "Unknown Term";
    const parsedLabel = parseTermSchoolYearLabel(portalTermLabel);
    const schoolYear = parsedLabel.schoolYear || schoolYearHint || readSchoolYearFromPage();
    const term = parsedLabel.term || normalizeTerm(portalTermLabel || findTermValue() || "");

    const { rows, headerCells } = pickGradeTableRows();
    const { courseIndex, gradeIndex } = findColumnIndexes(headerCells);

    const parsed = [];

    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (!cells.length) return;

      const courseCode = normalizeCourseCode(getTextContent(cells[courseIndex] || cells[0]));
      const finalGrade = getTextContent(cells[gradeIndex] || cells[cells.length - 1]);
      if (!courseCode || isIgnorableGrade(finalGrade)) return;
      if (!isLikelyCourseCode(courseCode)) return;

      parsed.push({
        courseCode,
        finalGrade,
        schoolYear,
        portalTermLabel,
        term
      });
    });

    return parsed;
  };

  const waitUntilGradesAreReadable = async (
    portalTermLabelHint = "",
    schoolYearHint = "",
    selection = { schoolYearSnapshot: null, termSnapshot: null, schoolYearReverseOffset: null, termReverseOffset: null }
  ) => {
    const maxAttempts = 40;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const portalTermLabel = portalTermLabelHint || findTermValue() || "Unknown Term";

      postGradeExtractionStatus("running", {
        currentTermLabel: portalTermLabel,
        extractedCount: attempts.length,
        message: `Waiting for grades (${attempt}/${maxAttempts})`
      });

      if (!doesSelectionLookApplied(portalTermLabelHint, schoolYearHint)) {
        // Portal sometimes resets filters after submit; force the expected selection again.
        await applyGradesFilters({
          schoolYearSnapshot: selection?.schoolYearSnapshot || null,
          termSnapshot: selection?.termSnapshot || null,
          schoolYearReverseOffset: Number.isInteger(selection?.schoolYearReverseOffset) ? selection.schoolYearReverseOffset : null,
          termReverseOffset: Number.isInteger(selection?.termReverseOffset) ? selection.termReverseOffset : null
        });
        await sleep(900);
        continue;
      }

      const parsedRows = collectCurrentGridRows(portalTermLabelHint, schoolYearHint);
      if (parsedRows.length > 0) {
        parsedRows.forEach((entry) => {
          attempts.push({
            ...entry,
            chronologicalIndex: chronology
          });
          chronology += 1;
        });

        postGradeExtractionStatus("running", {
          currentTermLabel: portalTermLabel,
          extractedCount: attempts.length,
          message: `Read ${parsedRows.length} grade row(s) for ${portalTermLabel}.`
        });
        return parsedRows.length;
      }

      await sleep(900);
    }

    throw new Error(`Timed out waiting for grades to load for ${portalTermLabelHint || "selected term"}.`);
  };

  const initialYearSelect = findGradesSchoolYearSelect();
  const initialTermSelect = findGradesTermSelect();
  const singleCombinedSelect = Boolean(initialTermSelect && isCombinedTermSchoolYearSelect(initialTermSelect));

  if (singleCombinedSelect) {
    const liveCombinedSelect = findGradesTermSelect();
    const allOptions = sortOptionsBottomFirst(getSelectableOptions(liveCombinedSelect)).map(toOptionSnapshot);
    if (!allOptions.length) {
      throw new Error("No term-school-year options found in dropdown.");
    }

    const selectedOption = liveCombinedSelect?.options?.[liveCombinedSelect.selectedIndex] || null;
    const selectedSnapshot = selectedOption ? toOptionSnapshot(selectedOption) : allOptions[0];
    const selectedKey = makeOptionKey(selectedSnapshot);

    let session = await getGradeCombinedSession();
    const shouldStartFresh = trigger !== "auto-on-open" || !session || session?.runId !== runId;

    if (shouldStartFresh) {
      session = {
        runId,
        queue: allOptions,
        processedKeys: [],
        attempts: [],
        updatedAt: Date.now()
      };
    }

    const processedKeys = Array.isArray(session.processedKeys) ? session.processedKeys : [];
    const sessionAttempts = Array.isArray(session.attempts) ? session.attempts : [];
    const queue = Array.isArray(session.queue) ? session.queue : allOptions;

    const parseCurrent = parseTermSchoolYearLabel(selectedSnapshot?.text || "");
    const parsedRows = collectCurrentGridRows(
      parseCurrent.term || selectedSnapshot?.text || findTermValue() || "Unknown Term",
      parseCurrent.schoolYear || readSchoolYearFromPage()
    );

    if (!processedKeys.includes(selectedKey) && parsedRows.length > 0) {
      parsedRows.forEach((entry, idx) => {
        sessionAttempts.push({
          ...entry,
          chronologicalIndex: sessionAttempts.length + idx
        });
      });
      processedKeys.push(selectedKey);
    }

    const remaining = queue.filter((item) => !processedKeys.includes(makeOptionKey(item)));
    const blockedByBalance = isGradesAccessBlockedByBalance();
    const shouldStopBecauseLatestIsBlocked = blockedByBalance && parsedRows.length === 0;

    postGradeExtractionStatus("running", {
      runId,
      currentTermLabel: selectedSnapshot?.text || findTermValue() || "Unknown Term",
      extractedCount: sessionAttempts.length,
      stoppedAt: "",
      message: shouldStopBecauseLatestIsBlocked
        ? "Stopping at latest term: grades inaccessible due to account balance."
        : (remaining.length ? `Processed current selection. Remaining: ${remaining.length}` : "All selections processed.")
    });

    if (shouldStopBecauseLatestIsBlocked) {
      clearGradeCombinedSession();
      return {
        completedAttempts: sessionAttempts,
        stoppedAt: "Latest term inaccessible due to account balance"
      };
    }

    if (!remaining.length) {
      clearGradeCombinedSession();
      return sessionAttempts;
    }

    const nextSnapshot = remaining[0];
    setGradeCombinedSession({
      runId,
      queue: queue,
      processedKeys,
      attempts: sessionAttempts,
      updatedAt: Date.now()
    });

    await applyGradesFilters({
      schoolYearSnapshot: null,
      termSnapshot: nextSnapshot,
      schoolYearReverseOffset: null,
      termReverseOffset: null
    });

    return { pending: true, runId, extractedCount: sessionAttempts.length };
  } else {

  const initialYearCount = getSelectableOptions(initialYearSelect).length;

  if (initialYearCount > 0) {
    for (let yearOffset = 0; yearOffset < initialYearCount; yearOffset += 1) {
      const liveYearSelect = findGradesSchoolYearSelect();
      const liveYearOption = getOptionByReversePosition(liveYearSelect, yearOffset);
      const yearSnapshot = liveYearOption ? toOptionSnapshot(liveYearOption) : null;

      if (yearSnapshot) {
        await applyGradesFilters({
          schoolYearSnapshot: yearSnapshot,
          termSnapshot: null,
          schoolYearReverseOffset: yearOffset,
          termReverseOffset: null
        });
      }

      const termSelectForYear = findGradesTermSelect();
      const termCountForYear = getSelectableOptions(termSelectForYear).length;

      if (!termCountForYear) {
        await waitUntilGradesAreReadable(
          findTermValue() || "Unknown Term",
          yearSnapshot?.text || readSchoolYearFromPage(),
          {
            schoolYearSnapshot: yearSnapshot,
            termSnapshot: null,
            schoolYearReverseOffset: yearOffset,
            termReverseOffset: null
          }
        );
        continue;
      }

      for (let termOffset = 0; termOffset < termCountForYear; termOffset += 1) {
        const freshYearSelect = findGradesSchoolYearSelect();
        const freshYearOption = getOptionByReversePosition(freshYearSelect, yearOffset);
        const freshYearSnapshot = freshYearOption ? toOptionSnapshot(freshYearOption) : yearSnapshot;

        const freshTermSelect = findGradesTermSelect();
        const freshTermOption = getOptionByReversePosition(freshTermSelect, termOffset);
        const termSnapshot = freshTermOption ? toOptionSnapshot(freshTermOption) : null;

        await applyGradesFilters({
          schoolYearSnapshot: freshYearSnapshot,
          termSnapshot,
          schoolYearReverseOffset: yearOffset,
          termReverseOffset: termOffset
        });

        await waitUntilGradesAreReadable(
          termSnapshot?.text || findTermValue() || "Unknown Term",
          freshYearSnapshot?.text || readSchoolYearFromPage(),
          {
            schoolYearSnapshot: freshYearSnapshot,
            termSnapshot,
            schoolYearReverseOffset: yearOffset,
            termReverseOffset: termOffset
          }
        );
      }
    }
  } else {
    const initialTermCount = getSelectableOptions(initialTermSelect).length;

    if (!initialTermCount) {
      await waitUntilGradesAreReadable(findTermValue() || "Unknown Term", readSchoolYearFromPage(), {
        schoolYearSnapshot: null,
        termSnapshot: null
      });
    } else {
      for (let termOffset = 0; termOffset < initialTermCount; termOffset += 1) {
        const freshTermSelect = findGradesTermSelect();
        const freshTermOption = getOptionByReversePosition(freshTermSelect, termOffset);
        const termSnapshot = freshTermOption ? toOptionSnapshot(freshTermOption) : null;

        if (termSnapshot) {
          await applyGradesFilters({
            termSnapshot,
            schoolYearReverseOffset: null,
            termReverseOffset: termOffset
          });
        }

        await waitUntilGradesAreReadable(
          termSnapshot?.text || findTermValue() || "Unknown Term",
          readSchoolYearFromPage(),
          {
            schoolYearSnapshot: null,
            termSnapshot,
            schoolYearReverseOffset: null,
            termReverseOffset: termOffset
          }
        );
      }
    }
  }
  }

  const deduped = [];
  const seen = new Set();
  attempts.forEach((item) => {
    const key = `${item.courseCode}__${item.schoolYear}__${item.portalTermLabel}__${item.finalGrade}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });

  return deduped;
}

async function runGradeExtractionAutomation(trigger = "manual") {
  if (!isTopWindow || !isGradesPage) return { success: false, message: "Not on Student Grades page." };
  if (gradeExtractionState.inFlight) return { success: true, message: "Grade extraction already running." };
  if (!(await areNewFeaturesEnabled())) return { success: false, message: "New Features are disabled in extension popup." };

  if (await isGradeExtractionPaused()) {
    postGradeExtractionStatus("paused", {
      stoppedAt: "Paused from popup",
      trigger
    });
    return { success: false, message: "Grade extraction is paused in popup controls." };
  }

  gradeExtractionState.inFlight = true;
  const existingSession = await getGradeCombinedSession();
  const runId = trigger === "auto-on-open" && existingSession?.runId
    ? String(existingSession.runId)
    : `grade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  gradeExtractionState.lastRunId = runId;

  postGradeExtractionStatus("running", {
    runId,
    trigger,
    extractedCount: 0,
    startedAt: Date.now()
  });

  try {
    const attempts = await extractGradeAttemptsFromPage(runId, trigger);

    if (attempts && attempts.pending) {
      return { success: true, pending: true, runId, extracted: Number(attempts.extractedCount || 0) };
    }

    const finalAttempts = Array.isArray(attempts)
      ? attempts
      : (Array.isArray(attempts?.completedAttempts) ? attempts.completedAttempts : []);
    const completedStopReason = String(attempts?.stoppedAt || "").trim();

    if (!finalAttempts.length) {
      postGradeExtractionStatus("error", {
        runId,
        error: "No grade attempts were extracted from the page.",
        stoppedAt: "No grade rows found"
      });
      return { success: false, message: "No grade attempts were extracted from the page." };
    }

    const deliveryResponse = await new Promise((resolve) => {
      safeSendRuntimeMessage(
        {
          action: "gradeAttemptsExtracted",
          data: {
            runId,
            attempts: finalAttempts,
            summary: {
              extracted: finalAttempts.length,
              termsProcessed: Array.from(new Set(finalAttempts.map((item) => item.portalTermLabel))).length
            },
            extractedAt: Date.now()
          }
        },
        (response) => resolve(response)
      );
    });

    const deliveryOk = Boolean(deliveryResponse?.success);
    if (!deliveryOk) {
      const message = String(deliveryResponse?.message || "Failed to deliver extracted grades to web app localStorage.").trim();
      postGradeExtractionStatus("error", {
        runId,
        extractedCount: finalAttempts.length,
        error: message,
        stoppedAt: "Delivery failed",
        completedAt: Date.now()
      });
      return { success: false, message, runId };
    }

    postGradeExtractionStatus("completed", {
      runId,
      extractedCount: finalAttempts.length,
      completedAt: Date.now(),
      stoppedAt: completedStopReason || "Completed"
    });

    return { success: true, extracted: finalAttempts.length, runId };
  } catch (error) {
    const message = error?.message || String(error);
    postGradeExtractionStatus("error", {
      runId,
      error: message,
      stoppedAt: "Runtime error"
    });
    return { success: false, message };
  } finally {
    gradeExtractionState.inFlight = false;
  }
}

async function maybeAutoRunGradeExtraction() {
  if (!isTopWindow || !isGradesPage) return;
  if (gradeExtractionState.autoRunTried) return;
  gradeExtractionState.autoRunTried = true;

  await sleep(1200);
  const session = await getGradeCombinedSession();
  if (session?.runId) {
    await runGradeExtractionAutomation("auto-on-open");
    return;
  }

  await runGradeExtractionAutomation("auto-on-open");
}

if (isGradesPage && isTopWindow) {
  maybeAutoRunGradeExtraction();
}

if (hasUsableExtensionContext()) {
  try {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "startGradeExtraction") {
        runGradeExtractionAutomation("background-trigger")
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ success: false, message: error?.message || String(error) }));
        return true;
      }
      return false;
    });
  } catch {
    // Extension context can be invalidated when extension reloads.
  }
}