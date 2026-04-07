console.log("Background script loaded! [build 1.1.0-oses-login-m1]");

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

    chrome.storage.local.set({ osesBlockEnrollmentRequest: normalized });
    return normalized;
}

async function runOSESRetryOnActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs && tabs[0];

    if (!activeTab || typeof activeTab.id !== "number") {
        throw new Error("No active browser tab available.");
    }

    const url = activeTab.url || "";
    if (!url.includes("solar.feutech.edu.ph/course/registration")) {
        throw new Error("Open the Course Registration page before retrying.");
    }

    await chrome.tabs.sendMessage(activeTab.id, { action: "startOSESAutomation" });
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "osesAutomationStatus") {
        const statusPayload = {
            ...(request.data || {}),
            updatedAt: Date.now()
        };

        chrome.storage.local.set({ osesAutomationStatus: statusPayload });
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
    if (request?.action !== "setOSESBlockEnrollmentRequest") return false;

    const senderUrl = String(sender?.url || "");
    const trustedSender = senderUrl.startsWith("https://compareng-tools.vercel.app/") || senderUrl.startsWith("http://localhost:3000/") || senderUrl.startsWith("https://compareng-coursetracker.vercel.app/");

    if (!trustedSender) {
        sendResponse({ success: false, message: "Untrusted sender for block enrollment request." });
        return false;
    }

    try {
        const saved = persistBlockEnrollmentRequest(request.data);
        sendResponse({ success: true, data: saved });
    } catch (error) {
        sendResponse({ success: false, message: error?.message || String(error) });
    }

    return false;
});
