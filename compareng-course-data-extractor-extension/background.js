console.log("Background script loaded! [build 1.2.0-oses-login-m1]");

self.addEventListener("unhandledrejection", (event) => {
    const reasonText = String(event?.reason?.message || event?.reason || "");
    if (/no\s*sw/i.test(reasonText)) {
        event.preventDefault();
        console.warn("Ignored transient service worker rejection:", reasonText);
    }
});

function queryTabsSafe(queryInfo) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.query(queryInfo, (tabs) => {
                const runtimeError = chrome.runtime.lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message || "Failed to query tabs."));
                    return;
                }

                resolve(Array.isArray(tabs) ? tabs : []);
            });
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

function sendTabMessageSafe(tabId, payload) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.sendMessage(tabId, payload, (response) => {
                const runtimeError = chrome.runtime.lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message || "Failed to send tab message."));
                    return;
                }

                resolve(response);
            });
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

function ensureDeveloperDefaults() {
    chrome.storage.local.get([
        "osesNewFeaturesEnabled",
        "osesDeveloperMode",
        "osesRegularAutoAddPaused",
        "osesIrregularAutoAddPaused",
        "osesGradeExtractionPaused"
    ], (result) => {
        const patch = {};
        if (typeof result?.osesNewFeaturesEnabled !== "boolean") patch.osesNewFeaturesEnabled = false;
        if (typeof result?.osesDeveloperMode !== "boolean") patch.osesDeveloperMode = false;
        if (typeof result?.osesRegularAutoAddPaused !== "boolean") patch.osesRegularAutoAddPaused = false;
        if (typeof result?.osesIrregularAutoAddPaused !== "boolean") patch.osesIrregularAutoAddPaused = false;
        if (typeof result?.osesGradeExtractionPaused !== "boolean") patch.osesGradeExtractionPaused = false;
        if (Object.keys(patch).length > 0) {
            chrome.storage.local.set(patch);
        }
    });
}

ensureDeveloperDefaults();

function ensureAutomationModeConsistency() {
    chrome.storage.local.get([
        "osesBlockEnrollmentRequest",
        "osesIrregularEnrollmentRequest",
        "osesIrregularProgress"
    ], (result) => {
        const regular = result?.osesBlockEnrollmentRequest;
        const irregular = result?.osesIrregularEnrollmentRequest;
        const irregularProgress = result?.osesIrregularProgress;

        const regularActive = Boolean(regular?.isRegular === true && String(regular?.blockSection || "").trim());
        const irregularActive = Boolean(
            irregular?.isIrregular === true &&
            Array.isArray(irregular?.queue) &&
            irregular.queue.length > 0 &&
            irregularProgress?.status !== "completed"
        );

        if (regularActive && irregularActive) {
            // Irregular mode takes precedence when both are present.
            chrome.storage.local.set({ osesBlockEnrollmentRequest: null });
        }
    });
}

ensureAutomationModeConsistency();

function createRunId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeIrregularEnrollmentRequest(raw) {
    const source = raw || {};
    const studentTypeRaw = String(source.studentType || source.tag || "").trim().toLowerCase();
    const isIrregular = source.isIrregular === true || studentTypeRaw === "irregular";
    const queueRaw = Array.isArray(source.courses) ? source.courses : [];

    const queue = queueRaw
        .map((item, index) => {
            const courseCode = String(item?.courseCode || item?.code || "").trim().toUpperCase();
            const section = String(item?.section || item?.classSection || "").trim().toUpperCase();
            if (!courseCode || !section) return null;

            return {
                id: `${courseCode}__${section}__${index}`,
                courseCode,
                section,
                order: index,
                status: "pending",
                attempts: 0,
                lastError: ""
            };
        })
        .filter(Boolean);

    return {
        isIrregular,
        studentType: isIrregular ? "irregular" : (studentTypeRaw || "unknown"),
        queue,
        retryMode: source.retryMode === "retry_until_all" ? "retry_until_all" : "retry_once",
        requestedAt: Date.now(),
        runId: createRunId("irreg")
    };
}

function buildIrregularProgress(request) {
    return {
        runId: request.runId,
        status: "queued",
        total: request.queue.length,
        currentIndex: 0,
        added: [],
        missing: [],
        updatedAt: Date.now(),
        prompt: {
            showRetryChoice: false,
            defaultChoice: "retry_once"
        }
    };
}

