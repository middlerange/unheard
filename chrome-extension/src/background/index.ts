// ABOUTME: Background service worker — handles side panel toggle and context menu.
// ABOUTME: Listens for keyboard shortcut and extension icon click to open the side panel.

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-side-panel') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) {
        chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
          chrome.sidePanel.open({ windowId: tab.windowId });
        });
      }
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
      chrome.sidePanel.open({ windowId: tab.windowId });
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'content-hub-generate',
    title: 'Generate reply with Content Hub',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'content-hub-generate' && tab?.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});
