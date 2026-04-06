console.log("Content script loaded on course offerings page! [build 1.0.1-term-year-fix]");

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

const extractedCourses = extractCourseData();
console.log("Extracted Courses:", extractedCourses);
chrome.runtime.sendMessage({ action: "courseDataExtracted", data: extractedCourses });