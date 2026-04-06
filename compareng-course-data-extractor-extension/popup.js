console.log("Popup script loaded!");

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