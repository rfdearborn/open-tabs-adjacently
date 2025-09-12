// ** Tab Restoration Logic **
// Stores
let activeTabIds = new Map();
let tabInfoCache = new Map();
let recentlyClosedTabs = new Map();

// On startup, track active tabs and cache tab info in all windows
chrome.tabs.query({}, (tabs) => {
  tabs.forEach(tab => {
    if (tab.active) {
      activeTabIds.set(tab.windowId, tab.id);
    }
    if (tab.url && tab.url !== 'chrome://newtab/') {
      tabInfoCache.set(tab.id, {
        url: tab.url,
        index: tab.index,
        windowId: tab.windowId,
        title: tab.title
      });
    }
  });
});

// Track active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabIds.set(activeInfo.windowId, activeInfo.tabId);
});

// Track tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url !== 'chrome://newtab/') {
    tabInfoCache.set(tabId, {
      url: tab.url,
      index: tab.index,
      windowId: tab.windowId,
      title: tab.title
    });
  }
});

// Track tab removals
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing && tabInfoCache.has(tabId)) {
    const tabInfo = tabInfoCache.get(tabId);
    // Only store non-chrome:// URLs for potential restore (chrome pages can't be restored)
    if (!tabInfo.url.startsWith('chrome://')) {
      recentlyClosedTabs.set(`${tabInfo.url}_${tabInfo.windowId}`, {
        url: tabInfo.url,
        windowId: tabInfo.windowId,
        index: tabInfo.index,
        timestamp: Date.now(),
        title: tabInfo.title
      });
    }
    tabInfoCache.delete(tabId);
  }
  
  // Clean up old entries
  const cutoffTime = Date.now() - (10 * 60 * 1000);
  for (const [key, info] of recentlyClosedTabs.entries()) {
    if (info.timestamp < cutoffTime) {
      recentlyClosedTabs.delete(key);
    }
  }
});

// ** Main New Tab Logic **
chrome.tabs.onCreated.addListener((tab) => {
  // Skip if this new tab is already the active tab (shouldn't happen, but safety check)
  const cachedActiveTabId = activeTabIds.get(tab.windowId);
  if (tab.id === cachedActiveTabId) {
    return;
  }
  
  // Check if this is a new tab without a meaningful URL (cmd-t case)
  if (!tab.url || tab.url === 'chrome://newtab/') {
    // This is a new tab, position it immediately
    positionTabToRightOfActive(tab.id, tab.windowId);
    return;
  }
  
  // For tabs with URLs (potential cmd-click or restored tabs), wait a moment
  setTimeout(() => {
    chrome.tabs.get(tab.id, (updatedTab) => {
      if (chrome.runtime.lastError) {
        return;
      }
      
      // Check if this might be a restored tab (cmd-shift-t)
      const restoredTabInfo = findPotentialRestoredTab(updatedTab);
      
      if (restoredTabInfo) {
        // This appears to be a restored tab, move it to its previous position
        chrome.tabs.move(tab.id, { 
          index: restoredTabInfo.index 
        });
        recentlyClosedTabs.delete(`${updatedTab.url}_${tab.windowId}`);
      } else if (updatedTab.openerTabId !== undefined) {
        // For cmd-click tabs, position to the right of active tab
        positionTabToRightOfActive(tab.id, tab.windowId);
      }
    });
  }, 100); // Small delay to allow URL to be set

});

// Helper function to position a tab to the right of the currently active tab
function positionTabToRightOfActive(tabId, windowId) {
  // First try the cached active tab ID
  const cachedActiveTabId = activeTabIds.get(windowId);
  
  if (cachedActiveTabId) {
    chrome.tabs.get(cachedActiveTabId, (activeTab) => {
      if (chrome.runtime.lastError || !activeTab) {
        // Cache is stale, fallback to querying for active tab
        queryAndPositionTab(tabId, windowId);
        return;
      }
      
      // Move the new tab to the right of the currently active tab
      const newIndex = activeTab.index + 1;
      chrome.tabs.move(tabId, { 
        index: newIndex 
      });
    });
  } else {
    // No cached active tab, query for it
    queryAndPositionTab(tabId, windowId);
  }
}

// Helper function to query for active tab and position new tab
function queryAndPositionTab(tabId, windowId) {
  chrome.tabs.query({ active: true, windowId: windowId }, (activeTabs) => {
    if (chrome.runtime.lastError || !activeTabs || activeTabs.length === 0) {
      return;
    }
    
    const activeTab = activeTabs[0];
    // Update our cache while we're at it
    activeTabIds.set(windowId, activeTab.id);
    
    // Move the new tab to the right of the currently active tab
    const newIndex = activeTab.index + 1;
    chrome.tabs.move(tabId, { 
      index: newIndex 
    });
  });
}

// Helper function to check if a new tab might be a restored tab
function findPotentialRestoredTab(tab) {
  // Chrome internal pages can't be restored with cmd-shift-t, so skip them
  if (!tab.url || tab.url.startsWith('chrome://')) {
    return null;
  }
  
  // Look for recently closed tabs that match this URL and window
  const key = `${tab.url}_${tab.windowId}`;
  const closedTabInfo = recentlyClosedTabs.get(key);
  
  if (closedTabInfo && Date.now() - closedTabInfo.timestamp < 10000) { // Within 10 seconds
    return {
      url: closedTabInfo.url,
      index: closedTabInfo.index
    };
  }
  
  return null;
}