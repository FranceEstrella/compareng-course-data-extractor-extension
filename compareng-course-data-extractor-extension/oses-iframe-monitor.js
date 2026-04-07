(function attachOSESIframeMonitor(globalScope) {
  const FRAME_SELECTOR = "iframe[name='iframe'], iframe[src*='oses'], iframe[src*='enrollment'], iframe[src*='registration']";

  function findFrame() {
    return document.querySelector(FRAME_SELECTOR);
  }

  function waitForFrame(maxWaitMs) {
    return new Promise((resolve) => {
      const existing = findFrame();
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const frame = findFrame();
        if (!frame) return;
        observer.disconnect();
        resolve(frame);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, maxWaitMs);
    });
  }

  function waitForFrameReady(frame, maxWaitMs) {
    return new Promise((resolve) => {
      if (!frame) {
        resolve({ ready: false, reason: "frame-not-found" });
        return;
      }

      let finished = false;
      const onLoad = () => {
        if (finished) return;
        finished = true;
        frame.removeEventListener("load", onLoad);
        resolve({ ready: true, reason: "frame-load-event" });
      };

      frame.addEventListener("load", onLoad, { once: true });

      // Cross-origin frames cannot be introspected safely; use src presence as a fallback readiness signal.
      const src = (frame.getAttribute("src") || "").trim();
      if (src) {
        setTimeout(() => {
          if (finished) return;
          finished = true;
          frame.removeEventListener("load", onLoad);
          resolve({ ready: true, reason: "frame-src-detected" });
        }, 350);
      }

      setTimeout(() => {
        if (finished) return;
        finished = true;
        frame.removeEventListener("load", onLoad);
        resolve({ ready: false, reason: "frame-ready-timeout" });
      }, maxWaitMs);
    });
  }

  globalScope.OSESIFrameMonitor = {
    findFrame,
    waitForFrame,
    waitForFrameReady
  };
})(window);
