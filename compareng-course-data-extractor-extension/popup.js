console.log("Popup script loaded!");

const STAGE_MESSAGES = {
	detecting_iframe: "Detecting OSES iframe...",
	waiting_oses: "Waiting for OSES content...",
	login_button_clicked: "OSES Login button auto-clicked.",
	logged_in_verified: "Logged in verified.",
	opening_block_window: "Opening block section window...",
	block_selected: "Block section selected.",
	registering_block: "Registering selected block...",
	block_registration_submitted: "Register Block clicked.",
	confirming_block: "Waiting for confirmation dialog...",
	block_confirmation_accepted: "Confirmation dialog accepted.",
	failed: "Failed."
};

function renderFetchedStatus() {
	const fetchedStatus = document.getElementById("fetched-status");
	if (!fetchedStatus) return;

	chrome.storage.local.get(["lastFetchedCourseContext"], (result) => {
		const context = result?.lastFetchedCourseContext;
		const term = context?.term || "";
		const schoolYear = context?.schoolYear || "";

		fetchedStatus.innerHTML = "";

		if (term && schoolYear) {
			const title = document.createElement("div");
			title.className = "fetched-title";
			title.textContent = "Fetched Course Data For";

			const row = document.createElement("div");
			row.className = "fetched-row";

			const termPill = document.createElement("span");
			termPill.className = "fetched-pill term";
			termPill.textContent = term;

			const schoolYearPill = document.createElement("span");
			schoolYearPill.className = "fetched-pill school-year";
			schoolYearPill.textContent = schoolYear;

			row.appendChild(termPill);
			row.appendChild(schoolYearPill);
			fetchedStatus.appendChild(title);
			fetchedStatus.appendChild(row);
			return;
		}

		const empty = document.createElement("div");
		empty.className = "fetched-empty";
		empty.textContent = "No fetched data yet.";
		fetchedStatus.appendChild(empty);
	});
}

document.addEventListener("DOMContentLoaded", renderFetchedStatus);

function formatOSESStatus(status) {
	if (!status || !status.stage) return "No OSES status yet.";

	const base = STAGE_MESSAGES[status.stage] || `State: ${status.stage}`;
	const suffix = status.message ? ` ${status.message}` : "";
	const student = status.studentNumber ? ` Student #: ${status.studentNumber}` : "";

	return `${base}${suffix}${student}`.trim();
}

function canRetry(status) {
	if (!status || !status.stage) return true;
	return status.stage !== "detecting_iframe" && status.stage !== "waiting_oses";
}

function renderOSESStatus() {
	const statusText = document.getElementById("oses-status-text");
	const retryButton = document.getElementById("oses-retry");
	if (!statusText || !retryButton) return;

	chrome.storage.local.get(["osesAutomationStatus"], (result) => {
		const status = result?.osesAutomationStatus;
		statusText.textContent = formatOSESStatus(status);
		retryButton.disabled = !canRetry(status);
	});
}

function renderOSESInfo() {
	const studentNumberEl = document.getElementById("oses-student-number");
	const forwardedSectionEl = document.getElementById("oses-forwarded-section");
	if (!studentNumberEl || !forwardedSectionEl) return;

	chrome.storage.local.get(["osesAutomationStatus", "osesBlockEnrollmentRequest"], (result) => {
		const status = result?.osesAutomationStatus || {};
		const request = result?.osesBlockEnrollmentRequest || {};

		const studentNumber = String(status?.studentNumber || "").trim();
		studentNumberEl.textContent = studentNumber || "Not detected";

		const isRegular = request?.isRegular === true || String(request?.studentType || "").toLowerCase() === "regular";
		const blockSection = String(request?.blockSection || "").trim().toUpperCase();
		forwardedSectionEl.textContent = isRegular && blockSection ? blockSection : "None";
	});
}

function runOSESRetry() {
	const retryButton = document.getElementById("oses-retry");
	if (retryButton) retryButton.disabled = true;

	chrome.runtime.sendMessage({ action: "retryOSESAutomation" }, (response) => {
		if (chrome.runtime.lastError) {
			const statusText = document.getElementById("oses-status-text");
			if (statusText) statusText.textContent = `Retry failed: ${chrome.runtime.lastError.message}`;
			renderOSESStatus();
			return;
		}

		if (!response?.success) {
			const statusText = document.getElementById("oses-status-text");
			if (statusText) statusText.textContent = `Retry failed: ${response?.message || "Unknown error"}`;
			renderOSESStatus();
			return;
		}

		renderOSESStatus();
	});
}

document.addEventListener("DOMContentLoaded", () => {
	renderOSESStatus();
	renderOSESInfo();

	const retryButton = document.getElementById("oses-retry");
	if (retryButton) {
		retryButton.addEventListener("click", runOSESRetry);
	}
});

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local") return;
	if (changes.osesAutomationStatus) {
		renderOSESStatus();
		renderOSESInfo();
	}

	if (changes.osesBlockEnrollmentRequest) {
		renderOSESInfo();
	}
});