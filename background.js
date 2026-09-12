(function () {
  "use strict";

  var BADGE_COLOR_ACTIVE = "#ffffff"; // 纯白高对比度徽章
  var BADGE_COLOR_DISABLED = "#333338"; // 暗灰禁用
  var BADGE_TEXT_COLOR = "#000000"; // 纯黑文字

  function parseBadgeText(resolution, quality, qualityCap) {
    // 1. 如果有明确的生效分辨率（例如 "1920x1080"、"1280x720" 或纵向 "720x1280"）
    if (resolution && typeof resolution === "string") {
      var resMatch = resolution.match(/(\d+)\s*x\s*(\d+)/i);
      if (resMatch) {
        var w = parseInt(resMatch[1], 10);
        var h = parseInt(resMatch[2], 10);
        var shortSide = Math.min(w, h);
        if (shortSide >= 2160) return "4K";
        if (shortSide >= 1440) return "2K";
        if (shortSide >= 1080) return "1080";
        if (shortSide >= 720) return "720";
        if (shortSide >= 480) return "480";
        if (shortSide >= 360) return "360";
        if (shortSide > 0) return String(shortSide).slice(0, 4);
      }
    }

    // 2. 如果有 quality 字符串（例如 "1080p", "720p", "4K", "2K"）
    var raw = ((quality || "") + " " + (resolution || "")).trim();
    if (raw) {
      if (/2160|3840|\b4k\b/i.test(raw)) return "4K";
      if (/1440|2560|\b2k\b/i.test(raw)) return "2K";
      if (/1080|1920\b/i.test(raw)) return "1080";
      if (/720|1280\b/i.test(raw)) return "720";
      if (/480|854\b/i.test(raw)) return "480";
      if (/\b360p?\b/i.test(raw)) return "360";
      var match = raw.match(/(\d{3,4})p?/i);
      if (match && match[1]) {
        return match[1].slice(0, 4);
      }
    }

    // 3. 回退到用户当前选择的锁定档位 (qualityCap)
    var cap = String(qualityCap || "1080").toLowerCase();
    if (cap === "best") return "MAX";
    if (cap === "2160" || cap.indexOf("4k") !== -1) return "4K";
    if (cap === "1440" || cap.indexOf("2k") !== -1) return "2K";
    if (cap === "1080") return "1080";
    if (cap === "720") return "720";
    if (cap === "480") return "480";
    if (cap === "360") return "360";

    return "1080";
  }

  function updateBadgeFromStorage() {
    chrome.storage.local.get(
      ["enabled", "lastResolution", "lastQuality", "qualityCap"],
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

        var badgeText = parseBadgeText(data.lastResolution, data.lastQuality, data.qualityCap);
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
      changes.lastQuality !== undefined ||
      changes.qualityCap !== undefined
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
