(function attachOSESSuccessVerifier(globalScope) {
  function extractStudentNumber(text) {
    if (!text) return "";
    const labeled = text.match(/student\s*(no\.|number|#)?\s*[:#-]?\s*(\d{8,12})/i);
    if (labeled && labeled[2]) return labeled[2];
    const match = text.match(/\b\d{8,12}\b/);
    return match ? match[0] : "";
  }

  function findTopRightContainer(root) {
    if (!root || !root.querySelector) return null;
    return root.querySelector("div.topright, .topright, #topright, .top-right, #top-right, [class*='topright'], [id*='topright']");
  }

  function extractFromLikelyContainers(root) {
    if (!root || !root.querySelectorAll) return "";

    const containers = Array.from(
      root.querySelectorAll(
        ".topright, #topright, .top-right, #top-right, [class*='student'], [id*='student'], .x-panel, .x-window"
      )
    );

    for (const container of containers) {
      const text = (container.textContent || "").trim();
      const studentNumber = extractStudentNumber(text);
      if (studentNumber) return studentNumber;
    }

    return "";
  }

  function verifySuccess(root) {
    const container = findTopRightContainer(root);

    if (container) {
      const text = (container.textContent || "").trim();
      const studentNumber = extractStudentNumber(text);

      if (studentNumber) {
        return {
          success: true,
          reason: "verified",
          studentNumber
        };
      }
    }

    const containerStudent = extractFromLikelyContainers(root);
    if (containerStudent) {
      return {
        success: true,
        reason: "verified-via-fallback-container",
        studentNumber: containerStudent
      };
    }

    const pageTextStudent = extractStudentNumber((root?.body?.textContent || root?.documentElement?.textContent || "").slice(0, 200000));
    if (pageTextStudent) {
      return {
        success: true,
        reason: "verified-via-page-text",
        studentNumber: pageTextStudent
      };
    }

    if (!container) {
      return {
        success: false,
        reason: "topright-not-found",
        studentNumber: ""
      };
    }

    const text = (container.textContent || "").trim();
    const studentNumber = extractStudentNumber(text);
    if (!studentNumber) {
      return {
        success: false,
        reason: "student-number-not-found",
        studentNumber: ""
      };
    }

    return {
      success: true,
      reason: "verified",
      studentNumber
    };
  }

  globalScope.OSESSuccessVerifier = {
    verifySuccess,
    extractStudentNumber
  };
})(window);
