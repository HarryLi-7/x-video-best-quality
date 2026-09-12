(function () {
  "use strict";

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
  var QUALITY_CAP_LABELS = {
    best: "最高可用",
    "2160": "4K / 2160p",
    "1440": "2K / 1440p",
    "1080": "1080p",
    "720": "720p",
    "480": "480p",
    "360": "360p"
  };

  var SUPPORTED_HOSTS = {
    "x.com": true,
    "twitter.com": true,
    "mobile.x.com": true,
    "mobile.twitter.com": true,
    "pro.x.com": true,
    "pro.twitter.com": true
  };

  var state = Object.assign({}, DEFAULTS);

  var elements = {
    statusDot: document.getElementById("statusDot"),
    statusLabel: document.getElementById("statusLabel"),
    enabledToggle: document.getElementById("enabledToggle"),
    qualityCapSelect: document.getElementById("qualityCapSelect"),
    debugToggle: document.getElementById("debugToggle"),
    lastAuthorName: document.getElementById("lastAuthorName"),
    siteStatus: document.getElementById("siteStatus"),
    lastVideo: document.getElementById("lastVideo"),
    targetQuality: document.getElementById("targetQuality"),
    lastResolution: document.getElementById("lastResolution"),
    clearButton: document.getElementById("clearButton"),
    copyStreamBtn: document.getElementById("copyStreamBtn"),
    copyBtnLabel: document.getElementById("copyBtnLabel"),
    downloadStreamBtn: document.getElementById("downloadStreamBtn"),
    pipToggleBtn: document.getElementById("pipToggleBtn"),
    pipBtnText: document.getElementById("pipBtnText"),
    blockAdsToggle: document.getElementById("blockAdsToggle"),
    forceOrigToggle: document.getElementById("forceOrigToggle"),
    cleanLinksToggle: document.getElementById("cleanLinksToggle"),
    hideSidebarToggle: document.getElementById("hideSidebarToggle")
  };

  function normalizeQualityCap(value) {
    if (typeof value !== "string") {
      return QUALITY_CAP_DEFAULT;
    }

    return QUALITY_CAP_LABELS[value] ? value : QUALITY_CAP_DEFAULT;
  }

  function qualityCapToLabel(value) {
    return QUALITY_CAP_LABELS[normalizeQualityCap(value)];
  }

  function updateStatusUi() {
    var enabled = state.enabled !== false;
    elements.enabledToggle.checked = enabled;
    elements.debugToggle.checked = state.debug === true;
    elements.statusLabel.textContent = enabled ? "已启用" : "已停用";
    elements.statusDot.classList.toggle("is-disabled", !enabled);

    if (elements.blockAdsToggle) {
      elements.blockAdsToggle.checked = state.blockAds !== false;
    }
    if (elements.forceOrigToggle) {
      elements.forceOrigToggle.checked = state.forceOrigImages !== false;
    }
    if (elements.cleanLinksToggle) {
      elements.cleanLinksToggle.checked = state.cleanLinks !== false;
    }
    if (elements.hideSidebarToggle) {
      elements.hideSidebarToggle.checked = state.hideSidebarPromos !== false;
    }
  }

  function updateQualityCapUi() {
    var cap = normalizeQualityCap(state.qualityCap);
    if (elements.qualityCapSelect) {
      elements.qualityCapSelect.value = cap;
    }
    var pills = document.querySelectorAll(".pill-btn");
    pills.forEach(function (pill) {
      var match = pill.getAttribute("data-quality") === cap;
      pill.classList.toggle("is-active", match);
      pill.setAttribute("aria-checked", match ? "true" : "false");
    });
  }

  function updateAuthorUi() {
    elements.lastAuthorName.textContent = state.lastAuthorName || "暂无记录";
  }

  function updateLastVideoUi() {
    var currentParts = [];

    if (state.lastQuality) {
      currentParts.push(state.lastQuality);
    }

    if (state.lastBandwidthText) {
      currentParts.push(state.lastBandwidthText);
    }

    var currentLine = currentParts.length > 0 ? currentParts.join(" / ") : "暂无记录";
    elements.lastVideo.textContent = currentLine;
    elements.targetQuality.textContent = qualityCapToLabel(state.qualityCap);
    elements.lastResolution.textContent = state.lastResolution || "-";
  }

  function isSupportedPageUrl(url) {
    if (typeof url !== "string" || !url) {
      return null;
    }

    try {
      var parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        return null;
      }

      if (!SUPPORTED_HOSTS[parsed.hostname]) {
        return null;
      }

      return parsed.hostname;
    } catch (error) {
      return null;
    }
  }

  function updateSiteStatus(url) {
    var supportedHost = isSupportedPageUrl(url);
    elements.siteStatus.textContent = supportedHost
      ? supportedHost + " / 支持中"
      : "仅在 X / Twitter 生效";
  }

  function updateSpeedUi() {
    var speed = typeof state.preferredSpeed === "number" ? state.preferredSpeed : 1.0;
    var speedPills = document.querySelectorAll(".speed-pill");
    speedPills.forEach(function (pill) {
      var pSpeed = parseFloat(pill.getAttribute("data-speed")) || 1.0;
      var match = Math.abs(pSpeed - speed) < 0.05;
      pill.classList.toggle("is-active", match);
      pill.setAttribute("aria-checked", match ? "true" : "false");
    });
  }

  function loadState() {
    chrome.storage.local.get(DEFAULTS, function (result) {
      state = Object.assign({}, DEFAULTS, result || {});
      state.qualityCap = normalizeQualityCap(state.qualityCap);
      if (state.qualityCap !== (result && result.qualityCap)) {
        chrome.storage.local.set({
          qualityCap: state.qualityCap
        });
      }
      updateStatusUi();
      updateQualityCapUi();
      updateAuthorUi();
      updateLastVideoUi();
      updateSpeedUi();
    });
  }

  function loadCurrentTabInfo() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var activeTab = tabs && tabs[0];
      updateSiteStatus(activeTab && activeTab.url ? activeTab.url : "");
      if (activeTab && activeTab.id) {
        chrome.tabs.sendMessage(
          activeTab.id,
          { type: "XVBQ_GET_PLAYBACK_STATUS" },
          function (res) {
            if (chrome.runtime.lastError || !res) {
              return;
            }
            if (elements.pipToggleBtn) {
              elements.pipToggleBtn.classList.toggle("is-active", !!res.isPip);
              if (elements.pipBtnText) {
                elements.pipBtnText.textContent = res.isPip ? "退出画中画" : "画中画";
              }
            }
            if (typeof res.playbackRate === "number") {
              state.preferredSpeed = res.playbackRate;
              updateSpeedUi();
            }
          }
        );
      }
    });
  }

  function attachEvents() {
    var pillButtons = document.querySelectorAll(".pill-btn");
    pillButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var targetQuality = btn.getAttribute("data-quality");
        var nextQualityCap = normalizeQualityCap(targetQuality);
        state.qualityCap = nextQualityCap;
        chrome.storage.local.set({
          qualityCap: nextQualityCap
        });
        updateQualityCapUi();
        updateLastVideoUi();
      });
    });

    elements.enabledToggle.addEventListener("change", function () {
      chrome.storage.local.set({
        enabled: elements.enabledToggle.checked
      });
    });

    elements.qualityCapSelect.addEventListener("change", function () {
      var nextQualityCap = normalizeQualityCap(elements.qualityCapSelect.value);
      elements.qualityCapSelect.value = nextQualityCap;
      state.qualityCap = nextQualityCap;
      chrome.storage.local.set({
        qualityCap: nextQualityCap
      });
      updateAuthorUi();
      updateLastVideoUi();
    });

    elements.debugToggle.addEventListener("change", function () {
      chrome.storage.local.set({
        debug: elements.debugToggle.checked
      });
    });

    if (elements.blockAdsToggle) {
      elements.blockAdsToggle.addEventListener("change", function () {
        chrome.storage.local.set({
          blockAds: elements.blockAdsToggle.checked
        });
      });
    }

    if (elements.forceOrigToggle) {
      elements.forceOrigToggle.addEventListener("change", function () {
        chrome.storage.local.set({
          forceOrigImages: elements.forceOrigToggle.checked
        });
      });
    }

    if (elements.cleanLinksToggle) {
      elements.cleanLinksToggle.addEventListener("change", function () {
        chrome.storage.local.set({
          cleanLinks: elements.cleanLinksToggle.checked
        });
      });
    }

    if (elements.hideSidebarToggle) {
      elements.hideSidebarToggle.addEventListener("change", function () {
        chrome.storage.local.set({
          hideSidebarPromos: elements.hideSidebarToggle.checked
        });
      });
    }

    // 快捷复制直链
    if (elements.copyStreamBtn) {
      elements.copyStreamBtn.addEventListener("click", function () {
        var urlToCopy = state.lastStreamUrl || state.lastTweetUrl;
        if (!urlToCopy) {
          elements.copyBtnLabel.textContent = "暂无视频流";
          setTimeout(function () {
            elements.copyBtnLabel.textContent = "复制直链";
          }, 1500);
          return;
        }

        navigator.clipboard
          .writeText(urlToCopy)
          .then(function () {
            elements.copyBtnLabel.textContent = "已复制直链!";
            elements.copyStreamBtn.classList.add("action-btn--success");
            setTimeout(function () {
              elements.copyBtnLabel.textContent = "复制直链";
              elements.copyStreamBtn.classList.remove("action-btn--success");
            }, 1800);
          })
          .catch(function () {
            elements.copyBtnLabel.textContent = "复制失败";
            setTimeout(function () {
              elements.copyBtnLabel.textContent = "复制直链";
            }, 1500);
          });
      });
    }

    // 快捷下载流文件
    if (elements.downloadStreamBtn) {
      elements.downloadStreamBtn.addEventListener("click", function () {
        var urlToDownload = state.lastStreamUrl;
        if (!urlToDownload) {
          alert("请先在页面上播放视频，待捕获到视频流后再点击下载。");
          return;
        }

        var filename = "x-video-" + (state.lastResolution || "best") + ".m3u8";
        chrome.runtime.sendMessage(
          {
            type: "XVBQ_DOWNLOAD_STREAM",
            url: urlToDownload,
            filename: filename
          },
          function (response) {
            if (!response || !response.success) {
              var a = document.createElement("a");
              a.href = urlToDownload;
              a.download = filename;
              a.target = "_blank";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }
          }
        );
      });
    }

    // 画中画切换
    if (elements.pipToggleBtn) {
      elements.pipToggleBtn.addEventListener("click", function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          var activeTab = tabs && tabs[0];
          if (activeTab && activeTab.id) {
            chrome.tabs.sendMessage(
              activeTab.id,
              { type: "XVBQ_TOGGLE_PIP" },
              function (res) {
                if (chrome.runtime.lastError || !res) {
                  return;
                }
                if (res.success) {
                  elements.pipToggleBtn.classList.toggle("is-active", !!res.isPip);
                  elements.pipBtnText.textContent = res.isPip ? "退出画中画" : "画中画";
                } else if (res.error) {
                  alert(res.error);
                }
              }
            );
          }
        });
      });
    }

    // 倍速调节
    var speedPills = document.querySelectorAll(".speed-pill");
    speedPills.forEach(function (pill) {
      pill.addEventListener("click", function () {
        var speed = parseFloat(pill.getAttribute("data-speed")) || 1.0;
        state.preferredSpeed = speed;
        chrome.storage.local.set({ preferredSpeed: speed });
        updateSpeedUi();

        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          var activeTab = tabs && tabs[0];
          if (activeTab && activeTab.id) {
            chrome.tabs.sendMessage(activeTab.id, {
              type: "XVBQ_SET_SPEED",
              speed: speed
            });
          }
        });
      });
    });

    elements.clearButton.addEventListener("click", function () {
      chrome.storage.local.set({
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
        lastStreamUrl: ""
      });
    });

    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== "local") {
        return;
      }

      Object.keys(changes).forEach(function (key) {
        state[key] = changes[key].newValue;
      });

      state.qualityCap = normalizeQualityCap(state.qualityCap);
      updateStatusUi();
      updateQualityCapUi();
      updateAuthorUi();
      updateLastVideoUi();
      updateSpeedUi();
    });
  }

  attachEvents();
  loadState();
  loadCurrentTabInfo();
})();