function persistIrregularEnrollmentRequest(raw) {
    const normalized = normalizeIrregularEnrollmentRequest(raw);

    if (!normalized.isIrregular) {
        throw new Error("Student is not tagged as irregular. Irregular automation skipped.");
    }

    if (!normalized.queue.length) {
        throw new Error("Missing irregular course queue from app payload.");
    }

    const progress = buildIrregularProgress(normalized);

    chrome.storage.local.set({
        osesBlockEnrollmentRequest: null,
        osesIrregularEnrollmentRequest: normalized,
        osesIrregularProgress: progress,
        osesIrregularRetryMode: normalized.retryMode
    });

    return {
        request: normalized,
        progress
    };
}

function setIrregularRetryMode(mode) {
    const normalizedMode = mode === "retry_until_all" ? "retry_until_all" : "retry_once";
    chrome.storage.local.set({ osesIrregularRetryMode: normalizedMode });
    return normalizedMode;
}

function normalizeBlockEnrollmentRequest(raw) {
    const source = raw || {};
    const studentTypeRaw = String(source.studentType || source.tag || "").trim().toLowerCase();
    const isRegular = source.isRegular === true || studentTypeRaw === "regular";
    const blockSection = String(source.blockSection || source.block || "").trim().toUpperCase();

    return {
        isRegular,
        studentType: isRegular ? "regular" : (studentTypeRaw || "unknown"),
        blockSection,
        updatedAt: Date.now()
    };
}

function persistBlockEnrollmentRequest(raw) {
    const normalized = normalizeBlockEnrollmentRequest(raw);

    if (!normalized.isRegular) {
        throw new Error("Student is not tagged as regular. Block automation skipped.");
    }

    if (!normalized.blockSection) {
        throw new Error("Missing block section from app payload.");
    }

    chrome.storage.local.set({
        osesBlockEnrollmentRequest: normalized,
        osesIrregularEnrollmentRequest: null,
        osesIrregularProgress: null,
        osesIrregularRetryMode: null
    });
    return normalized;
}

async function runOSESRetryOnActiveTab() {
    const tabs = await queryTabsSafe({ active: true, currentWindow: true });
    const activeTab = tabs && tabs[0];

    if (!activeTab || typeof activeTab.id !== "number") {
        throw new Error("No active browser tab available.");
    }

    const url = activeTab.url || "";
    if (!url.includes("solar.feutech.edu.ph/course/registration")) {
        throw new Error("Open the Course Registration page before retrying.");
    }

    await sendTabMessageSafe(activeTab.id, { action: "startOSESAutomation" });
}

async function triggerIrregularEnrollmentOnRegistrationTab() {
    const tabs = await queryTabsSafe({ url: "https://solar.feutech.edu.ph/course/registration*" });
    const target = tabs.find((tab) => typeof tab.id === "number" && tab.active) || tabs.find((tab) => typeof tab.id === "number");

    if (!target || typeof target.id !== "number") {
        throw new Error("Open Course Registration page to run irregular auto-add.");
    }

    await sendTabMessageSafe(target.id, { action: "startIrregularEnrollment" });
}

async function triggerRegularEnrollmentOnRegistrationTab() {
    const tabs = await queryTabsSafe({ url: "https://solar.feutech.edu.ph/course/registration*" });
    const target = tabs.find((tab) => typeof tab.id === "number" && tab.active) || tabs.find((tab) => typeof tab.id === "number");

    if (!target || typeof target.id !== "number") {
        throw new Error("Open Course Registration page to run regular auto-add.");
    }

    await sendTabMessageSafe(target.id, { action: "startRegularBlockEnrollment" });
}

async function triggerGradeExtractionOnGradesTab() {
    const tabs = await queryTabsSafe({ url: "https://solar.feutech.edu.ph/student/grades*" });
    const target = tabs.find((tab) => typeof tab.id === "number" && tab.active) || tabs.find((tab) => typeof tab.id === "number");

    if (!target || typeof target.id !== "number") {
        throw new Error("Open the Student Grades page to run auto grade extraction.");
    }

    await sendTabMessageSafe(target.id, { action: "startGradeExtraction" });
}

