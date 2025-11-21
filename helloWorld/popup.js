// Helper to run code in the active tab
function runInActiveTab(code) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: code
      });
    }
  });
}

// Open camera view in new tab
document.getElementById("openCamera").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("camera.html") });
});

// Scroll Up
document.getElementById("scrollUp").addEventListener("click", () => {
  runInActiveTab(() => window.scrollBy(0, -500));
});

// Scroll Down
document.getElementById("scrollDown").addEventListener("click", () => {
  runInActiveTab(() => window.scrollBy(0, 500));
});

// Close Current Tab
document.getElementById("closeTab").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.remove(tabs[0].id);
  });
});
