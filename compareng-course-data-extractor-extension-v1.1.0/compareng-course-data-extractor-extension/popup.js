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
	irregular_queue_received: "Irregular queue received.",
	regular_paused: "Regular auto-add is paused.",
	irregular_started: "Irregular auto-add started.",
	irregular_processing: "Processing irregular course queue...",
	irregular_section_not_found: "Section not found in expanded course group.",
	irregular_add_clicked: "Add Course clicked.",
	irregular_confirmed: "Add confirmation accepted.",
	irregular_add_success_dialog: "Add success dialog detected.",
	irregular_add_failed_dialog: "Add failure dialog detected.",
	irregular_already_registered_skipped: "Course already in Registered Courses. Skipped.",
	irregular_section_conflict_skipped: "Section conflict found in Registered Courses. Skipped.",
	irregular_max_units_skipped: "Maximum units reached. Course skipped.",
	irregular_verifying_added: "Verifying added course in registered list...",
	irregular_verified_added: "Course verified in registered list.",
	irregular_paused: "Irregular auto-add is paused.",
	irregular_retry_prompt: "Choose a retry mode to continue.",
	irregular_completed: "Irregular auto-add completed.",
	failed: "Failed."
};

const STAGE_LABELS = {
	detecting_iframe: "Detecting",
	waiting_oses: "Waiting",
	login_button_clicked: "Login Clicked",
	logged_in_verified: "Verified",
	opening_block_window: "Opening",
	block_selected: "Selected",
	registering_block: "Registering",
	block_registration_submitted: "Submitted",
	confirming_block: "Confirming",
	block_confirmation_accepted: "Completed",
	irregular_queue_received: "Queued",
	regular_paused: "Paused",
	irregular_started: "Irregular",
	irregular_processing: "Irregular",
	irregular_section_not_found: "Section",
	irregular_add_clicked: "Irregular",
	irregular_confirmed: "Irregular",
	irregular_add_success_dialog: "Success",
	irregular_add_failed_dialog: "Failed",
	irregular_already_registered_skipped: "Skipped",
	irregular_section_conflict_skipped: "Conflict",
	irregular_max_units_skipped: "Skipped",
	irregular_verifying_added: "Verifying",
	irregular_verified_added: "Verified",
	irregular_paused: "Paused",
	irregular_retry_prompt: "Decision",
	irregular_completed: "Completed",
	failed: "Failed"
};

const WAITING_STAGES = new Set([
	"detecting_iframe",
	"waiting_oses",
	"login_button_clicked",
	"opening_block_window",
	"registering_block",
	"confirming_block",
	"irregular_queue_received",
	"irregular_started",
	"irregular_processing",
	"irregular_section_not_found",
	"irregular_add_clicked",
	"irregular_confirmed",
	"irregular_add_success_dialog",
	"irregular_already_registered_skipped",
	"irregular_section_conflict_skipped",
	"irregular_max_units_skipped",
	"irregular_verifying_added",
	"regular_paused",
	"irregular_paused",
	"irregular_retry_prompt"
]);

const SUCCESS_STAGES = new Set([
	"logged_in_verified",
	"block_selected",
	"block_registration_submitted",
	"block_confirmation_accepted",
	"irregular_completed"
]);

function safeRuntimeSendMessage(payload, callback) {
	try {
		chrome.runtime.sendMessage(payload, (response) => {
			const runtimeError = chrome.runtime.lastError;
			if (runtimeError) {
				if (typeof callback === "function") callback({ success: false, message: runtimeError.message, runtimeError: true });
				return;
			}

			if (typeof callback === "function") callback(response);
		});
		return true;
	} catch (error) {
		if (typeof callback === "function") callback({ success: false, message: error?.message || String(error), runtimeError: true });
		return false;
	}
}

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
	const rawMessage = String(status.message || "")
		.replace(/OSES session verified via student number in topright\.?/gi, "")
		.replace(/Choose retry mode in popup\.?/gi, "Choose a retry mode to continue.")
		.replace(/\s+/g, " ")
		.trim();
	const isDuplicate = rawMessage && rawMessage.toLowerCase() === String(base).toLowerCase();
	const suffix = rawMessage && !isDuplicate ? ` ${rawMessage}` : "";
	const reason = status.stage === "failed" && status.reason ? ` (${status.reason})` : "";

	return `${base}${suffix}${reason}`.trim();
}

