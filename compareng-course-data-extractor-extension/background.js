console.log("Background script loaded! [build 1.0.1-term-year-fix]");

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
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
                sendResponse({ success: true, message: "Data sent to local API successfully.", targets: normalized });
                return;
            }

            const firstSuccess = normalized.find(item => item.ok);
            if (firstSuccess) {
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
