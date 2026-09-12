(function () {
  "use strict";

  if (window.__XVBQ_BRIDGE_INSTALLED__) {
    return;
  }

  Object.defineProperty(window, "__XVBQ_BRIDGE_INSTALLED__", {
    value: true,
    writable: false,
    configurable: false
  });

  var MESSAGE_TARGET_ORIGIN = window.location.origin;
  var MESSAGE_FLAG = "__xvbq";
  var TYPE_SETTINGS = "XVBQ_SETTINGS";
  var TYPE_PAGEHOOK_READY = "XVBQ_PAGEHOOK_READY";
  var TYPE_QUALITY_SELECTED = "XVBQ_QUALITY_SELECTED";
  var TYPE_AUTHOR_SELECTED = "XVBQ_AUTHOR_SELECTED";
  var TYPE_ERROR = "XVBQ_ERROR";

  var DEFAULTS = {
    enabled: true,
    debug: false,
    qualityCap: "1080",
    lastAuthorName: "",
    lastTweetUrl: "",
    lastAuthorUpdatedAt: 0,
    lastQuality: "",
    lastResolution: "",
    lastBandwidth: 0,
    lastBandwidthText: "",
    lastVariantCount: 0,
    lastUpdatedAt: 0,
    lastSelectedReason: "",
    lastError: "",
    lastStreamUrl: "",
    preferredSpeed: 1.0,
    blockAds: true,
    forceOrigImages: true,
    cleanLinks: true,
    hideSidebarPromos: true
  };

  var QUALITY_CAP_DEFAULT = "1080";
  var QUALITY_CAP_VALUES = {
    best: true,
    "2160": true,
    "1440": true,
    "1080": true,
    "720": true,
    "480": true,
    "360": true
  };

  function normalizeQualityCap(value) {
    if (typeof value !== "string") {
      return QUALITY_CAP_DEFAULT;
    }

    return QUALITY_CAP_VALUES[value] ? value : QUALITY_CAP_DEFAULT;
  }

  function formatBandwidth(bandwidth) {
    if (!Number.isFinite(bandwidth) || bandwidth <= 0) {
      return "";
    }

    if (bandwidth >= 1000000) {
      return formatDecimal(bandwidth / 1000000) + " Mbps";
    }

    if (bandwidth >= 1000) {
      return formatDecimal(bandwidth / 1000) + " Kbps";
    }

    return String(Math.round(bandwidth)) + " bps";
  }

  function formatDecimal(value) {
    return value.toFixed(1).replace(/\.0$/, "");
  }

  function postToPage(type, payload) {
    window.postMessage(
      {
        sender: "xvbq-bridge",
        type: type,
        payload: payload || null,
        __xvbq: true
      },
      MESSAGE_TARGET_ORIGIN
    );
  }

  function postSettings(settings) {
    postToPage(TYPE_SETTINGS, {
      enabled: settings.enabled !== false,
      debug: settings.debug === true,
      qualityCap: normalizeQualityCap(settings.qualityCap)
    });
  }

  function getSettings(callback) {
    chrome.storage.local.get(
      {
        enabled: DEFAULTS.enabled,
        debug: DEFAULTS.debug,
        qualityCap: DEFAULTS.qualityCap
      },
      function (result) {
        callback({
          enabled: result.enabled !== false,
          debug: result.debug === true,
          qualityCap: normalizeQualityCap(result.qualityCap)
        });
      }
    );
  }

  function initializeDefaults() {
    chrome.storage.local.get(
      ["enabled", "debug", "qualityCap", "lastAuthorName", "lastTweetUrl", "lastAuthorUpdatedAt"],
      function (result) {
      var nextState = {};

      if (typeof result.enabled !== "boolean") {
        nextState.enabled = DEFAULTS.enabled;
      }

      if (typeof result.debug !== "boolean") {
        nextState.debug = DEFAULTS.debug;
      }

      if (normalizeQualityCap(result.qualityCap) !== result.qualityCap) {
        nextState.qualityCap = DEFAULTS.qualityCap;
      }

      if (typeof result.lastAuthorName !== "string") {
        nextState.lastAuthorName = DEFAULTS.lastAuthorName;
      }

      if (typeof result.lastTweetUrl !== "string") {
        nextState.lastTweetUrl = DEFAULTS.lastTweetUrl;
      }

      if (!Number.isFinite(result.lastAuthorUpdatedAt) || result.lastAuthorUpdatedAt < 0) {
        nextState.lastAuthorUpdatedAt = DEFAULTS.lastAuthorUpdatedAt;
      }

      if (Object.keys(nextState).length > 0) {
        chrome.storage.local.set(nextState);
      }
    });
  }

  function sanitizeText(value, maxLength) {
    if (typeof value !== "string") {
      return "";
    }

    return value.slice(0, maxLength).trim();
  }

  function sanitizeNumber(value) {
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }

    return Math.round(value);
  }

  function persistQualitySelection(payload) {
    var lastBandwidth = sanitizeNumber(payload && payload.lastBandwidth);
    var lastBandwidthText = sanitizeText(payload && payload.lastBandwidthText, 32);

    if (!lastBandwidthText) {
      lastBandwidthText = formatBandwidth(lastBandwidth);
    }

    var lastStreamUrl = sanitizeText(payload && payload.lastStreamUrl, 2048);

    chrome.storage.local.set({
      lastSelectedReason: sanitizeText(payload && payload.lastSelectedReason, 32),
      lastQuality: sanitizeText(payload && payload.lastQuality, 32),
      lastResolution: sanitizeText(payload && payload.lastResolution, 32),
      lastBandwidth: lastBandwidth,
      lastBandwidthText: lastBandwidthText,
      lastVariantCount: sanitizeNumber(payload && payload.lastVariantCount),
      lastStreamUrl: lastStreamUrl,
      lastUpdatedAt: Date.now(),
      lastError: ""
    });
  }

  function persistAuthorSelection(payload) {
    var lastAuthorName = sanitizeText(payload && payload.lastAuthorName, 80);
    var lastTweetUrl = sanitizeText(payload && payload.lastTweetUrl, 500);

    if (!lastAuthorName) {
      return;
    }

    chrome.storage.local.set({
      lastAuthorName: lastAuthorName,
      lastTweetUrl: lastTweetUrl,
      lastAuthorUpdatedAt: Date.now()
    });
  }

  function persistError(payload) {
    var message = sanitizeText(payload && payload.message, 200);

    if (!message) {
      return;
    }

    chrome.storage.local.set({
      lastError: message
    });
  }

  function handleWindowMessage(event) {
    if (event.source !== window) {
      return;
    }

    var data = event.data;
    if (!data || data[MESSAGE_FLAG] !== true || typeof data.type !== "string") {
      return;
    }

    if (data.sender !== "xvbq-pagehook") {
      return;
    }

    if (data.type === TYPE_PAGEHOOK_READY) {
      getSettings(function (settings) {
        postSettings(settings);
      });
      return;
    }

    if (data.type === TYPE_QUALITY_SELECTED) {
      persistQualitySelection(data.payload || {});
      return;
    }

    if (data.type === TYPE_AUTHOR_SELECTED) {
      persistAuthorSelection(data.payload || {});
      return;
    }

    if (data.type === TYPE_ERROR) {
      persistError(data.payload || {});
    }
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    if (!changes.enabled && !changes.debug && !changes.qualityCap) {
      return;
    }

    getSettings(function (settings) {
      postSettings(settings);
    });
  }

  function findActiveVideo() {
    var videos = Array.prototype.slice.call(document.querySelectorAll("video"));
    if (videos.length === 0) {
      return null;
    }

    // 优先匹配当前正在播放且准备就绪的视频
    for (var i = 0; i < videos.length; i += 1) {
      if (!videos[i].paused && videos[i].readyState > 2) {
        return videos[i];
      }
    }

    // 其次匹配当前屏幕可视区域内的视频
    for (var j = 0; j < videos.length; j += 1) {
      var rect = videos[j].getBoundingClientRect();
      if (
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        return videos[j];
      }
    }

    return videos[0];
  }

  // 监听来自 Popup 的播放控制指令
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (!request || typeof request.type !== "string") {
      return;
    }

    var video = findActiveVideo();

    if (request.type === "XVBQ_TOGGLE_PIP") {
      if (document.pictureInPictureElement) {
        document
          .exitPictureInPicture()
          .then(function () {
            sendResponse({ success: true, isPip: false });
          })
          .catch(function (err) {
            sendResponse({ success: false, error: err.message });
          });
        return true;
      }

      if (!video) {
        sendResponse({ success: false, error: "页面中未发现可用的视频元素" });
        return;
      }

      video
        .requestPictureInPicture()
        .then(function () {
          sendResponse({ success: true, isPip: true });
        })
        .catch(function (err) {
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    if (request.type === "XVBQ_SET_SPEED") {
      var speed = Number(request.speed) || 1.0;
      if (video) {
        video.playbackRate = speed;
      }

      // 将偏好倍速持久化
      chrome.storage.local.set({ preferredSpeed: speed });
      sendResponse({ success: true, speed: speed });
      return;
    }

    if (request.type === "XVBQ_GET_PLAYBACK_STATUS") {
      sendResponse({
        success: true,
        hasVideo: !!video,
        isPlaying: video ? !video.paused : false,
        isPip: !!document.pictureInPictureElement,
        playbackRate: video ? video.playbackRate : 1.0
      });
      return;
    }
  });

  // 当用户在 X 时间线滚动播放新视频时，自动应用用户偏好的自定义倍速
  document.addEventListener(
    "play",
    function (event) {
      if (event.target && event.target.tagName === "VIDEO") {
        chrome.storage.local.get(["preferredSpeed"], function (res) {
          if (
            res &&
            typeof res.preferredSpeed === "number" &&
            res.preferredSpeed > 0 &&
            res.preferredSpeed !== 1.0
          ) {
            event.target.playbackRate = res.preferredSpeed;
          }
        });
      }
    },
    true
  );

  // ==========================================
  // X 深度生态增强引擎（广告过滤、图片原画、纯净链接）
  // ==========================================

  var adStylesInjected = false;
  function injectEnhancementStyles() {
    if (adStylesInjected || document.getElementById("xvbq-enhancement-styles")) {
      return;
    }
    var style = document.createElement("style");
    style.id = "xvbq-enhancement-styles";
    style.textContent = [
      ".xvbq-hidden-ad { display: none !important; }",
      ".xvbq-hidden-promo { display: none !important; }",
      ".xvbq-orig-download-btn {",
      "  position: absolute;",
      "  top: 10px;",
      "  right: 10px;",
      "  z-index: 9999;",
      "  background: rgba(10, 10, 12, 0.9);",
      "  border: 1px solid rgba(255, 255, 255, 0.25);",
      "  color: #fff;",
      "  border-radius: 999px;",
      "  padding: 5px 12px;",
      "  font-size: 11px;",
      "  font-weight: 700;",
      "  cursor: pointer;",
      "  backdrop-filter: blur(12px);",
      "  box-shadow: 0 4px 16px rgba(0,0,0,0.6);",
      "  opacity: 0;",
      "  pointer-events: none;",
      "  transform: translateY(-4px);",
      "  transition: opacity 180ms ease, transform 180ms ease, background 160ms ease, border-color 160ms ease;",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 5px;",
      "  user-select: none;",
      "}",
      ".xvbq-modal-download-btn {",
      "  top: 14px;",
      "  right: 64px;",
      "}",
      ".xvbq-orig-download-btn.xvbq-visible,",
      ".xvbq-orig-download-btn:hover {",
      "  opacity: 1 !important;",
      "  pointer-events: auto !important;",
      "  transform: translateY(0) !important;",
      "}",
      ".xvbq-orig-download-btn:hover {",
      "  background: #ffffff;",
      "  color: #000000;",
      "  border-color: #ffffff;",
      "  box-shadow: 0 4px 20px rgba(255, 255, 255, 0.25);",
      "}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
    adStylesInjected = true;
  }

  var AD_PATTERNS = /^(Ad|Promoted|赞助|推广|贊助|Anzeige|Publicité|Patrocinado|プロモーション|프로모션)$/i;

  function runAdCleaner(enabled) {
    if (!enabled) {
      document.querySelectorAll(".xvbq-hidden-ad").forEach(function (el) {
        el.classList.remove("xvbq-hidden-ad");
      });
      return;
    }

    var articles = document.querySelectorAll("article[data-testid='tweet']");
    for (var i = 0; i < articles.length; i += 1) {
      var art = articles[i];
      if (art.classList.contains("xvbq-hidden-ad")) {
        continue;
      }

      var spans = art.querySelectorAll("span");
      var isAd = false;
      for (var s = 0; s < spans.length; s += 1) {
        var txt = (spans[s].textContent || "").trim();
        if (AD_PATTERNS.test(txt)) {
          isAd = true;
          break;
        }
      }

      if (isAd) {
        art.classList.add("xvbq-hidden-ad");
        var cell = art.closest("[data-testid='cellInnerDiv']");
        if (cell) {
          cell.classList.add("xvbq-hidden-ad");
        }
      }
    }
  }

  function runSidebarCleaner(enabled) {
    if (!enabled) {
      document.querySelectorAll(".xvbq-hidden-promo").forEach(function (el) {
        el.classList.remove("xvbq-hidden-promo");
      });
      return;
    }

    var asideSelectors = [
      "[data-testid='sidebarColumn'] aside[aria-label*='Premium']",
      "[data-testid='sidebarColumn'] aside[aria-label*='Subscribe']",
      "[data-testid='sidebarColumn'] aside[aria-label*='订阅']",
      "[data-testid='sidebarColumn'] aside[aria-label*='Who to follow']",
      "[data-testid='sidebarColumn'] aside[aria-label*='推荐关注']"
    ];

    asideSelectors.forEach(function (sel) {
      var elements = document.querySelectorAll(sel);
      elements.forEach(function (el) {
        el.classList.add("xvbq-hidden-promo");
      });
    });
  }

  function convertToOrigImageUrl(url) {
    if (typeof url !== "string" || url.indexOf("pbs.twimg.com/media/") === -1) {
      return url;
    }
    try {
      var u = new URL(url);
      u.searchParams.set("name", "large");
      return u.toString();
    } catch (e) {
      return url.replace(/name=[a-z0-9_]+/i, "name=large");
    }
  }

  function setupPhotoHover(container, img, isModal) {
    var downloadBtn = container.querySelector(".xvbq-orig-download-btn");
    if (!downloadBtn) {
      downloadBtn = document.createElement("button");
      downloadBtn.className = "xvbq-orig-download-btn" + (isModal ? " xvbq-modal-download-btn" : "");
      downloadBtn.innerHTML = "<span>💾</span><span>下载此张原图</span>";
      downloadBtn.title = "下载此张高清原画照片";
      downloadBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var downloadUrl = convertToOrigImageUrl(img.src);
        var filename = "x-photo-orig-" + Date.now() + ".jpg";
        chrome.runtime.sendMessage({
          type: "XVBQ_DOWNLOAD_STREAM",
          url: downloadUrl,
          filename: filename
        });
      });
      container.appendChild(downloadBtn);
    }

    if (!container.dataset.xvbqHoverBound) {
      container.dataset.xvbqHoverBound = "true";

      container.addEventListener(
        "mousemove",
        function (e) {
          var currentBtn = container.querySelector(".xvbq-orig-download-btn");
          if (!currentBtn) {
            return;
          }
          var rect = container.getBoundingClientRect();
          var relX = e.clientX - rect.left;
          var relY = e.clientY - rect.top;
          // 仅在鼠标靠近右上角时唤出（或鼠标悬浮在按钮本体上）
          var triggerW = isModal ? 240 : Math.min(180, Math.max(90, rect.width * 0.38));
          var triggerH = isModal ? 120 : Math.min(120, Math.max(70, rect.height * 0.38));
          var inTopRight = (rect.width - relX <= triggerW) && (relY <= triggerH);

          if (inTopRight || currentBtn.contains(e.target)) {
            currentBtn.classList.add("xvbq-visible");
          } else {
            currentBtn.classList.remove("xvbq-visible");
          }
        },
        { passive: true }
      );

      container.addEventListener("mouseleave", function () {
        var currentBtn = container.querySelector(".xvbq-orig-download-btn");
        if (currentBtn) {
          currentBtn.classList.remove("xvbq-visible");
        }
      });
    }
  }

  function runImageEnhancer(enabled) {
    if (!enabled) {
      document.querySelectorAll(".xvbq-orig-download-btn").forEach(function (btn) {
        btn.remove();
      });
      return;
    }

    // 绝不直接篡改页面活体 img.src 与 img.srcset，确保 Twitter 原生图片流畅正常加载与大图预览
    var images = document.querySelectorAll("img[src*='pbs.twimg.com/media/']");
    images.forEach(function (img) {
      // 1. 全屏大图查看器 (Modal/Lightbox)
      var modalContainer = img.closest("[aria-modal='true'], [role='dialog']");
      if (modalContainer) {
        setupPhotoHover(modalContainer, img, true);
      } else {
        // 2. 推文时间线配图卡片 (tweetPhoto)
        var photoContainer = img.closest("[data-testid='tweetPhoto']");
        if (photoContainer) {
          setupPhotoHover(photoContainer, img, false);
        }
      }
    });
  }

  // 支持 Alt + 单击 任意推文配图直接保存此张原图
  document.addEventListener(
    "click",
    function (e) {
      if (e.altKey && e.target && e.target.tagName === "IMG") {
        var src = e.target.getAttribute("src");
        if (src && src.indexOf("pbs.twimg.com/media/") !== -1) {
          e.preventDefault();
          e.stopPropagation();
          var origUrl = convertToOrigImageUrl(src);
          chrome.runtime.sendMessage({
            type: "XVBQ_DOWNLOAD_STREAM",
            url: origUrl,
            filename: "x-photo-orig-" + Date.now() + ".jpg"
          });
        }
      }
    },
    true
  );

  function runLinkCleaner(enabled) {
    if (!enabled) {
      return;
    }

    // 扫描还原推文内的 t.co 外链
    var tcoLinks = document.querySelectorAll("a[href*='//t.co/']");
    tcoLinks.forEach(function (a) {
      if (a.getAttribute("data-xvbq-cleaned")) {
        return;
      }

      var realUrl = a.getAttribute("title") || "";
      if (!realUrl || realUrl.indexOf("http") !== 0) {
        var text = (a.textContent || "").trim();
        if (/^https?:\/\//.test(text) || (text.indexOf(".") !== -1 && text.indexOf(" ") === -1)) {
          realUrl = text.indexOf("http") === 0 ? text : "https://" + text;
        }
      }

      if (realUrl && realUrl.indexOf("http") === 0) {
        a.href = realUrl;
        a.setAttribute("data-xvbq-cleaned", "true");
      }
    });
  }

  // 剪贴板复制去追踪（复制推文分享链接时自动剥除 ?s=20&t=...）
  document.addEventListener(
    "copy",
    function (e) {
      chrome.storage.local.get(["cleanLinks"], function (res) {
        if (res && res.cleanLinks === false) {
          return;
        }

        var selection = window.getSelection() ? window.getSelection().toString() : "";
        if (
          selection &&
          /https?:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/i.test(selection)
        ) {
          var cleaned = selection.replace(/(\/status\/\d+)\?[^\s]*/, "$1");
          if (cleaned !== selection && e.clipboardData) {
            e.preventDefault();
            e.clipboardData.setData("text/plain", cleaned);
          }
        }
      });
    },
    false
  );

  // 拦截对 t.co 的点击，直接跳往真实地址
  document.addEventListener(
    "click",
    function (e) {
      var anchor = e.target.closest ? e.target.closest("a") : null;
      if (!anchor) {
        return;
      }

      var href = anchor.getAttribute("href") || "";
      if (href.indexOf("//t.co/") !== -1) {
        var realTarget = anchor.getAttribute("title");
        if (realTarget && realTarget.indexOf("http") === 0) {
          e.preventDefault();
          e.stopPropagation();
          window.open(realTarget, anchor.target || "_blank", "noopener,noreferrer");
        }
      }
    },
    true
  );

  // 统一执行页面扫描
  var enhancerTimer = null;
  function executeEnhancers() {
    chrome.storage.local.get(
      ["blockAds", "hideSidebarPromos", "forceOrigImages", "cleanLinks"],
      function (res) {
        var s = Object.assign(
          {
            blockAds: true,
            hideSidebarPromos: true,
            forceOrigImages: true,
            cleanLinks: true
          },
          res || {}
        );

        injectEnhancementStyles();
        runAdCleaner(s.blockAds);
        runSidebarCleaner(s.hideSidebarPromos);
        runImageEnhancer(s.forceOrigImages);
        runLinkCleaner(s.cleanLinks);
      }
    );
  }

  function scheduleEnhancerPass() {
    if (enhancerTimer) {
      return;
    }
    enhancerTimer = setTimeout(function () {
      enhancerTimer = null;
      executeEnhancers();
    }, 200);
  }

  // 观察时间线 DOM 变动持续进行净化
  var timelineObserver = new MutationObserver(function () {
    scheduleEnhancerPass();
  });

  timelineObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  initializeDefaults();
  window.addEventListener("message", handleWindowMessage, false);
  chrome.storage.onChanged.addListener(handleStorageChange);
  getSettings(function (settings) {
    postSettings(settings);
  });
  scheduleEnhancerPass();
})();