function getStageTone(stage) {
	if (!stage) return "";
	if (stage === "failed") return "error";
	if (SUCCESS_STAGES.has(stage)) return "success";
	if (WAITING_STAGES.has(stage)) return "waiting";
	return "";
}

function formatUpdatedAt(timestamp) {
	if (!timestamp) return "Updated: --";
	const value = Number(timestamp);
	if (!Number.isFinite(value) || value <= 0) return "Updated: --";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Updated: --";
	return `Updated: ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function renderStageMeta(status) {
	const stagePill = document.getElementById("oses-stage-pill");
	const updatedEl = document.getElementById("oses-status-updated");
	if (!stagePill || !updatedEl) return;

	const stage = status?.stage || "";
	const label = STAGE_LABELS[stage] || (stage ? stage.replace(/_/g, " ") : "Idle");
	const tone = getStageTone(stage);

	stagePill.textContent = label;
	stagePill.className = `stage-pill${tone ? ` ${tone}` : ""}`;
	updatedEl.textContent = formatUpdatedAt(status?.updatedAt);
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
		const studentNumber = String(status?.studentNumber || "").trim();
		statusText.textContent = formatOSESStatus(status);
		renderStageMeta(status);
		retryButton.disabled = !canRetry(status);
		retryButton.style.display = studentNumber ? "none" : "";
	});
}

function renderOSESInfo() {
	const studentNumberEl = document.getElementById("oses-student-number");
	const forwardedSectionEl = document.getElementById("oses-forwarded-section");
	if (!studentNumberEl || !forwardedSectionEl) return;

	chrome.storage.local.get(["osesAutomationStatus", "osesBlockEnrollmentRequest", "osesIrregularEnrollmentRequest", "osesIrregularProgress"], (result) => {
		const status = result?.osesAutomationStatus || {};
		const regularRequest = result?.osesBlockEnrollmentRequest || {};
		const irregularRequest = result?.osesIrregularEnrollmentRequest || {};
		const irregularProgress = result?.osesIrregularProgress || {};

		const studentNumber = String(status?.studentNumber || "").trim();
		studentNumberEl.textContent = studentNumber || "Not detected";

		const irregularActive = Boolean(
			irregularRequest?.isIrregular === true &&
			Array.isArray(irregularRequest?.queue) &&
			irregularRequest.queue.length > 0 &&
			irregularProgress?.status !== "completed"
		);

		if (irregularActive) {
			forwardedSectionEl.textContent = "None";
			return;
		}

		const isRegular = regularRequest?.isRegular === true || String(regularRequest?.studentType || "").toLowerCase() === "regular";
		const blockSection = String(regularRequest?.blockSection || "").trim().toUpperCase();
		forwardedSectionEl.textContent = isRegular && blockSection ? blockSection : "None";
	});
}

function renderIrregularCourseList() {
	const listEl = document.getElementById("irregular-course-list");
	if (!listEl) return;

	chrome.storage.local.get(["osesIrregularEnrollmentRequest", "osesIrregularProgress"], (result) => {
		const request = result?.osesIrregularEnrollmentRequest;
		const progress = result?.osesIrregularProgress || {};
		const queue = Array.isArray(request?.queue) ? request.queue : [];
		const added = Array.isArray(progress?.added) ? progress.added : [];
		const skipped = Array.isArray(progress?.skipped) ? progress.skipped : [];
		const conflicts = Array.isArray(progress?.conflicts) ? progress.conflicts : [];
		const missing = Array.isArray(progress?.missing) ? progress.missing : [];
		const isRunning = String(progress?.status || "") === "running";
		const currentIndex = Math.max(0, Number(progress?.currentIndex || 0) - 1);

		const keyFor = (courseCode, section) => `${String(courseCode || "").trim().toUpperCase()}__${String(section || "").trim().toUpperCase()}`;
		const toMap = (items, state) => {
			const map = new Map();
			items.forEach((item) => {
				const key = keyFor(item?.courseCode, item?.section);
				if (key !== "__") map.set(key, state);
			});
			return map;
		};

		const stateMap = new Map([
			...toMap(missing, "missing"),
			...toMap(conflicts, "conflict"),
			...toMap(skipped, "skipped"),
			...toMap(added, "added")
		]);

		const stateLabel = {
			"in-progress": "In Progress",
			added: "Done",
			skipped: "Skipped",
			conflict: "Conflict",
			missing: "Missing",
			pending: "Pending"
		};

		listEl.innerHTML = "";

		if (!request?.isIrregular || queue.length === 0) {
			listEl.className = "irregular-empty";
			listEl.textContent = "No irregular courses queued.";
			return;
		}

		listEl.className = "";
		queue.forEach((item, index) => {
			const row = document.createElement("div");

			const courseCodeText = String(item?.courseCode || "").trim().toUpperCase() || "UNKNOWN";
			const sectionText = String(item?.section || "").trim().toUpperCase() || "N/A";
			const itemKey = keyFor(courseCodeText, sectionText);
			let state = stateMap.get(itemKey) || "pending";

			if (state === "pending" && isRunning && index === currentIndex) {
				state = "in-progress";
			}

			row.className = `irregular-course-row state-${state}`;

			const courseCode = document.createElement("span");
			courseCode.className = "irregular-course-code";
			courseCode.textContent = courseCodeText;

			const section = document.createElement("span");
			section.className = "irregular-course-section";
			section.textContent = sectionText;

			const status = document.createElement("span");
			status.className = "irregular-course-status";
			status.textContent = stateLabel[state] || "Pending";

			row.appendChild(courseCode);
			row.appendChild(section);
			row.appendChild(status);
			listEl.appendChild(row);
		});
	});
}

function renderIrregularSummary(summaryEl, progress) {
	if (!summaryEl) return;
	if (!progress) {
		summaryEl.textContent = "No irregular run queued.";
		return;
	}

	const rawStatus = String(progress.status || "queued").toLowerCase();
	const statusLabel = rawStatus.replace(/_/g, " ");
	const current = Number(progress.currentIndex || 0);
	const total = Number(progress.total || 0);
	const safeCurrent = Math.min(Math.max(current, 0), Math.max(total, 0));
	const percent = total > 0 ? Math.round((safeCurrent / total) * 100) : 0;
	const added = Array.isArray(progress.added) ? progress.added.length : 0;
	const skipped = Array.isArray(progress.skipped) ? progress.skipped.length : 0;
	const conflicts = Array.isArray(progress.conflicts) ? progress.conflicts.length : 0;
	const missing = Array.isArray(progress.missing) ? progress.missing.length : 0;

	let statusTone = "status-decision";
	if (rawStatus === "running") statusTone = "status-running";
	else if (rawStatus === "paused") statusTone = "status-paused";
	else if (rawStatus === "completed") statusTone = "status-completed";

	summaryEl.innerHTML = `
		<div class="irreg-summary-line">
			<span class="irreg-summary-pill ${statusTone}">Status: ${statusLabel}</span>
			<span class="irreg-summary-pill">Progress: ${safeCurrent}/${total} (${percent}%)</span>
		</div>
		<div class="irreg-summary-line">
			<span class="irreg-summary-pill metric-added">Added: ${added}</span>
			<span class="irreg-summary-pill metric-skipped">Skipped: ${skipped}</span>
			<span class="irreg-summary-pill metric-conflicts">Conflicts: ${conflicts}</span>
			<span class="irreg-summary-pill metric-missing">Missing: ${missing}</span>
		</div>
	`;
}

function setIrregularButtonsEnabled(enabled) {
	const retryOnceBtn = document.getElementById("irregular-retry-once");
	const retryUntilAllBtn = document.getElementById("irregular-retry-until-all");
	if (retryOnceBtn) retryOnceBtn.disabled = !enabled;
	if (retryUntilAllBtn) retryUntilAllBtn.disabled = !enabled;
}

function renderIrregularStatus() {
	const summaryEl = document.getElementById("irregular-summary");
	if (!summaryEl) return;

	chrome.storage.local.get(["osesIrregularProgress"], (result) => {
		const progress = result?.osesIrregularProgress;
		renderIrregularSummary(summaryEl, progress);

		const showPrompt = Boolean(progress?.prompt?.showRetryChoice);
		setIrregularButtonsEnabled(showPrompt);
	});
}

function runIrregularRetry(mode) {
	setIrregularButtonsEnabled(false);
	safeRuntimeSendMessage({ action: "setOSESIrregularRetryMode", data: { mode } }, (setModeRes) => {
		if (!setModeRes?.success) {
			renderIrregularStatus();
			return;
		}

		safeRuntimeSendMessage({ action: "retryOSESIrregularEnrollment" }, () => {
			renderIrregularStatus();
		});
	});
}

function renderDeveloperMode() {
	const modeEl = document.getElementById("developer-mode-value");
	const wrap = document.getElementById("developer-wrap");
	const toggle = document.getElementById("developer-mode-toggle");
	if (!modeEl || !wrap || !toggle) return;

	chrome.storage.local.get(["osesDeveloperMode"], (result) => {
		const isOn = result?.osesDeveloperMode !== false;
		modeEl.textContent = isOn ? "ON" : "OFF";
		modeEl.style.color = isOn ? "#86efac" : "#fca5a5";
		toggle.checked = isOn;
		wrap.classList.toggle("collapsed", !isOn);
	});
}

function setDeveloperModeEnabled(enabled) {
	const isOn = enabled === true;
	const regularPaused = isOn;
	const irregularPaused = isOn;

	chrome.storage.local.set({
		osesDeveloperMode: isOn,
		osesRegularAutoAddPaused: regularPaused,
		osesIrregularAutoAddPaused: irregularPaused
	}, () => {
		renderDeveloperMode();
		renderAutomationControls();
		renderIrregularStatus();
		renderOSESStatus();
	});
}

function applyControlButtonState(button, paused) {
	if (!button) return;
	button.textContent = paused ? "Start" : "Pause";
	button.className = `control-toggle ${paused ? "paused" : "running"}`;
}

function renderAutomationControls() {
	const regularBtn = document.getElementById("regular-toggle");
	const irregularBtn = document.getElementById("irregular-toggle");
	if (!regularBtn || !irregularBtn) return;

	chrome.storage.local.get(["osesRegularAutoAddPaused", "osesIrregularAutoAddPaused"], (result) => {
		const regularPaused = result?.osesRegularAutoAddPaused === true;
		const irregularPaused = result?.osesIrregularAutoAddPaused === true;
		applyControlButtonState(regularBtn, regularPaused);
		applyControlButtonState(irregularBtn, irregularPaused);
	});
}

function toggleAutomationControl(target) {
	const key = target === "regular" ? "osesRegularAutoAddPaused" : "osesIrregularAutoAddPaused";
	chrome.storage.local.get([key], (result) => {
		const currentlyPaused = result?.[key] === true;
		safeRuntimeSendMessage({
			action: "setAutomationControl",
			data: {
				target,
				paused: !currentlyPaused
			}
		}, () => {
			renderAutomationControls();
			renderOSESStatus();
			renderIrregularStatus();
		});
	});
}

function runOSESRetry() {
	const retryButton = document.getElementById("oses-retry");
	if (retryButton) retryButton.disabled = true;

	safeRuntimeSendMessage({ action: "retryOSESAutomation" }, (response) => {
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
	renderIrregularStatus();
	renderIrregularCourseList();
	renderDeveloperMode();
	renderAutomationControls();

	const retryButton = document.getElementById("oses-retry");
	if (retryButton) {
		retryButton.addEventListener("click", runOSESRetry);
	}

	const retryOnceBtn = document.getElementById("irregular-retry-once");
	if (retryOnceBtn) {
		retryOnceBtn.addEventListener("click", () => runIrregularRetry("retry_once"));
	}

	const retryUntilAllBtn = document.getElementById("irregular-retry-until-all");
	if (retryUntilAllBtn) {
		retryUntilAllBtn.addEventListener("click", () => runIrregularRetry("retry_until_all"));
	}

	const regularToggleBtn = document.getElementById("regular-toggle");
	if (regularToggleBtn) {
		regularToggleBtn.addEventListener("click", () => toggleAutomationControl("regular"));
	}

	const irregularToggleBtn = document.getElementById("irregular-toggle");
	if (irregularToggleBtn) {
		irregularToggleBtn.addEventListener("click", () => toggleAutomationControl("irregular"));
	}

	const developerModeToggle = document.getElementById("developer-mode-toggle");
	if (developerModeToggle) {
		developerModeToggle.addEventListener("change", (event) => {
			setDeveloperModeEnabled(Boolean(event?.target?.checked));
		});
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

	if (changes.osesIrregularEnrollmentRequest || changes.osesIrregularProgress) {
		renderOSESInfo();
		renderIrregularCourseList();
	}

	if (changes.osesIrregularProgress || changes.osesIrregularRetryMode) {
		renderIrregularStatus();
	}

	if (changes.osesRegularAutoAddPaused || changes.osesIrregularAutoAddPaused || changes.osesDeveloperMode) {
		renderDeveloperMode();
		renderAutomationControls();
	}
});