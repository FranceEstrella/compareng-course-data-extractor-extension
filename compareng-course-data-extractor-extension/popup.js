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

const FORWARDED_BLOCK_SECTION_TTL_MS = 15 * 60 * 1000;

function safeRuntimeSendMessage(payload, callback) {
	try {
		if (!chrome?.runtime?.id) return false;
	} catch {
		return false;
	}

	try {
		chrome.runtime.sendMessage(payload, (response) => {
			const runtimeError = chrome.runtime.lastError;
			if (runtimeError) {
				// MV3 service worker can be unavailable briefly while reloading.
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

function syncPopupHeightToContent() {
	requestAnimationFrame(() => {
		const docEl = document.documentElement;
		const body = document.body;
		const container = document.querySelector(".container");
		if (!docEl || !body) return;

		// Reset first, then apply exact content height so the popup shrinks when sections are hidden.
		docEl.style.height = "auto";
		body.style.height = "auto";

		const containerHeight = container ? container.scrollHeight : 0;
		const contentHeight = Math.max(body.scrollHeight, docEl.scrollHeight, containerHeight);
		docEl.style.height = `${contentHeight}px`;
		body.style.height = `${contentHeight}px`;
	});
}

let popupResizeObserver = null;
let popupResizeTicking = false;

function queuePopupResizeSync() {
	if (popupResizeTicking) return;
	popupResizeTicking = true;
	requestAnimationFrame(() => {
		popupResizeTicking = false;
		syncPopupHeightToContent();
	});
}

function installDynamicPopupResize() {
	if (popupResizeObserver) return;

	const container = document.querySelector(".container");
	const developerSettings = document.getElementById("developer-settings");
	const targets = [document.documentElement, document.body, container, developerSettings].filter(Boolean);

	if (typeof ResizeObserver === "function") {
		popupResizeObserver = new ResizeObserver(() => {
			queuePopupResizeSync();
		});

		targets.forEach((el) => popupResizeObserver.observe(el));
	}

	if (developerSettings) {
		developerSettings.addEventListener("transitionend", queuePopupResizeSync);
	}

	window.addEventListener("resize", queuePopupResizeSync);
	queuePopupResizeSync();
}

function setNewFeaturesVisibility() {
	const osesStatusWrap = document.getElementById("oses-status-wrap");
	const osesInfoWrap = document.getElementById("oses-info-wrap");
	const irregularWrap = document.getElementById("irregular-wrap");
	const gradeImportWrap = document.getElementById("grade-import-wrap");
	const developerWrap = document.getElementById("developer-wrap");

	if (osesStatusWrap) osesStatusWrap.style.display = "";
	if (osesInfoWrap) osesInfoWrap.style.display = "";
	if (irregularWrap) irregularWrap.style.display = "";
	if (gradeImportWrap) gradeImportWrap.style.display = "";
	if (developerWrap) developerWrap.style.display = "";

	syncPopupHeightToContent();
}

function renderNewFeaturesGate() {
	setNewFeaturesVisibility();
}

function renderGradeExtractionStatus() {
	const summaryEl = document.getElementById("grade-import-summary");
	const listEl = document.getElementById("grade-import-list");
	if (!summaryEl || !listEl) return;

	chrome.storage.local.get(["osesGradeExtractionProgress"], (result) => {
		const progress = result?.osesGradeExtractionProgress || {};
		const status = String(progress?.stage || progress?.status || "idle").toLowerCase();
		const extractedCount = Number(progress?.extractedCount || 0);
		const extractedRawCount = Number(progress?.extractedRawCount || extractedCount || 0);
		const wasDeduped = extractedRawCount > extractedCount;
		const currentTerm = String(progress?.currentTermLabel || "").trim();
		const stoppedAt = String(progress?.stoppedAt || "").trim();
		const showCurrent = status === "running" && Boolean(currentTerm);
		const showStoppedAt = (status === "paused" || status === "error" || status === "completed") && Boolean(stoppedAt);

		const statusTone = status === "completed"
			? "status-completed"
			: status === "running"
				? "status-running"
				: status === "paused"
					? "status-paused"
					: "status-decision";

		summaryEl.innerHTML = `
			<div class="irreg-summary-line">
				<span class="irreg-summary-pill ${statusTone}">Status: ${status || "idle"}</span>
				<span class="irreg-summary-pill metric-added">Extracted: ${extractedCount}</span>
			</div>
			${wasDeduped ? `<div class="irreg-summary-line"><span class="irreg-summary-pill metric-skipped">Deduped from: ${extractedRawCount}</span></div>` : ""}
			${showCurrent ? `<div class="irreg-summary-line"><span class="irreg-summary-pill">Current: ${currentTerm}</span></div>` : ""}
			${showStoppedAt ? `<div class="irreg-summary-line"><span class="irreg-summary-pill metric-missing">Stopped at: ${stoppedAt}</span></div>` : ""}
		`;

		const attempts = Array.isArray(progress?.extractedAttempts) ? progress.extractedAttempts : [];
		const targets = Array.isArray(progress?.postedTargets) ? progress.postedTargets : [];
		if (!attempts.length && !targets.length) {
			listEl.className = "irregular-empty";
			listEl.textContent = "No completed grade import run yet.";
			return;
		}

		listEl.className = "";
		listEl.innerHTML = "";

		if (attempts.length) {
			const grouped = new Map();
			attempts.forEach((attempt) => {
				const schoolYear = String(attempt?.schoolYear || "Unknown School Year").trim() || "Unknown School Year";
				const termLabel = String(attempt?.portalTermLabel || "Unknown Term").trim() || "Unknown Term";
				const key = `${schoolYear}::${termLabel}`;
				if (!grouped.has(key)) grouped.set(key, { schoolYear, termLabel, items: [] });
				grouped.get(key).items.push(attempt);
			});

			Array.from(grouped.values()).forEach((group) => {
				const header = document.createElement("div");
				header.className = "irregular-course-row state-in-progress";

				const left = document.createElement("span");
				left.className = "irregular-course-code";
				left.textContent = `${group.termLabel} - ${group.schoolYear}`;

				const right = document.createElement("span");
				right.className = "irregular-course-status";
				right.textContent = `${group.items.length} item(s)`;

				header.appendChild(left);
				header.appendChild(right);
				listEl.appendChild(header);

				group.items
					.sort((a, b) => Number(a?.chronologicalIndex || 0) - Number(b?.chronologicalIndex || 0))
					.forEach((item) => {
						const row = document.createElement("div");
						row.className = "irregular-course-row state-added";

						const code = document.createElement("span");
						code.className = "irregular-course-code";
						code.textContent = String(item?.courseCode || "UNKNOWN");

						const grade = document.createElement("span");
						grade.className = "irregular-course-status";
						grade.textContent = `Grade ${String(item?.finalGrade || "-")}`;

						row.appendChild(code);
						row.appendChild(grade);
						listEl.appendChild(row);
					});
			});
		}

		if (targets.length) {
			const targetHeader = document.createElement("div");
			targetHeader.className = "irregular-course-row";

			const left = document.createElement("span");
			left.className = "irregular-course-code";
			left.textContent = "Post Targets";

			targetHeader.appendChild(left);
			listEl.appendChild(targetHeader);

			targets.forEach((target) => {
				const row = document.createElement("div");
				row.className = `irregular-course-row ${target?.ok ? "state-added" : "state-conflict"}`;

				const tLeft = document.createElement("span");
				tLeft.className = "irregular-course-code";
				// Always show a friendly status, never the direct URL
				let displayText = "Data sent successfully";
				if (typeof target?.url === "string") {
					const url = target.url.toLowerCase();
					if (url.includes("localhost") || url.includes("127.0.0.1") || url.includes("local")) {
						displayText = "Data sent successfully to local app";
					} else if (
						url.includes("prod") ||
						url.includes("live") ||
						url.includes("production") ||
						url.includes("vercel.app")
					) {
						displayText = "Data sent successfully to live app";
					}
				}
				tLeft.textContent = displayText;

				const tRight = document.createElement("span");
				tRight.className = "irregular-course-status";
				tRight.textContent = target?.ok ? "Posted" : "Failed";

				row.appendChild(tLeft);
				row.appendChild(tRight);
				listEl.appendChild(row);
			});
		}
	});
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

function renderCourseUploadStatus() {
	const statusEl = document.getElementById("status");
	if (!statusEl) return;

	chrome.storage.local.get(["lastCourseUploadStatus"], (result) => {
		const upload = result?.lastCourseUploadStatus || {};
		const state = String(upload?.state || "idle").toLowerCase();
		let message = String(upload?.message || "").trim();

		if (/^data sent successfully to\s+https?:\/\//i.test(message)) {
			const lower = message.toLowerCase();
			const isLocal = lower.includes("localhost") || lower.includes("127.0.0.1") || lower.includes("local");
			message = isLocal ? "Data sent successfully to local app." : "Data sent successfully to live app.";
		}

		if (!message) {
			statusEl.textContent = "Running in the background...";
			statusEl.style.color = "#90ee90";
			return;
		}

		statusEl.textContent = message;
		if (state === "error") {
			statusEl.style.color = "#fecaca";
			return;
		}

		if (state === "posting") {
			statusEl.style.color = "#bfdbfe";
			return;
		}

		statusEl.style.color = "#90ee90";
	});
}

function renderOfferingsRefreshStatus() {
	const refreshEl = document.getElementById("offerings-refresh-status");
	if (!refreshEl) return;

	chrome.storage.local.get(["lastCourseUploadStatus", "osesOfferingsAutoRefreshEnabled", "osesOfferingsAutoRefreshStatus"], (result) => {
		const upload = result?.lastCourseUploadStatus || {};
		const uploadState = String(upload?.state || "idle").toLowerCase();
		const refreshEnabled = result?.osesOfferingsAutoRefreshEnabled === true;
		const refreshStatus = result?.osesOfferingsAutoRefreshStatus || {};
		const refreshState = String(refreshStatus?.state || "").toLowerCase();
		const nextRefreshAt = Number(refreshStatus?.nextRefreshAt || 0);

		if (uploadState !== "success") {
			refreshEl.textContent = "";
			return;
		}

		if (!refreshEnabled) {
			refreshEl.textContent = "Auto-refresh: Off";
			return;
		}

		if (refreshState === "refreshing") {
			refreshEl.textContent = "Auto-refresh: Refreshing now...";
			return;
		}

		if (refreshState === "scheduled" && Number.isFinite(nextRefreshAt) && nextRefreshAt > 0) {
			const seconds = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
			refreshEl.textContent = `Auto-refresh in ${seconds}s`;
			return;
		}

		refreshEl.textContent = "Auto-refresh: Waiting for next successful fetch";
	});
}

function clearIrregularQueue() {
	chrome.storage.local.set({
		osesIrregularEnrollmentRequest: null,
		osesIrregularProgress: null,
		osesIrregularRetryMode: null
	}, () => {
		renderOSESInfo();
		renderIrregularStatus();
		renderIrregularCourseList();
	});
}

document.addEventListener("DOMContentLoaded", renderFetchedStatus);
document.addEventListener("DOMContentLoaded", renderCourseUploadStatus);
document.addEventListener("DOMContentLoaded", renderOfferingsRefreshStatus);

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
		const updatedAt = Number(regularRequest?.updatedAt || 0);
		const hasValidUpdatedAt = Number.isFinite(updatedAt) && updatedAt > 0;
		const isExpired = hasValidUpdatedAt ? (Date.now() - updatedAt) > FORWARDED_BLOCK_SECTION_TTL_MS : Boolean(blockSection);

		if (isRegular && blockSection && isExpired) {
			forwardedSectionEl.textContent = "None";
			chrome.storage.local.set({ osesBlockEnrollmentRequest: null });
			return;
		}

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
		const isOn = result?.osesDeveloperMode === true;
		modeEl.textContent = isOn ? "ON" : "OFF";
		modeEl.style.color = isOn ? "#86efac" : "#fca5a5";
		toggle.checked = isOn;
		wrap.classList.toggle("collapsed", !isOn);
		syncPopupHeightToContent();
	});
}

function setDeveloperModeEnabled(enabled) {
	const isOn = enabled === true;
	const regularPaused = isOn;
	const irregularPaused = isOn;
	const gradesPaused = isOn;
	const offeringsAutoRefreshEnabled = !isOn;

	chrome.storage.local.set({
		osesDeveloperMode: isOn,
		osesRegularAutoAddPaused: regularPaused,
		osesIrregularAutoAddPaused: irregularPaused,
		osesGradeExtractionPaused: gradesPaused,
		osesOfferingsAutoRefreshEnabled: offeringsAutoRefreshEnabled
	}, () => {
		renderDeveloperMode();
		renderAutomationControls();
		renderIrregularStatus();
		renderGradeExtractionStatus();
		renderOSESStatus();
		syncPopupHeightToContent();
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
	const gradesBtn = document.getElementById("grades-toggle");
	const offeringsRefreshBtn = document.getElementById("offerings-refresh-toggle");
	if (!regularBtn || !irregularBtn || !gradesBtn || !offeringsRefreshBtn) return;

	chrome.storage.local.get(["osesRegularAutoAddPaused", "osesIrregularAutoAddPaused", "osesGradeExtractionPaused", "osesOfferingsAutoRefreshEnabled"], (result) => {
		const regularPaused = result?.osesRegularAutoAddPaused === true;
		const irregularPaused = result?.osesIrregularAutoAddPaused === true;
		const gradesPaused = result?.osesGradeExtractionPaused === true;
		const offeringsAutoRefreshEnabled = result?.osesOfferingsAutoRefreshEnabled === true;
		applyControlButtonState(regularBtn, regularPaused);
		applyControlButtonState(irregularBtn, irregularPaused);
		applyControlButtonState(gradesBtn, gradesPaused);
		offeringsRefreshBtn.textContent = offeringsAutoRefreshEnabled ? "On" : "Off";
		offeringsRefreshBtn.className = `control-toggle ${offeringsAutoRefreshEnabled ? "running" : "paused"}`;
	});
}

function toggleOfferingsAutoRefresh() {
	chrome.storage.local.get(["osesOfferingsAutoRefreshEnabled"], (result) => {
		const enabled = result?.osesOfferingsAutoRefreshEnabled === true;
		chrome.storage.local.set({ osesOfferingsAutoRefreshEnabled: !enabled }, () => {
			renderAutomationControls();
		});
	});
}

function toggleAutomationControl(target) {
	const key = target === "regular"
		? "osesRegularAutoAddPaused"
		: target === "irregular"
			? "osesIrregularAutoAddPaused"
			: "osesGradeExtractionPaused";
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
			renderGradeExtractionStatus();
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
	installDynamicPopupResize();
	renderNewFeaturesGate();
	renderOSESStatus();
	renderOSESInfo();
	renderIrregularStatus();
	renderIrregularCourseList();
	renderGradeExtractionStatus();
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

	const irregularClearBtn = document.getElementById("irregular-clear");
	if (irregularClearBtn) {
		irregularClearBtn.addEventListener("click", clearIrregularQueue);
	}

	const regularToggleBtn = document.getElementById("regular-toggle");
	if (regularToggleBtn) {
		regularToggleBtn.addEventListener("click", () => toggleAutomationControl("regular"));
	}

	const irregularToggleBtn = document.getElementById("irregular-toggle");
	if (irregularToggleBtn) {
		irregularToggleBtn.addEventListener("click", () => toggleAutomationControl("irregular"));
	}

	const gradesToggleBtn = document.getElementById("grades-toggle");
	if (gradesToggleBtn) {
		gradesToggleBtn.addEventListener("click", () => toggleAutomationControl("grades"));
	}

	const offeringsRefreshToggleBtn = document.getElementById("offerings-refresh-toggle");
	if (offeringsRefreshToggleBtn) {
		offeringsRefreshToggleBtn.addEventListener("click", toggleOfferingsAutoRefresh);
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

	if (changes.osesGradeExtractionProgress) {
		renderGradeExtractionStatus();
	}

	if (changes.osesRegularAutoAddPaused || changes.osesIrregularAutoAddPaused || changes.osesGradeExtractionPaused || changes.osesOfferingsAutoRefreshEnabled || changes.osesDeveloperMode) {
		renderDeveloperMode();
		renderAutomationControls();
	}

	if (changes.lastCourseUploadStatus || changes.lastFetchedCourseContext) {
		renderCourseUploadStatus();
		renderOfferingsRefreshStatus();
		renderFetchedStatus();
	}

	if (changes.osesOfferingsAutoRefreshEnabled || changes.osesOfferingsAutoRefreshStatus) {
		renderAutomationControls();
		renderOfferingsRefreshStatus();
	}

});

setInterval(renderOfferingsRefreshStatus, 1000);
setInterval(renderOSESInfo, 30000);