function mergeGradeExtractionProgress(previousProgress, incomingProgress) {
    const prev = previousProgress || {};
    const incoming = incomingProgress || {};
    const status = String(incoming?.stage || incoming?.status || "").toLowerCase();
    const runChanged = Boolean(incoming?.runId) && String(incoming.runId) !== String(prev?.runId || "");

    // New run or active running update must not carry stale fields from prior runs.
    const resetForFreshRun = runChanged || status === "running";
    const base = resetForFreshRun
        ? {
            ...prev,
            stoppedAt: "",
            error: "",
            postedTargets: [],
            completedAt: 0
        }
        : prev;

    return {
        ...base,
        ...incoming,
        updatedAt: Date.now()
    };
}

function storeGradeExtractionProgress(progressUpdate, callback) {
    chrome.storage.local.get(["osesGradeExtractionProgress"], (result) => {
        const previous = result?.osesGradeExtractionProgress || {};
        const next = mergeGradeExtractionProgress(previous, progressUpdate);
        chrome.storage.local.set({ osesGradeExtractionProgress: next }, () => {
            if (typeof callback === "function") callback(next);
        });
    });
}

async function writeGradeAttemptsToTabLocalStorage(tabId, payload) {
    return new Promise((resolve) => {
        try {
            chrome.scripting.executeScript(
                {
                    target: { tabId },
                    func: (injectedPayload) => {
                        try {
                            const safeRead = (key, fallback) => {
                                try {
                                    const raw = localStorage.getItem(key);
                                    if (!raw) return fallback;
                                    const parsed = JSON.parse(raw);
                                    return parsed == null ? fallback : parsed;
                                } catch {
                                    return fallback;
                                }
                            };

                            const safeWrite = (key, value) => {
                                try {
                                    localStorage.setItem(key, JSON.stringify(value));
                                    return true;
                                } catch {
                                    return false;
                                }
                            };

                            const sourcePayload = injectedPayload || {};
                            const runId = String(sourcePayload?.runId || "").trim();
                            const attempts = Array.isArray(sourcePayload?.attempts) ? sourcePayload.attempts : [];
                            const extractedAt = Number(sourcePayload?.extractedAt || Date.now());
                            const summary = sourcePayload?.summary || null;

                            if (!runId || attempts.length === 0) {
                                return { success: false, message: "Invalid payload in injected writer." };
                            }

                            const latest = {
                                runId,
                                attempts,
                                summary,
                                extractedAt,
                                updatedAt: Date.now(),
                                source: "compareng-course-data-extractor-extension"
                            };

                            const previousHistory = safeRead("comparengGradeAttemptsHistory", []);
                            const history = Array.isArray(previousHistory) ? previousHistory : [];
                            history.unshift({
                                runId,
                                extractedCount: attempts.length,
                                attempts,
                                summary,
                                extractedAt,
                                updatedAt: Date.now()
                            });

                            const latestOk = safeWrite("comparengGradeAttemptsLatest", latest);
                            const historyOk = safeWrite("comparengGradeAttemptsHistory", history.slice(0, 30));
                            const legacyAttemptsOk = safeWrite("gradeAttempts", attempts);
                            const legacyPayloadOk = safeWrite("gradeAttemptsPayload", latest);

                            try {
                                window.dispatchEvent(new CustomEvent("compareng:gradeAttemptsUpdated", {
                                    detail: { runId, extractedCount: attempts.length, extractedAt }
                                }));
                            } catch {
                                // Ignore event dispatch issues.
                            }

                            try {
                                document.dispatchEvent(new CustomEvent("compareng:gradeAttemptsUpdated", {
                                    detail: { runId, extractedCount: attempts.length, extractedAt }
                                }));
                            } catch {
                                // Ignore event dispatch issues.
                            }

                            try {
                                window.postMessage(
                                    {
                                        source: "compareng-course-data-extractor-extension",
                                        type: "gradeAttemptsUpdated",
                                        detail: { runId, extractedCount: attempts.length, extractedAt }
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

                            if (!latestOk || !historyOk || !legacyAttemptsOk || !legacyPayloadOk) {
                                return { success: false, message: "Failed writing localStorage in injected writer." };
                            }

                            return {
                                success: true,
                                runId,
                                storedCount: attempts.length,
                                storageKeys: [
                                    "comparengGradeAttemptsLatest",
                                    "comparengGradeAttemptsHistory",
                                    "gradeAttempts",
                                    "gradeAttemptsPayload"
                                ]
                            };
                        } catch (error) {
                            return { success: false, message: error?.message || String(error) };
                        }
                    },
                    args: [payload]
                },
                (injectionResults) => {
                    const runtimeError = chrome.runtime.lastError;
                    if (runtimeError) {
                        resolve({ success: false, message: runtimeError.message || "Script injection failed." });
                        return;
                    }

                    const first = Array.isArray(injectionResults) ? injectionResults[0] : null;
                    const result = first?.result || { success: false, message: "No script result returned." };
                    resolve(result);
                }
            );
        } catch (error) {
            resolve({ success: false, message: error?.message || String(error) });
        }
    });
}

function normalizeGradeAttempts(rawAttempts) {
    const attempts = Array.isArray(rawAttempts) ? rawAttempts : [];
    const deduped = [];
    const seen = new Set();

    attempts.forEach((attempt) => {
        const courseCode = String(attempt?.courseCode || "").trim().toUpperCase();
        const finalGrade = String(attempt?.finalGrade || "").trim();
        const schoolYear = String(attempt?.schoolYear || "").trim();
        const portalTermLabel = String(attempt?.portalTermLabel || "").trim();
        const chronologicalIndex = Number(attempt?.chronologicalIndex || 0);

        if (!courseCode || !finalGrade) return;

        const key = `${courseCode}__${schoolYear.toLowerCase()}__${portalTermLabel.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);

        deduped.push({
            courseCode,
            finalGrade,
            schoolYear,
            portalTermLabel,
            chronologicalIndex
        });
    });

    return deduped.sort((a, b) => Number(a?.chronologicalIndex || 0) - Number(b?.chronologicalIndex || 0));
}

async function postGradeAttemptsToTargets(payload) {
    const webAppPatterns = [
        "http://localhost:3000/*",
        "http://127.0.0.1/*",
        "https://compareng-tools.vercel.app/*",
        "https://compareng-coursetracker.vercel.app/*"
    ];

    const tabsById = new Map();
    const tabCollections = await Promise.allSettled(
        webAppPatterns.map((pattern) => queryTabsSafe({ url: pattern }))
    );

    tabCollections.forEach((result) => {
        if (result.status !== "fulfilled") return;
        result.value.forEach((tab) => {
            if (typeof tab?.id !== "number") return;
            tabsById.set(tab.id, tab);
        });
    });

    const tabs = Array.from(tabsById.values());
    if (!tabs.length) {
        return [{
            url: "webapp-tabs",
            ok: false,
            response: null,
            error: "No ComParEng web app tab is open. Open the app first to receive grade data in localStorage."
        }];
    }

    const settled = await Promise.allSettled(
        tabs.map(async (tab) => {
            try {
                const response = await sendTabMessageSafe(tab.id, {
                    action: "storeGradeAttemptsInLocalStorage",
                    data: payload
                });

                if (response?.success) {
                    return { tab, response };
                }

                const fallback = await writeGradeAttemptsToTabLocalStorage(tab.id, payload);
                return { tab, response: fallback };
            } catch {
                const fallback = await writeGradeAttemptsToTabLocalStorage(tab.id, payload);
                return { tab, response: fallback };
            }
        })
    );

    return settled.map((result, index) => {
        const tab = tabs[index];
        const tabTarget = `${tab?.url || "tab"}#${tab?.id || "unknown"}`;

        if (result.status === "fulfilled") {
            return {
                url: tabTarget,
                ok: Boolean(result.value?.response?.success),
                response: result.value?.response || null,
                error: null
            };
        }

        return {
            url: tabTarget,
            ok: false,
            response: null,
            error: result.reason?.message || String(result.reason || "Unknown error")
        };
    });
}

function setAutomationControl(target, paused) {
    const isPaused = paused === true;

    if (target === "regular") {
        chrome.storage.local.set({ osesRegularAutoAddPaused: isPaused });
        return { target, paused: isPaused };
    }

    if (target === "irregular") {
        chrome.storage.local.set({ osesIrregularAutoAddPaused: isPaused });
        return { target, paused: isPaused };
    }

    if (target === "grades") {
        chrome.storage.local.set({ osesGradeExtractionPaused: isPaused });
        return { target, paused: isPaused };
    }

    throw new Error("Unknown automation target.");
}

function isTrustedExternalSenderUrl(rawUrl) {
    const senderUrl = String(rawUrl || "").trim();
    if (!senderUrl) return false;

    try {
        const parsed = new URL(senderUrl);
        const host = parsed.hostname.toLowerCase();
        const protocol = parsed.protocol.toLowerCase();

        if ((host === "localhost" || host === "127.0.0.1") && (protocol === "http:" || protocol === "https:")) {
            return true;
        }

        if (protocol === "https:" && (host === "compareng-tools.vercel.app" || host === "compareng-coursetracker.vercel.app" || host.endsWith(".vercel.app"))) {
            return true;
        }
    } catch {
        return false;
    }

    return false;
}

function mergeAutomationStatus(previousStatus, incomingStatus) {
    const prev = previousStatus || {};
    const incoming = incomingStatus || {};

    const merged = {
        ...prev,
        ...incoming,
        updatedAt: Date.now()
    };

    const incomingStudent = String(incoming?.studentNumber || "").trim();
    const previousStudent = String(prev?.studentNumber || "").trim();

    if (incomingStudent) {
        merged.studentNumber = incomingStudent;
    } else if (previousStudent) {
        merged.studentNumber = previousStudent;
    }

    return merged;
}

function storeAutomationStatus(statusUpdate, callback) {
    chrome.storage.local.get(["osesAutomationStatus"], (result) => {
        const previous = result?.osesAutomationStatus || {};
        const next = mergeAutomationStatus(previous, statusUpdate);
        chrome.storage.local.set({ osesAutomationStatus: next }, () => {
            if (typeof callback === "function") callback(next);
        });
    });
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "osesAutomationStatus") {
        const statusPayload = request.data || {};
        storeAutomationStatus(statusPayload);

        if (statusPayload.stage === "logged_in_verified") {
            chrome.storage.local.get(["osesIrregularEnrollmentRequest", "osesIrregularProgress"], (result) => {
                const irregRequest = result?.osesIrregularEnrollmentRequest;
                const irregProgress = result?.osesIrregularProgress;
                if (!irregRequest?.isIrregular) return;
                if (irregProgress?.status === "completed") return;

                triggerIrregularEnrollmentOnRegistrationTab().catch(() => {
                    // Keep status-only behavior safe when tab is not ready.
                });
            });
        }

        sendResponse({ success: true });
        return false;
    }

    if (request.action === "retryOSESAutomation") {
        runOSESRetryOnActiveTab()
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                sendResponse({ success: false, message: error?.message || String(error) });
            });

        return true;
    }

    if (request.action === "setOSESBlockEnrollmentRequest") {
        try {
            const saved = persistBlockEnrollmentRequest(request.data);
            sendResponse({ success: true, data: saved });
        } catch (error) {
            sendResponse({ success: false, message: error?.message || String(error) });
        }
        return false;
    }

    if (request.action === "setOSESIrregularEnrollmentRequest") {
        try {
            const saved = persistIrregularEnrollmentRequest(request.data);
            storeAutomationStatus({
                stage: "irregular_queue_received",
                message: `Received irregular queue with ${saved?.request?.queue?.length || 0} course section(s).`,
                source: "background"
            });
            sendResponse({ success: true, data: saved });
        } catch (error) {
            sendResponse({ success: false, message: error?.message || String(error) });
        }
        return false;
    }

    if (request.action === "setOSESIrregularRetryMode") {
        try {
            const mode = setIrregularRetryMode(request?.data?.mode);
            sendResponse({ success: true, data: { mode } });
        } catch (error) {
            sendResponse({ success: false, message: error?.message || String(error) });
        }
        return false;
    }

    if (request.action === "setAutomationControl") {
        try {
            const target = String(request?.data?.target || "").trim().toLowerCase();
            const paused = request?.data?.paused === true;
            const state = setAutomationControl(target, paused);

            if (!paused && target === "regular") {
                triggerRegularEnrollmentOnRegistrationTab()
                    .then(() => sendResponse({ success: true, data: state }))
                    .catch((error) => sendResponse({ success: false, message: error?.message || String(error) }));
                return true;
            }

            if (!paused && target === "irregular") {
                triggerIrregularEnrollmentOnRegistrationTab()
                    .then(() => sendResponse({ success: true, data: state }))
                    .catch((error) => sendResponse({ success: false, message: error?.message || String(error) }));
                return true;
            }

            if (!paused && target === "grades") {
                storeGradeExtractionProgress({
                    stage: "running",
                    status: "running",
                    stoppedAt: "",
                    error: "",
                    postedTargets: [],
                    extractedAttempts: [],
                    extractedCount: 0,
                    startedAt: Date.now()
                });
                triggerGradeExtractionOnGradesTab()
                    .then(() => sendResponse({ success: true, data: state }))
                    .catch((error) => sendResponse({ success: false, message: error?.message || String(error) }));
                return true;
            }

            sendResponse({ success: true, data: state });
        } catch (error) {
            sendResponse({ success: false, message: error?.message || String(error) });
        }
        return false;
    }

    if (request.action === "startOSESGradeExtraction") {
        storeGradeExtractionProgress({
            stage: "running",
            status: "running",
            stoppedAt: "",
            error: "",
            postedTargets: [],
            extractedAttempts: [],
            extractedCount: 0,
            startedAt: Date.now()
        });
        triggerGradeExtractionOnGradesTab()
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, message: error?.message || String(error) }));
        return true;
    }

    if (request.action === "osesGradeExtractionStatus") {
        const statusPayload = request.data || {};
        storeGradeExtractionProgress(statusPayload);
        sendResponse({ success: true });
        return false;
    }

    if (request.action === "gradeAttemptsExtracted") {
        const payload = request.data || {};
        const runId = String(payload?.runId || "").trim();
        const attempts = Array.isArray(payload?.attempts) ? payload.attempts : [];
        const normalizedAttempts = normalizeGradeAttempts(attempts);

        if (!runId || normalizedAttempts.length === 0) {
            sendResponse({ success: false, message: "Invalid grade extraction payload." });
            return false;
        }

        postGradeAttemptsToTargets({
            runId,
            attempts: normalizedAttempts,
            summary: payload?.summary || null,
            extractedAt: Number(payload?.extractedAt || Date.now())
        })
            .then((targets) => {
                const anySuccess = targets.some((item) => item.ok);
                const status = {
                    status: anySuccess ? "completed" : "error",
                    stage: anySuccess ? "completed" : "error",
                    extractedCount: normalizedAttempts.length,
                    extractedRawCount: attempts.length,
                    extractedAttempts: normalizedAttempts.slice(0, 600).map((attempt) => ({
                        courseCode: String(attempt?.courseCode || "").trim(),
                        finalGrade: String(attempt?.finalGrade || "").trim(),
                        schoolYear: String(attempt?.schoolYear || "").trim(),
                        portalTermLabel: String(attempt?.portalTermLabel || "").trim(),
                        chronologicalIndex: Number(attempt?.chronologicalIndex || 0)
                    })),
                    postedTargets: targets,
                    runId,
                    completedAt: Date.now(),
                    error: anySuccess ? "" : (targets.find((t) => t.error)?.error || "Failed to post grade attempts.")
                };

                storeGradeExtractionProgress(status, () => {
                    if (anySuccess) {
                        chrome.action.setBadgeText({ text: "OK" });
                        chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
                        try {
                            chrome.notifications.create({
                                type: "basic",
                                iconUrl: "images/icon128.png",
                                title: "Grade Extraction Complete",
                                message: `Extracted ${normalizedAttempts.length} attempt(s) and sent to ComParEng Tools.`
                            });
                        } catch {
                            // Notifications can fail on some Chromium builds.
                        }
                    } else {
                        chrome.action.setBadgeText({ text: "ERR" });
                        chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
                    }
                });

                sendResponse({
                    success: anySuccess,
                    targets,
                    extractedCount: normalizedAttempts.length,
                    extractedRawCount: attempts.length
                });
            })
            .catch((error) => {
                storeGradeExtractionProgress({
                    status: "error",
                    stage: "error",
                    error: error?.message || String(error),
                    runId,
                    completedAt: Date.now()
                });
                sendResponse({ success: false, message: error?.message || String(error) });
            });

        return true;
    }

    if (request.action === "retryOSESIrregularEnrollment") {
        triggerIrregularEnrollmentOnRegistrationTab()
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, message: error?.message || String(error) }));
        return true;
    }

    if (request.action === "courseDataExtracted") {
        const courseData = request.data; // Correctly access the data from request.data
        console.log("Received course data in background script:", courseData);

        if (!Array.isArray(courseData) || courseData.length === 0) {
            sendResponse({
                success: false,
                message: "No extracted course rows were received from the content script."
            });
            return false;
        }

        const missingTermYear = courseData.find((course) => {
            return !course || typeof course.term !== 'string' || !course.term.trim() || typeof course.schoolYear !== 'string' || !course.schoolYear.trim();
        });

        if (missingTermYear) {
            sendResponse({
                success: false,
                message: "Extraction incomplete: missing term/schoolYear from portal dropdowns. Check content script detection first."
            });
            return false;
        }

        const targets = [
            'http://localhost:3000/api/receive-course-data',
            'https://compareng-tools.vercel.app/api/receive-course-data'
        ];

        const localTarget = targets[0];
        const fetchedContext = {
            term: String(courseData[0]?.term || "").trim(),
            schoolYear: String(courseData[0]?.schoolYear || "").trim(),
            updatedAt: Date.now()
        };

        Promise.allSettled(targets.map(url => {
            return fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(courseData)
            }).then(response => {
                if (!response.ok) {
                    return response.text().then((bodyText) => {
                        throw new Error(`HTTP ${response.status} from ${url}: ${bodyText || "No response body"}`);
                    });
                }
                return response.json();
            }).then(data => ({ url, data }))
        }))
        .then(results => {
            const normalized = results.map((result, index) => {
                const url = targets[index];
                if (result.status === 'fulfilled') {
                    return {
                        url,
                        ok: Boolean(result.value?.data?.success),
                        response: result.value?.data || null,
                        error: null
                    };
                }

                return {
                    url,
                    ok: false,
                    response: null,
                    error: result.reason?.message || String(result.reason || 'Unknown error')
                };
            });

            console.log("Data send results by target:", normalized);

            const localResult = normalized.find(item => item.url === localTarget);
            if (localResult?.ok) {
                chrome.storage.local.set({ lastFetchedCourseContext: fetchedContext });
                sendResponse({ success: true, message: "Data sent to local API successfully.", targets: normalized });
                return;
            }

            const firstSuccess = normalized.find(item => item.ok);
            if (firstSuccess) {
                chrome.storage.local.set({ lastFetchedCourseContext: fetchedContext });
                sendResponse({ success: true, message: `Data sent successfully to ${firstSuccess.url}.`, targets: normalized });
                return;
            }

            const localError = localResult?.error || localResult?.response?.error;
            sendResponse({
                success: false,
                message: localError || "Failed to send data to all targets.",
                targets: normalized
            });
        });

        return true; // Indicate asynchronous response
    }
    return false;
});

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    const externalAction = request?.action;
    if (
        externalAction !== "setOSESBlockEnrollmentRequest" &&
        externalAction !== "setOSESIrregularEnrollmentRequest" &&
        externalAction !== "startOSESGradeExtraction"
    ) return false;

    const senderUrl = String(sender?.url || "");
    const trustedSender = isTrustedExternalSenderUrl(senderUrl);

    if (!trustedSender) {
        sendResponse({ success: false, message: `Untrusted sender for enrollment request: ${senderUrl || "unknown"}` });
        return false;
    }

    try {
        if (externalAction === "startOSESGradeExtraction") {
            triggerGradeExtractionOnGradesTab()
                .then(() => sendResponse({ success: true }))
                .catch((error) => sendResponse({ success: false, message: error?.message || String(error) }));
            return true;
        }

        if (externalAction === "setOSESIrregularEnrollmentRequest") {
            const saved = persistIrregularEnrollmentRequest(request.data);
            storeAutomationStatus({
                stage: "irregular_queue_received",
                message: `Received irregular queue with ${saved?.request?.queue?.length || 0} course section(s).`,
                source: "external"
            });
            sendResponse({ success: true, data: saved });
            return false;
        }

        const saved = persistBlockEnrollmentRequest(request.data);
        sendResponse({ success: true, data: saved });
    } catch (error) {
        sendResponse({ success: false, message: error?.message || String(error) });
    }

    return false;
});
