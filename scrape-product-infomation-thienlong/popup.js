document.getElementById("openScanner").addEventListener("click", () => {
  window.open(chrome.runtime.getURL("scanner.html"), "_blank", "noopener,noreferrer");
});
