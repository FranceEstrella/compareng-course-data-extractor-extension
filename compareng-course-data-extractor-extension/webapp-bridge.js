function safeReadLocalStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function safeWriteLocalStorageJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function emitGradeAttemptsUpdate(detail) {
  try {
    window.dispatchEvent(new CustomEvent("compareng:gradeAttemptsUpdated", { detail }));
  } catch {
    // Ignore event dispatch issues on locked-down pages.
  }

  try {
    document.dispatchEvent(new CustomEvent("compareng:gradeAttemptsUpdated", { detail }));
  } catch {
    // Ignore event dispatch issues on locked-down pages.
  }

  try {
    window.postMessage(
      {
        source: "compareng-course-data-extractor-extension",
        type: "gradeAttemptsUpdated",
        detail
      },
      "*"
    );
  } catch {
    // Ignore postMessage issues.
  }

  try {
    window.dispatchEvent(new StorageEvent("storage", { key: "comparengGradeAttemptsLatest" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "comparengGradeAttemptsHistory" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "gradeAttempts" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "gradeAttemptsPayload" }));
  } catch {
    // Some environments do not allow synthetic StorageEvent.
  }
}

function emitCourseOfferingsUpdate(detail) {
  try {
    window.dispatchEvent(new CustomEvent("compareng:courseOfferingsUpdated", { detail }));
  } catch {
    // Ignore event dispatch issues on locked-down pages.
  }

  try {
    document.dispatchEvent(new CustomEvent("compareng:courseOfferingsUpdated", { detail }));
  } catch {
    // Ignore event dispatch issues on locked-down pages.
  }

  try {
    window.postMessage(
      {
        source: "compareng-course-data-extractor-extension",
        type: "courseOfferingsUpdated",
        detail
      },
      "*"
    );
  } catch {
    // Ignore postMessage issues.
  }

  try {
    window.dispatchEvent(new StorageEvent("storage", { key: "comparengCourseOfferingsLatest" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "comparengCourseDataLatest" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "courseOfferingsPayload" }));
  } catch {
    // Some environments do not allow synthetic StorageEvent.
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action !== "storeGradeAttemptsInLocalStorage") return false;

  try {
    const payload = request?.data || {};
    const runId = String(payload?.runId || "").trim();
    const attempts = Array.isArray(payload?.attempts) ? payload.attempts : [];
    const extractedAt = Number(payload?.extractedAt || Date.now());
    const summary = payload?.summary || null;

    if (!runId || attempts.length === 0) {
      sendResponse({ success: false, message: "Invalid grade attempts payload." });
      return false;
    }

    const latest = {
      runId,
      attempts,
      summary,
      extractedAt,
      updatedAt: Date.now(),
      source: "compareng-course-data-extractor-extension"
    };

    const previousHistory = safeReadLocalStorageJson("comparengGradeAttemptsHistory", []);
    const history = Array.isArray(previousHistory) ? previousHistory : [];
    history.unshift({
      runId,
      extractedCount: attempts.length,
      attempts,
      summary,
      extractedAt,
      updatedAt: Date.now()
    });

    const trimmedHistory = history.slice(0, 30);

    const latestOk = safeWriteLocalStorageJson("comparengGradeAttemptsLatest", latest);
    const historyOk = safeWriteLocalStorageJson("comparengGradeAttemptsHistory", trimmedHistory);
    const legacyAttemptsOk = safeWriteLocalStorageJson("gradeAttempts", attempts);
    const legacyPayloadOk = safeWriteLocalStorageJson("gradeAttemptsPayload", latest);

    if (!latestOk || !historyOk || !legacyAttemptsOk || !legacyPayloadOk) {
      sendResponse({ success: false, message: "Failed writing grade attempts to localStorage." });
      return false;
    }

    emitGradeAttemptsUpdate({
      runId,
      extractedCount: attempts.length,
      extractedAt
    });

    sendResponse({
      success: true,
      runId,
      storedCount: attempts.length,
      storageKeys: [
        "comparengGradeAttemptsLatest",
        "comparengGradeAttemptsHistory",
        "gradeAttempts",
        "gradeAttemptsPayload"
      ]
    });
    return false;
  } catch (error) {
    sendResponse({ success: false, message: error?.message || String(error) });
    return false;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action !== "storeCourseOfferingsInLocalStorage") return false;

  try {
    const payload = request?.data || {};
    const rows =
      Array.isArray(payload?.rows)
        ? payload.rows
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.courses)
            ? payload.courses
            : [];

    if (!rows.length) {
      sendResponse({ success: false, message: "Invalid course offerings payload." });
      return false;
    }

    const term = String(payload?.term || rows[0]?.term || "").trim();
    const schoolYear = String(payload?.schoolYear || rows[0]?.schoolYear || "").trim();
    const extractedAt = Number(payload?.extractedAt || Date.now());

    const latest = {
      term,
      schoolYear,
      extractedAt,
      updatedAt: Date.now(),
      rows,
      source: "compareng-course-data-extractor-extension"
    };

    const latestOk = safeWriteLocalStorageJson("comparengCourseOfferingsLatest", latest);
    const legacyOk = safeWriteLocalStorageJson("comparengCourseDataLatest", latest);
    const payloadOk = safeWriteLocalStorageJson("courseOfferingsPayload", latest);

    if (!latestOk || !legacyOk || !payloadOk) {
      sendResponse({ success: false, message: "Failed writing course offerings to localStorage." });
      return false;
    }

    emitCourseOfferingsUpdate({
      extractedAt,
      extractedCount: rows.length,
      term,
      schoolYear
    });

    sendResponse({
      success: true,
      storedCount: rows.length,
      term,
      schoolYear,
      storageKeys: [
        "comparengCourseOfferingsLatest",
        "comparengCourseDataLatest",
        "courseOfferingsPayload"
      ]
    });
    return false;
  } catch (error) {
    sendResponse({ success: false, message: error?.message || String(error) });
    return false;
  }
});
