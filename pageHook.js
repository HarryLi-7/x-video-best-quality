(function () {
  "use strict";

  if (window.__XVBQ_PAGEHOOK_INSTALLED__) {
    return;
  }

  Object.defineProperty(window, "__XVBQ_PAGEHOOK_INSTALLED__", {
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

  var settings = {
    ready: true,
    enabled: true,
    debug: false,
    qualityCap: "1080"
  };

  const ENABLE_XHR_HOOK = true;

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

  var originalFetch = window.fetch.bind(window);
  var NativeXMLHttpRequest = window.XMLHttpRequest;
  var xhrMeta = new WeakMap();
  var xhrOverrideText = new WeakMap();
  var authorDetectionScheduled = new WeakSet();
  var lastAuthorSelectionSignature = "";

  var xhrOpen = NativeXMLHttpRequest.prototype.open;
  var xhrResponseTextDescriptor = Object.getOwnPropertyDescriptor(
    NativeXMLHttpRequest.prototype,
    "responseText"
  );
  var xhrResponseDescriptor = Object.getOwnPropertyDescriptor(
    NativeXMLHttpRequest.prototype,
    "response"
  );

  function postToBridge(type, payload) {
    window.postMessage(
      {
        sender: "xvbq-pagehook",
        type: type,
        payload: payload || null,
        __xvbq: true
      },
      MESSAGE_TARGET_ORIGIN
    );
  }

  function log() {
    if (!settings.debug) {
      return;
    }

    var args = Array.prototype.slice.call(arguments);
    args.unshift("[XVBQ]");
    console.log.apply(console, args);
  }

  function reportNonFatalError(context, error) {
    var message = context;
    if (error && error.message) {
      message += ": " + error.message;
    }

    log(message);
    postToBridge(TYPE_ERROR, { message: message });
  }

  function isTwitterVideoM3U8Url(url) {
    if (typeof url !== "string" || !url) {
      return false;
    }

    try {
      var parsed = new URL(url, window.location.href);
      var href = parsed.href.toLowerCase();
      var host = parsed.hostname.toLowerCase();
      var isTwimg = host === "video.twimg.com" || host.endsWith(".twimg.com");
      var isX = host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com");
      return (
        (isTwimg || isX) &&
        (parsed.pathname.toLowerCase().indexOf(".m3u8") !== -1 ||
          href.indexOf(".m3u8") !== -1)
      );
    } catch (error) {
      return false;
    }
  }

  function isMasterPlaylist(text) {
    return typeof text === "string" && text.indexOf("#EXT-X-STREAM-INF") !== -1;
  }

  function parseAttributes(attributeLine) {
    var line = attributeLine;
    var prefix = "#EXT-X-STREAM-INF:";

    if (line.indexOf(prefix) === 0) {
      line = line.slice(prefix.length);
    }

    var attributes = {};
    var index = 0;

    while (index < line.length) {
      while (index < line.length && (line[index] === "," || line[index] === " ")) {
        index += 1;
      }

      if (index >= line.length) {
        break;
      }

      var keyStart = index;
      while (index < line.length && line[index] !== "=") {
        index += 1;
      }

      if (index >= line.length) {
        break;
      }

      var key = line.slice(keyStart, index).trim().toUpperCase();
      index += 1;

      var value = "";
      if (line[index] === "\"") {
        index += 1;
        var quotedStart = index;
        while (index < line.length && line[index] !== "\"") {
          index += 1;
        }
        value = line.slice(quotedStart, index);
        if (line[index] === "\"") {
          index += 1;
        }
      } else {
        var valueStart = index;
        while (index < line.length && line[index] !== ",") {
          index += 1;
        }
        value = line.slice(valueStart, index).trim();
      }

      if (key) {
        attributes[key] = value;
      }

      while (index < line.length && line[index] !== ",") {
        index += 1;
      }

      if (line[index] === ",") {
        index += 1;
      }
    }

    return attributes;
  }

  function parsePositiveInteger(value) {
    if (typeof value !== "string" || !value) {
      return null;
    }

    var number = Number.parseInt(value, 10);
    if (!Number.isFinite(number) || number < 0) {
      return null;
    }

    return number;
  }

  function parseResolution(value) {
    if (typeof value !== "string") {
      return null;
    }

    var match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) {
      return null;
    }

    var width = Number.parseInt(match[1], 10);
    var height = Number.parseInt(match[2], 10);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    return {
      width: width,
      height: height
    };
  }

  function buildQualityLabel(width, height, bandwidth) {
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return String(Math.min(width, height)) + "p";
    }

    if (Number.isFinite(bandwidth) && bandwidth > 0) {
      return "最高码率";
    }

    return "unknown";
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

  function normalizeQualityCap(value) {
    if (typeof value !== "string") {
      return QUALITY_CAP_DEFAULT;
    }

    return QUALITY_CAP_VALUES[value] ? value : QUALITY_CAP_DEFAULT;
  }

  function qualityCapToLabel(value) {
    var normalized = normalizeQualityCap(value);

    if (normalized === "best") {
      return "最高可用";
    }

    return normalized + "p";
  }

  function getVariantBandwidthScore(variant) {
    if (!variant) {
      return -1;
    }

    if (variant.scoreBandwidth !== null) {
      return variant.scoreBandwidth;
    }

    if (variant.bandwidth !== null) {
      return variant.bandwidth;
    }

    return -1;
  }

  function parseVariants(masterText, baseUrl) {
    var lines = masterText.split(/\r?\n/);
    var variants = [];

    for (var index = 0; index < lines.length; index += 1) {
      var currentLine = lines[index].trim();
      if (currentLine.indexOf("#EXT-X-STREAM-INF") !== 0) {
        continue;
      }

      var uriLineIndex = findNextPlaylistUriLineIndex(lines, index);
      if (uriLineIndex < 0) {
        return null;
      }

      var uriLine = lines[uriLineIndex].trim();

      var attributes = parseAttributes(currentLine);
      var resolution = parseResolution(attributes.RESOLUTION);
      var width = resolution ? resolution.width : null;
      var height = resolution ? resolution.height : null;
      var shortSide =
        width !== null && height !== null ? Math.min(width, height) : null;
      var longSide =
        width !== null && height !== null ? Math.max(width, height) : null;
      var bandwidth = parsePositiveInteger(attributes.BANDWIDTH);
      var averageBandwidth = parsePositiveInteger(attributes["AVERAGE-BANDWIDTH"]);
      var scoreBandwidth =
        averageBandwidth !== null ? averageBandwidth : bandwidth;
      var resolvedUri = uriLine;

      try {
        resolvedUri = new URL(uriLine, baseUrl).toString();
      } catch (error) {
        resolvedUri = uriLine;
      }

      variants.push({
        streamInfLineIndex: index,
        uriLineIndex: uriLineIndex,
        streamInfLine: lines[index],
        uri: uriLine,
        resolvedUri: resolvedUri,
        width: width,
        height: height,
        shortSide: shortSide,
        longSide: longSide,
        bandwidth: bandwidth,
        averageBandwidth: averageBandwidth,
        scoreBandwidth: scoreBandwidth,
        qualityLabel: buildQualityLabel(width, height, scoreBandwidth)
      });
    }

    return variants;
  }

  function findNextPlaylistUriLineIndex(lines, startIndex) {
    for (var index = startIndex + 1; index < lines.length; index += 1) {
      var trimmed = lines[index].trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed[0] === "#") {
        if (trimmed.indexOf("#EXT-X-STREAM-INF") === 0) {
          return -1;
        }

        continue;
      }

      return index;
    }

    return -1;
  }

  function compareVariants(left, right) {
    var leftShort = left.shortSide !== null ? left.shortSide : -1;
    var rightShort = right.shortSide !== null ? right.shortSide : -1;
    if (leftShort !== rightShort) {
      return leftShort - rightShort;
    }

    var leftLong = left.longSide !== null ? left.longSide : -1;
    var rightLong = right.longSide !== null ? right.longSide : -1;
    if (leftLong !== rightLong) {
      return leftLong - rightLong;
    }

    var leftBandwidth = left.scoreBandwidth !== null ? left.scoreBandwidth : -1;
    var rightBandwidth = right.scoreBandwidth !== null ? right.scoreBandwidth : -1;
    if (leftBandwidth !== rightBandwidth) {
      return leftBandwidth - rightBandwidth;
    }

    return left.uriLineIndex - right.uriLineIndex;
  }

  function selectBestVariant(variants) {
    if (!Array.isArray(variants) || variants.length === 0) {
      return null;
    }

    var best = variants[0];
    for (var index = 1; index < variants.length; index += 1) {
      if (compareVariants(variants[index], best) >= 0) {
        best = variants[index];
      }
    }

    return best;
  }

  function selectLowestVariant(variants) {
    if (!Array.isArray(variants) || variants.length === 0) {
      return null;
    }

    var lowest = variants[0];
    for (var index = 1; index < variants.length; index += 1) {
      if (compareVariants(variants[index], lowest) < 0) {
        lowest = variants[index];
      }
    }

    return lowest;
  }

  function compareVariantsByBandwidth(left, right) {
    var leftBandwidth = getVariantBandwidthScore(left);
    var rightBandwidth = getVariantBandwidthScore(right);

    if (leftBandwidth !== rightBandwidth) {
      return leftBandwidth - rightBandwidth;
    }

    return right.uriLineIndex - left.uriLineIndex;
  }

  function selectHighestBandwidthVariant(variants) {
    if (!Array.isArray(variants) || variants.length === 0) {
      return null;
    }

    var best = variants[0];
    for (var index = 1; index < variants.length; index += 1) {
      if (compareVariantsByBandwidth(variants[index], best) >= 0) {
        best = variants[index];
      }
    }

    return best;
  }

  function selectVariantByQualityCap(variants, qualityCap) {
    if (!Array.isArray(variants) || variants.length === 0) {
      return null;
    }

    var normalizedQualityCap = normalizeQualityCap(qualityCap);
    var parsedVariants = [];

    for (var index = 0; index < variants.length; index += 1) {
      if (
        variants[index] &&
        variants[index].shortSide !== null &&
        variants[index].longSide !== null
      ) {
        parsedVariants.push(variants[index]);
      }
    }

    if (normalizedQualityCap === "best") {
      if (parsedVariants.length > 0) {
        return {
          variant: selectBestVariant(parsedVariants),
          reason: "best",
          debugMessage: ""
        };
      }

      return {
        variant: selectHighestBandwidthVariant(variants),
        reason: "fallback-bandwidth",
        debugMessage: ""
      };
    }

    if (parsedVariants.length === 0) {
      return {
        variant: selectHighestBandwidthVariant(variants),
        reason: "fallback-bandwidth",
        debugMessage: ""
      };
    }

    var capValue = Number.parseInt(normalizedQualityCap, 10);
    if (!Number.isFinite(capValue)) {
      capValue = Number.parseInt(QUALITY_CAP_DEFAULT, 10);
    }

    var withinCap = [];
    for (var withinIndex = 0; withinIndex < parsedVariants.length; withinIndex += 1) {
      if (parsedVariants[withinIndex].shortSide <= capValue) {
        withinCap.push(parsedVariants[withinIndex]);
      }
    }

    if (withinCap.length > 0) {
      var bestWithinCap = selectBestVariant(withinCap);
      return {
        variant: bestWithinCap,
        reason:
          bestWithinCap.shortSide === capValue ? "matched-cap" : "below-cap-highest",
        debugMessage: ""
      };
    }

    return {
      variant: selectLowestVariant(parsedVariants),
      reason: "fallback-lowest-above-cap",
      debugMessage: "没有找到低于或等于上限的 variant，已选择最低可用画质。"
    };
  }

  function rewriteMasterPlaylist(masterText, selectedVariant) {
    var newline = masterText.indexOf("\r\n") !== -1 ? "\r\n" : "\n";
    var lines = masterText.split(/\r?\n/);
    var output = [];
    var selectedStreamInfLineIndex =
      selectedVariant && typeof selectedVariant.streamInfLineIndex === "number"
        ? selectedVariant.streamInfLineIndex
        : -1;
    var selectedUriLineIndex =
      selectedVariant && typeof selectedVariant.uriLineIndex === "number"
        ? selectedVariant.uriLineIndex
        : -1;
    var selectedVariantCopied = false;

    if (
      selectedStreamInfLineIndex < 0 ||
      selectedUriLineIndex < selectedStreamInfLineIndex
    ) {
      return masterText;
    }

    for (var index = 0; index < lines.length; index += 1) {
      var trimmed = lines[index].trim();

      if (trimmed.indexOf("#EXT-X-STREAM-INF") === 0) {
        var uriLineIndex = findNextPlaylistUriLineIndex(lines, index);

        if (uriLineIndex < 0) {
          return masterText;
        }

        if (index === selectedStreamInfLineIndex) {
          if (uriLineIndex !== selectedUriLineIndex) {
            return masterText;
          }

          selectedVariantCopied = true;

          for (var cursor = index; cursor <= uriLineIndex; cursor += 1) {
            output.push(lines[cursor]);
          }
        }

        index = uriLineIndex;
        continue;
      }

      output.push(lines[index]);
    }

    if (!selectedVariantCopied) {
      return masterText;
    }

    return output.join(newline);
  }

  function processMasterPlaylist(masterText, baseUrl) {
    if (!isMasterPlaylist(masterText)) {
      return {
        handled: false,
        modified: false,
        text: masterText,
        selectedVariant: null,
        selectedReason: "",
        variants: []
      };
    }

    var variants = parseVariants(masterText, baseUrl);
    if (!Array.isArray(variants) || variants.length === 0) {
      return {
        handled: false,
        modified: false,
        text: masterText,
        selectedVariant: null,
        selectedReason: "",
        variants: []
      };
    }

    var selection = selectVariantByQualityCap(variants, settings.qualityCap);
    if (!selection || !selection.variant) {
      return {
        handled: false,
        modified: false,
        text: masterText,
        selectedVariant: null,
        selectedReason: "",
        variants: []
      };
    }

    var rewrittenText =
      variants.length > 1 ? rewriteMasterPlaylist(masterText, selection.variant) : masterText;

    return {
      handled: true,
      modified: rewrittenText !== masterText,
      text: rewrittenText,
      selectedVariant: selection.variant,
      selectedReason: selection.reason,
      debugMessage: selection.debugMessage,
      variants: variants
    };
  }

  function notifyQualitySelection(selectedVariant, variantCount, selectedReason) {
    var resolution =
      selectedVariant.width !== null && selectedVariant.height !== null
        ? String(selectedVariant.width) + "x" + String(selectedVariant.height)
        : "";

    postToBridge(TYPE_QUALITY_SELECTED, {
      lastSelectedReason: selectedReason || "",
      lastQuality: selectedVariant.qualityLabel,
      lastResolution: resolution,
      lastBandwidth: selectedVariant.scoreBandwidth || 0,
      lastBandwidthText: formatBandwidth(selectedVariant.scoreBandwidth || 0),
      lastVariantCount: variantCount,
      lastStreamUrl: selectedVariant.resolvedUri || selectedVariant.uri || ""
    });
  }

  function buildReplacementResponse(originalResponse, bodyText) {
    var headers = new Headers(originalResponse.headers);
    headers.delete("content-length");
    headers.delete("Content-Length");
    headers.delete("content-encoding");
    headers.delete("Content-Encoding");
    headers.delete("transfer-encoding");
    headers.delete("Transfer-Encoding");

    var replacementResponse = new Response(bodyText, {
      status: originalResponse.status,
      statusText: originalResponse.statusText,
      headers: headers
    });

    try {
      Object.defineProperties(replacementResponse, {
        url: {
          configurable: true,
          enumerable: true,
          value: originalResponse.url
        },
        redirected: {
          configurable: true,
          enumerable: true,
          value: originalResponse.redirected
        },
        type: {
          configurable: true,
          enumerable: true,
          value: originalResponse.type
        }
      });
    } catch (error) {}

    return replacementResponse;
  }

  function normalizeDomText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.replace(/\s+/g, " ").trim();
  }

  function isNoiseAuthorText(value) {
    var text = normalizeDomText(value);
    if (!text) {
      return true;
    }

    if (text[0] === "@") {
      return true;
    }

    if (text === "·" || text === "•" || text === "|" || text === "—") {
      return true;
    }

    if (/^(Follow|关注|Following|正在关注)$/i.test(text)) {
      return true;
    }

    if (/^显示更多$/i.test(text)) {
      return true;
    }

    if (/^显示原文$/i.test(text)) {
      return true;
    }

    if (/^翻译自\s+/i.test(text)) {
      return true;
    }

    if (/^\d+(?:\.\d+)?\s*(秒|分钟|小时|天|周|月|年|s|m|h|d|w|mo|y)(?:前)?$/i.test(text)) {
      return true;
    }

    if (/^\d{1,2}[:：]\d{2}(?:\s*[AP]M)?$/i.test(text)) {
      return true;
    }

    if (/^\d{1,2}\s*[月/-]\s*\d{1,2}(?:日)?$/i.test(text)) {
      return true;
    }

    if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/i.test(text)) {
      return true;
    }

    return false;
  }

  function stripAuthorMetadata(value) {
    var text = normalizeDomText(value);
    if (!text) {
      return "";
    }

    var handleIndex = text.search(/\s@[\w._-]+(?:\s|$)/);
    if (handleIndex > 0) {
      text = normalizeDomText(text.slice(0, handleIndex));
    }

    var separatorIndex = text.search(/\s[·•|—–]\s/);
    if (separatorIndex > 0) {
      text = normalizeDomText(text.slice(0, separatorIndex));
    }

    return text;
  }

  function extractAuthorName(userNameElement) {
    if (!userNameElement) {
      return "";
    }

    var spanCandidates = userNameElement.querySelectorAll("span");
    for (var index = 0; index < spanCandidates.length; index += 1) {
      var span = spanCandidates[index];
      if (!isVisibleElement(span)) {
        continue;
      }

      var text = stripAuthorMetadata(span.innerText || span.textContent || "");
      if (!text || isNoiseAuthorText(text) || text[0] === "@") {
        continue;
      }

      return text;
    }

    var rawText = userNameElement.innerText || userNameElement.textContent || "";
    var lines = rawText.split(/\n+/);

    for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      var text = stripAuthorMetadata(lines[lineIndex]);
      if (!text || isNoiseAuthorText(text) || text[0] === "@") {
        continue;
      }

      return text;
    }

    return "";
  }

  function isVisibleElement(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") {
      return false;
    }

    if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) {
      return false;
    }

    var rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getSharedAncestorDepth(left, right, root) {
    var leftAncestors = [];
    var current = left;

    while (current) {
      leftAncestors.unshift(current);
      if (current === root) {
        break;
      }
      current = current.parentElement;
    }

    var rightAncestors = [];
    current = right;
    while (current) {
      rightAncestors.unshift(current);
      if (current === root) {
        break;
      }
      current = current.parentElement;
    }

    var sharedDepth = -1;
    var limit = Math.min(leftAncestors.length, rightAncestors.length);

    for (var index = 0; index < limit; index += 1) {
      if (leftAncestors[index] !== rightAncestors[index]) {
        break;
      }
      sharedDepth = index;
    }

    return sharedDepth;
  }

  function findVideoAuthorScope(video, article) {
    var preferredSelector =
      '[role="link"], [data-testid="videoPlayer"], [data-testid="tweetPhoto"], article';

    for (var current = video && video.parentElement; current; current = current.parentElement) {
      if (current.matches && current.matches(preferredSelector)) {
        if (current.querySelector('[data-testid="User-Name"]')) {
          return current;
        }
      }

      if (current === article) {
        break;
      }
    }

    return article;
  }

  function selectBestAuthorCandidate(candidates, video, article, scopeRoot) {
    if (!candidates || !video || !article) {
      return null;
    }

    var videoRect = video.getBoundingClientRect();
    var bestAbove = null;
    var bestFallback = null;

    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index];
      if (!candidate || !article.contains(candidate) || !isVisibleElement(candidate)) {
        continue;
      }

      var authorName = extractAuthorName(candidate);
      if (!authorName) {
        continue;
      }

      var rect = candidate.getBoundingClientRect();
      var score = 0;
      var beforeVideo = Boolean(
        typeof Node !== "undefined" &&
          (candidate.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
      var verticalDistance = videoRect.top - rect.bottom;
      var sharedDepth = getSharedAncestorDepth(candidate, video, article);

      if (beforeVideo) {
        score += 100000;
      } else {
        score -= 100000;
      }

      if (verticalDistance >= 0) {
        score += 50000 - Math.min(verticalDistance, 50000);
      } else {
        score -= 50000 + Math.min(Math.abs(verticalDistance), 50000);
      }

      if (sharedDepth >= 0) {
        score += (sharedDepth + 1) * 1000;
      }

      if (scopeRoot && scopeRoot !== article && scopeRoot.contains(candidate)) {
        score += 500;
      }

      if (rect.bottom <= videoRect.top) {
        if (!bestAbove || score > bestAbove.score) {
          bestAbove = {
            element: candidate,
            name: authorName,
            score: score,
            rect: rect
          };
        }
      } else if (!bestFallback || score > bestFallback.score) {
        bestFallback = {
          element: candidate,
          name: authorName,
          score: score,
          rect: rect
        };
      }
    }

    return bestAbove || bestFallback;
  }

  function resolveAbsoluteUrl(value) {
    if (typeof value !== "string" || !value) {
      return "";
    }

    try {
      return new URL(value, window.location.href).toString();
    } catch (error) {
      return value;
    }
  }

  function findTweetUrlForAuthor(candidate, scopeRoot, article) {
    var scopes = [];

    if (scopeRoot) {
      scopes.push(scopeRoot);
    }

    if (article && scopes.indexOf(article) === -1) {
      scopes.push(article);
    }

    var candidateRect = candidate.getBoundingClientRect();
    var bestAnchor = null;
    var bestScore = Number.POSITIVE_INFINITY;

    for (var scopeIndex = 0; scopeIndex < scopes.length; scopeIndex += 1) {
      var scope = scopes[scopeIndex];
      var anchors = scope.querySelectorAll('a[href*="/status/"]');

      for (var anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
        var anchor = anchors[anchorIndex];
        if (!isVisibleElement(anchor)) {
          continue;
        }

        var anchorRect = anchor.getBoundingClientRect();
        var verticalDistance = Math.abs(anchorRect.top - candidateRect.top);
        var horizontalDistance = Math.abs(anchorRect.left - candidateRect.left);
        var score = verticalDistance * 10 + horizontalDistance;

        if (score < bestScore) {
          bestScore = score;
          bestAnchor = anchor;
        }
      }

      if (bestAnchor) {
        break;
      }
    }

    return bestAnchor ? resolveAbsoluteUrl(bestAnchor.getAttribute("href") || bestAnchor.href) : "";
  }

  function identifyVideoAuthor(video) {
    if (!video || video.tagName !== "VIDEO") {
      return null;
    }

    var article = video.closest('article[data-testid="tweet"]') || video.closest("article");
    if (!article) {
      return null;
    }

    var scopeRoot = findVideoAuthorScope(video, article);
    var candidates = scopeRoot ? scopeRoot.querySelectorAll('[data-testid="User-Name"]') : null;
    var selection = selectBestAuthorCandidate(candidates, video, article, scopeRoot);

    if (!selection && scopeRoot !== article) {
      scopeRoot = article;
      candidates = article.querySelectorAll('[data-testid="User-Name"]');
      selection = selectBestAuthorCandidate(candidates, video, article, scopeRoot);
    }

    if (!selection || !selection.name) {
      return null;
    }

    return {
      authorName: selection.name,
      tweetUrl: findTweetUrlForAuthor(selection.element, scopeRoot || article, article)
    };
  }

  function postAuthorSelection(authorInfo) {
    if (!authorInfo || !authorInfo.authorName) {
      return;
    }

    var tweetUrl = authorInfo.tweetUrl || "";
    var signature = authorInfo.authorName + "|" + tweetUrl;
    if (signature === lastAuthorSelectionSignature) {
      return;
    }

    lastAuthorSelectionSignature = signature;
    postToBridge(TYPE_AUTHOR_SELECTED, {
      lastAuthorName: authorInfo.authorName,
      lastTweetUrl: tweetUrl
    });

    log(
      "识别视频作者",
      authorInfo.authorName,
      tweetUrl || "(无 tweetUrl)"
    );
  }

  function detectAndPostCurrentVideoAuthor(video) {
    if (!video || !video.isConnected) {
      return;
    }

    var authorInfo = identifyVideoAuthor(video);
    if (!authorInfo) {
      return;
    }

    postAuthorSelection(authorInfo);
  }

  function scheduleAuthorDetection(video) {
    if (!video || authorDetectionScheduled.has(video)) {
      return;
    }

    authorDetectionScheduled.add(video);

    var runDetection = function () {
      authorDetectionScheduled.delete(video);
      detectAndPostCurrentVideoAuthor(video);
    };

    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(runDetection);
      return;
    }

    window.setTimeout(runDetection, 0);
  }

  function handleVideoPlaybackEvent(event) {
    var target = event && event.target;
    if (!target || target.tagName !== "VIDEO") {
      return;
    }

    scheduleAuthorDetection(target);
  }

  function getRequestUrl(input) {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.toString();
    }

    if (input && typeof input.url === "string") {
      return input.url;
    }

    return "";
  }

  async function hookedFetch(input, init) {
    var response = await originalFetch(input, init);
    var requestUrl = getRequestUrl(input);
    var responseUrl = response && response.url ? response.url : requestUrl;

    if (!settings.ready || !settings.enabled || !isTwitterVideoM3U8Url(responseUrl)) {
      return response;
    }

    try {
      var originalText = await response.clone().text();
      var result = processMasterPlaylist(originalText, responseUrl);

      if (!result.handled) {
        return response;
      }

      if (result.debugMessage) {
        log(result.debugMessage);
      }

      log(
        "fetch 拦截到 master playlist，发现",
        result.variants.length,
        "个 variant，选择",
        result.selectedVariant.qualityLabel,
        result.selectedVariant.scoreBandwidth || 0,
        "原因",
        result.selectedReason || "unknown",
        "上限",
        qualityCapToLabel(settings.qualityCap)
      );

      notifyQualitySelection(
        result.selectedVariant,
        result.variants.length,
        result.selectedReason
      );
      return result.modified
        ? buildReplacementResponse(response, result.text)
        : response;
    } catch (error) {
      reportNonFatalError("fetch 重写 playlist 失败，回退原始响应", error);
      return response;
    }
  }

  function ensureXhrOverride(xhr) {
    if (!ENABLE_XHR_HOOK) {
      return;
    }

    var meta = xhrMeta.get(xhr);
    if (!meta || meta.processed || !settings.ready || !settings.enabled) {
      return;
    }

    if (!isTwitterVideoM3U8Url(meta.url) || xhr.readyState !== 4) {
      return;
    }

    var responseType = xhr.responseType;
    if (responseType && responseType !== "text") {
      meta.processed = true;
      return;
    }

    meta.processed = true;

    try {
      if (!xhrResponseTextDescriptor || !xhrResponseTextDescriptor.get) {
        return;
      }

      var originalText = xhrResponseTextDescriptor.get.call(xhr);
      var result = processMasterPlaylist(
        originalText,
        xhr.responseURL || meta.url
      );

      if (!result.handled) {
        return;
      }

      if (result.debugMessage) {
        log(result.debugMessage);
      }

      log(
        "XHR 拦截到 master playlist，发现",
        result.variants.length,
        "个 variant，选择",
        result.selectedVariant.qualityLabel,
        result.selectedVariant.scoreBandwidth || 0,
        "原因",
        result.selectedReason || "unknown",
        "上限",
        qualityCapToLabel(settings.qualityCap)
      );

      notifyQualitySelection(
        result.selectedVariant,
        result.variants.length,
        result.selectedReason
      );

      if (result.modified) {
        xhrOverrideText.set(xhr, result.text);
      }
    } catch (error) {
      reportNonFatalError("XHR 重写 playlist 失败，回退原始响应", error);
    }
  }

  function handleSettingsMessage(event) {
    if (event.source !== window) {
      return;
    }

    var data = event.data;
    if (
      !data ||
      data[MESSAGE_FLAG] !== true ||
      data.type !== TYPE_SETTINGS ||
      data.sender !== "xvbq-bridge"
    ) {
      return;
    }

    var payload = data.payload || {};
    settings.ready = true;
    settings.enabled = payload.enabled !== false;
    settings.debug = payload.debug === true;
    settings.qualityCap = normalizeQualityCap(payload.qualityCap);
  }

  window.addEventListener("message", handleSettingsMessage, false);
  document.addEventListener("play", handleVideoPlaybackEvent, true);
  document.addEventListener("playing", handleVideoPlaybackEvent, true);

  window.fetch = hookedFetch;

  if (ENABLE_XHR_HOOK) {
    NativeXMLHttpRequest.prototype.open = function () {
      var requestUrl = "";
      if (arguments.length > 1) {
        try {
          requestUrl = new URL(String(arguments[1]), window.location.href).toString();
        } catch (error) {
          requestUrl = String(arguments[1] || "");
        }
      }

      xhrMeta.set(this, {
        url: requestUrl,
        processed: false
      });
      xhrOverrideText.delete(this);

      return xhrOpen.apply(this, arguments);
    };

    if (xhrResponseTextDescriptor && xhrResponseTextDescriptor.get) {
      Object.defineProperty(NativeXMLHttpRequest.prototype, "responseText", {
        configurable: true,
        enumerable: xhrResponseTextDescriptor.enumerable,
        get: function () {
          ensureXhrOverride(this);

          if (
            xhrOverrideText.has(this) &&
            this.readyState === 4 &&
            (!this.responseType || this.responseType === "text")
          ) {
            return xhrOverrideText.get(this);
          }

          return xhrResponseTextDescriptor.get.call(this);
        }
      });
    }

    if (xhrResponseDescriptor && xhrResponseDescriptor.get) {
      Object.defineProperty(NativeXMLHttpRequest.prototype, "response", {
        configurable: true,
        enumerable: xhrResponseDescriptor.enumerable,
        get: function () {
          ensureXhrOverride(this);

          if (
            xhrOverrideText.has(this) &&
            this.readyState === 4 &&
            (!this.responseType || this.responseType === "text")
          ) {
            return xhrOverrideText.get(this);
          }

          return xhrResponseDescriptor.get.call(this);
        }
      });
    }
  }

  postToBridge(TYPE_PAGEHOOK_READY, null);
})();
