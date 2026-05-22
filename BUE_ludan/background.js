async function enableActionSidePanel() {
  if (!chrome.sidePanel || !chrome.sidePanel.setPanelBehavior) return;

  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
}

chrome.runtime.onInstalled.addListener(() => {
  enableActionSidePanel().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  enableActionSidePanel().catch(console.error);
});

chrome.action.onClicked.addListener((tab) => {
  if (!chrome.sidePanel || !chrome.sidePanel.open || !tab.windowId) return;

  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});
