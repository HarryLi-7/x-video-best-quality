(function () {
  "use strict";

  var BADGE_COLOR_ACTIVE = "#ffffff"; // 纯白高对比度徽章
  var BADGE_COLOR_DISABLED = "#333338"; // 暗灰禁用
  var BADGE_TEXT_COLOR = "#000000"; // 纯黑文字

  function parseBadgeText(resolution, quality) {
    var raw = (resolution || "") + " " + (quality || "");
    if (!raw.trim()) {
      return "";
    }

    if (/2160|3840|\b4k\b/i.test(raw)) {
      return "4K";
    }
    if (/1440|2560|\b2k\b/i.test(raw)) {
      return "2K";
    }
    if (/1080|1920\b/i.test(raw)) {
      return "1080";
    }
    if (/720|1280\b/i.test(raw)) {
      return "720";
    }
    if (/480|854\b/i.test(raw)) {
      return "480";
    }
    if (/360|640\b/i.test(raw)) {
      return "360";
    }

    var match = raw.match(/(\d{3,4})p?/i);
    if (match && match[1]) {
      return match[1];
    }

    return "HD";
  }

  function updateBadgeFromStorage() {
    chrome.storage.local.get(
      ["enabled", "lastResolution", "lastQuality"],
      function (data) {
        if (chrome.runtime.lastError || !data) {
          return;
        }

        if (data.enabled === false) {
          chrome.action.setBadgeText({ text: "OFF" });
          chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_DISABLED });
          if (chrome.action.setBadgeTextColor) {
            chrome.action.setBadgeTextColor({ color: "#ffffff" });
          }
          return;
        }

        var badgeText = parseBadgeText(data.lastResolution, data.lastQuality);
        chrome.action.setBadgeText({ text: badgeText });
        if (badgeText) {
          chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_ACTIVE });
          if (chrome.action.setBadgeTextColor) {
            chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
          }
        }
      }
    );
  }

  // 初始化 Badge 样式与状态
  chrome.runtime.onInstalled.addListener(function () {
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
    }
    updateBadgeFromStorage();
  });

  chrome.runtime.onStartup.addListener(function () {
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
    }
    updateBadgeFromStorage();
  });

  // 监听 Storage 变化实时刷新 Badge
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    if (
      changes.enabled !== undefined ||
      changes.lastResolution !== undefined ||
      changes.lastQuality !== undefined
    ) {
      updateBadgeFromStorage();
    }
  });

  // 监听来自 Popup 的下载等后台任务请求
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (!request || typeof request.type !== "string") {
      return;
    }

    if (request.type === "XVBQ_DOWNLOAD_STREAM") {
      var url = request.url;
      var filename = request.filename || "x-video-best-quality.m3u8";

      if (!url) {
        sendResponse({ success: false, error: "未检测到有效视频流地址" });
        return;
      }

      chrome.downloads.download(
        {
          url: url,
          filename: filename,
          saveAs: true
        },
        function (downloadId) {
          if (chrome.runtime.lastError) {
            sendResponse({
              success: false,
              error: chrome.runtime.lastError.message
            });
          } else {
            sendResponse({ success: true, downloadId: downloadId });
          }
        }
      );

      return true; // 异步响应
    }
  });
})();
