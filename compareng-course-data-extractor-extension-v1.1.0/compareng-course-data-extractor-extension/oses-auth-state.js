(function attachOSESAuthState(globalScope) {
  function detectLoginForm(root) {
    if (!root || !root.querySelector) return false;

    const selectors = [
      "input[type='password']",
      "input[name*='password' i]",
      "input[id*='password' i]",
      "button[type='submit']",
      "form"
    ];

    return selectors.some((selector) => Boolean(root.querySelector(selector)));
  }

  function getAuthState(root) {
    const verifier = globalScope.OSESSuccessVerifier;
    if (!verifier || typeof verifier.verifySuccess !== "function") {
      return {
        state: "unknown",
        reason: "verifier-missing",
        studentNumber: ""
      };
    }

    const verification = verifier.verifySuccess(root);
    if (verification.success) {
      return {
        state: "authenticated",
        reason: verification.reason,
        studentNumber: verification.studentNumber
      };
    }

    if (detectLoginForm(root)) {
      return {
        state: "unauthenticated",
        reason: "login-form-detected",
        studentNumber: ""
      };
    }

    return {
      state: "unknown",
      reason: verification.reason,
      studentNumber: ""
    };
  }

  globalScope.OSESAuthState = {
    getAuthState
  };
})(window);
