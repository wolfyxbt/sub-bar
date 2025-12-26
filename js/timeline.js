(function (global) {
  "use strict";

  const utils = global.SubTracker?.utils;

  // 自动分配色盘（也用于 UI 默认色）
  const DEFAULT_PALETTE = [
    "#f7b0b0",
    "#f7b0dd",
    "#f7d2b0",
    "#f7f5b0",
    "#b1f7b0",
    "#bef0f6",
    "#bae0f5",
    "#d0b0f7",
    "#d6d6d6",
    "#ffffff",
  ];

  function normalizeCycle(cycle) {
    if (cycle === "weekly" || cycle === "monthly" || cycle === "yearly") return cycle;
    return "monthly";
  }

  function normalizeCurrency(currency) {
    if (!currency) return "CNY";
    return String(currency).toUpperCase();
  }

  function normalizeUrlForOpen(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;

    // 没有 scheme 时，默认按 https 处理（例如：example.com）
    let candidate = text;
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate);
    if (!hasScheme) candidate = `https://${candidate}`;

    try {
      const url = new URL(candidate);
      const protocol = String(url.protocol || "").toLowerCase();
      // 只允许常见安全协议，避免 javascript: 等注入
      if (protocol !== "http:" && protocol !== "https:" && protocol !== "mailto:" && protocol !== "tel:") return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  // favicon 解析缓存：避免每次 render 都重复请求同一个站点
  // key: origin（例如 https://www.instagram.com）
  // value:
  // - string：已验证可用的 favicon URL
  // - { failedAt: number }：近期失败（做短 TTL 负缓存，避免频繁重试）
  const FAVICON_CACHE = new Map();
  const FAVICON_FAIL_TTL_MS = 1000 * 60 * 30;

  function faviconCandidatesForLink(raw) {
    const openUrl = normalizeUrlForOpen(raw);
    if (!openUrl) return null;

    try {
      const url = new URL(openUrl);
      const protocol = String(url.protocol || "").toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") return null;

      const origin = url.origin;
      const host = url.hostname;

      const cached = FAVICON_CACHE.get(origin);
      if (typeof cached === "string" && cached) return { key: origin, candidates: [cached] };
      if (cached && typeof cached === "object" && typeof cached.failedAt === "number") {
        const age = Date.now() - cached.failedAt;
        if (age >= 0 && age < FAVICON_FAIL_TTL_MS) return { key: origin, candidates: [] };
      }

      // 先按“https://example.com/favicon.ico”方式尝试；
      // 若被站点的安全策略（例如 CORP/防盗链/隐私保护）拦截，则降级到更兼容的公开 favicon 服务。
      const hostNoWww = String(host || "").replace(/^www\./i, "");
      const candidates = [
        `${origin}/favicon.ico`,
        `${origin}/favicon.png`,
        `${origin}/apple-touch-icon.png`,
        `${origin}/apple-touch-icon-precomposed.png`,
        `https://icons.duckduckgo.com/ip3/${host}.ico`,
        hostNoWww && hostNoWww !== host ? `https://icons.duckduckgo.com/ip3/${hostNoWww}.ico` : null,
        `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`,
        hostNoWww && hostNoWww !== host
          ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostNoWww)}`
          : null,
        `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(origin)}`,
      ];

      return { key: origin, candidates };
    } catch {
      return null;
    }
  }

  function attachFaviconWithFallback(imgEl, faviconKey, candidates, onAllFail) {
    if (!imgEl) return;
    const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    const markFail = () => {
      imgEl.onload = null;
      imgEl.onerror = null;
      if (faviconKey) FAVICON_CACHE.set(faviconKey, { failedAt: Date.now() });
      if (typeof onAllFail === "function") onAllFail();
    };

    if (!list.length) {
      markFail();
      return;
    }

    let attempt = 0;

    const tryIndex = (i) => {
      if (i >= list.length) {
        markFail();
        return;
      }

      attempt += 1;
      const token = String(attempt);
      imgEl.dataset.faviconToken = token;

      imgEl.onload = () => {
        if (imgEl.dataset.faviconToken !== token) return;
        imgEl.onload = null;
        imgEl.onerror = null;
        if (faviconKey) FAVICON_CACHE.set(faviconKey, list[i]);
      };

      imgEl.onerror = () => {
        if (imgEl.dataset.faviconToken !== token) return;
        tryIndex(i + 1);
      };

      // 先绑定事件，再赋值 src，避免命中缓存时丢事件
      imgEl.src = list[i];
    };

    tryIndex(0);
  }

  // 缩放：用“每一天对应的像素宽度（px/day）”来表达
  const MIN_DAY_WIDTH = 1;
  const MAX_DAY_WIDTH = 32;
  const ZOOM_STEP = 0.5;
  const BUTTON_ZOOM_STEP = 0.5;
  // 坐标轴“行高”缩短 30%
  const ROW_HEIGHT_SCALE = 0.7;
  // 日刻度：>= 15 px/天 才显示“日”网格线与顶部“日单元格”（更像 Excel 的层级缩放）
  const SHOW_DAY_SCALE_AT_OR_ABOVE = 15;
  // 月刻度：> 1 px/天 才显示“月刻度线”与顶部“月单元格”
  const SHOW_MONTH_SCALE_AT_OR_ABOVE = 1.5;
  // 支持的时间范围：2024 ~ 2030（含）
  const MIN_SUPPORTED_DAY = Number.isFinite(utils.MIN_SUPPORTED_DAY) ? utils.MIN_SUPPORTED_DAY : utils.toDayNumberUTC(2024, 0, 1);
  const MAX_SUPPORTED_DAY = Number.isFinite(utils.MAX_SUPPORTED_DAY) ? utils.MAX_SUPPORTED_DAY : utils.toDayNumberUTC(2030, 11, 31);

  // “选取刻度范围”：支持日 / 月 / 年
  const SELECTION_KIND_DAY = "day";
  const SELECTION_KIND_MONTH = "month";
  const SELECTION_KIND_YEAR = "year";

  function clampDayToSupportedRange(dayNumber) {
    const value = Number(dayNumber);
    if (!Number.isFinite(value)) return MIN_SUPPORTED_DAY;
    return utils.clamp(value, MIN_SUPPORTED_DAY, MAX_SUPPORTED_DAY);
  }

  function normalizeSelectionKind(kind) {
    const value = String(kind || "")
      .trim()
      .toLowerCase();
    if (value === SELECTION_KIND_YEAR) return SELECTION_KIND_YEAR;
    if (value === SELECTION_KIND_MONTH) return SELECTION_KIND_MONTH;
    return SELECTION_KIND_DAY;
  }

  function selectionKindRank(kind) {
    const normalized = normalizeSelectionKind(kind);
    if (normalized === SELECTION_KIND_MONTH) return 1;
    if (normalized === SELECTION_KIND_YEAR) return 2;
    return 0;
  }

  function selectionKindFromRank(rank) {
    if (rank >= 2) return SELECTION_KIND_YEAR;
    if (rank >= 1) return SELECTION_KIND_MONTH;
    return SELECTION_KIND_DAY;
  }

  function selectionSpanFor(kind, anchorDay) {
    const requested = normalizeSelectionKind(kind);
    const anchor = clampDayToSupportedRange(Math.round(Number(anchorDay)));
    const parts = utils.dayNumberToParts(anchor);

    if (requested === SELECTION_KIND_YEAR) {
      const startDay = utils.toDayNumberUTC(parts.year, 0, 1);
      const endDay = utils.toDayNumberUTC(parts.year, 11, 31);
      return {
        kind: SELECTION_KIND_YEAR,
        startDay: clampDayToSupportedRange(startDay),
        endDay: clampDayToSupportedRange(endDay),
        label: `${parts.year}年`,
      };
    }

    if (requested === SELECTION_KIND_MONTH) {
      const startDay = utils.toDayNumberUTC(parts.year, parts.monthIndex, 1);
      const endDay = utils.toDayNumberUTC(parts.year, parts.monthIndex, utils.daysInMonthUTC(parts.year, parts.monthIndex));
      return {
        kind: SELECTION_KIND_MONTH,
        startDay: clampDayToSupportedRange(startDay),
        endDay: clampDayToSupportedRange(endDay),
        label: `${parts.year}年${utils.monthLabel(parts.monthIndex)}`,
      };
    }

    const day = clampDayToSupportedRange(anchor);
    return { kind: SELECTION_KIND_DAY, startDay: day, endDay: day, label: utils.dayNumberToISODate(day) };
  }

  function roundToStep(value, step) {
    if (!Number.isFinite(value)) return value;
    const rounded = Math.round(value / step) * step;
    return Number(rounded.toFixed(4));
  }

  function wheelDeltaYPixels(e, fallbackViewportHeight) {
    if (e.deltaMode === 1) return e.deltaY * 16;
    if (e.deltaMode === 2) return e.deltaY * (fallbackViewportHeight || 800);
    return e.deltaY;
  }

	  class Timeline {
	    constructor(options) {
      // Timeline 只关注“坐标轴 + 订阅色块”的渲染与滚动扩展，不直接操作存储层
      this.scroller = options.scroller;
      this.grid = options.grid;
      this.xAxis = options.xAxis;
      this.yAxis = options.yAxis;
      this.canvas = options.canvas;
      this.corner = options.corner;
      this.summaryAxis = options.summaryAxis || null;
      this.summaryCorner = options.summaryCorner || null;
      this.lineLabelLayerEl = options.lineLabelLayerEl || null;
      this.todayLineLabelEl = options.todayLineLabelEl || null;
      this.selectedLineLabelEl = options.selectedLineLabelEl || null;
      this.panelEl =
        options.panelEl || this.lineLabelLayerEl?.parentElement || this.scroller?.parentElement || null;

      this.dayWidth = 2;
      this.labelWidth = 220;
      this.axisHeight = 72;
      this.summaryHeight = 54;
      this.rowHeight = 48;
      this.rowGap = 0;

	      // 启动时一次性渲染完整时间范围（2024～2030），避免滚动到边缘再“扩展”造成闪烁/跳动
	      this.rangeStartDay = MIN_SUPPORTED_DAY;
	      this.rangeEndDay = MAX_SUPPORTED_DAY;

      this.subscriptions = [];
      this.selectedId = null;
      this.todayHighlightEnabled = options?.todayHighlightEnabled !== false;
      this.monthHighlightEnabled = options?.monthHighlightEnabled === true;
      this.yearHighlightEnabled = options?.yearHighlightEnabled === true;
      // X 轴选取：支持 日/月/年（用 UTC 天编号避免时区/DST 偏移）
      // { kind: "day"|"month"|"year", anchorDay: number }
      this.selectedTimes = [];
      this.onSubscriptionClick = null;
      this.onSubscriptionDelete = null;
      this.onAddSubscription = null;
      this.onZoomChange = null;
      this.onSelectionChange = null;

      this._isExtending = false;
      this._scrollRaf = null;
      // 用于“拖拽滚动”后抑制一次 click（避免拖动结束触发色块点击进入编辑）
      this._suppressClickUntil = 0;
      // 价格文本测量缓存：用于“只有真正挤压才隐藏”的智能显示规则
      this._priceLabelMeasureEl = null;
      this._priceLabelWidthCache = new Map();
      this._lastChargeTotals = null;

      this._syncLayoutFromViewport();
      this._bindEvents();
      this._applyCssVars();
      this.render();
    }

    setOnSubscriptionClick(handler) {
      this.onSubscriptionClick = handler;
    }

    setOnSubscriptionDelete(handler) {
      this.onSubscriptionDelete = handler;
    }

    setOnAddSubscription(handler) {
      this.onAddSubscription = handler;
    }

    setOnZoomChange(handler) {
      this.onZoomChange = handler;
    }

    setOnSelectionChange(handler) {
      this.onSelectionChange = handler;
    }
	
	    setTodayHighlightEnabled(enabled) {
	      this.todayHighlightEnabled = enabled !== false;
	      this._updateTodayIndicator();
	    }

    setMonthHighlightEnabled(enabled) {
      this.monthHighlightEnabled = enabled === true;
      this._updatePeriodHighlights();
    }

    setYearHighlightEnabled(enabled) {
      this.yearHighlightEnabled = enabled === true;
      this._updatePeriodHighlights();
    }

    setSelectedId(id) {
      this.selectedId = id || null;
      this._updateSelectionStyles();
    }

    setSubscriptions(subscriptions) {
      // 订阅行顺序由外部（App 层）决定：支持多种排序方式
      this.subscriptions = Array.isArray(subscriptions) ? subscriptions.slice() : [];
      this._ensureRangeForSubscriptions();
      this.render();
    }

    getDefaultColor(usedColorsCount) {
      return DEFAULT_PALETTE[usedColorsCount % DEFAULT_PALETTE.length];
    }

    getRecommendedColors() {
      return DEFAULT_PALETTE.slice();
    }

    getDayWidth() {
      return this.dayWidth;
    }

    getSelectedDay() {
      const list = Array.isArray(this.selectedTimes) ? this.selectedTimes : [];
      const last = list.length ? list[list.length - 1] : null;
      return last ? last.anchorDay : null;
    }

    setSelectedDay(dayNumber) {
      this.setSelectedTime(SELECTION_KIND_DAY, dayNumber);
    }

    getDayTotalText(dayNumber) {
      const day = clampDayToSupportedRange(Math.round(Number(dayNumber)));
      if (!Number.isFinite(day)) return "";
      const totals = this._lastChargeTotals?.dayTotals;
      if (!(totals instanceof Map)) return "";
      const dayTotals = totals.get(day);
      return this._formatTotalsInline(dayTotals);
    }

    getMonthTotalText(year, monthIndex) {
      if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return "";
      const totals = this._lastChargeTotals?.monthTotals;
      if (!(totals instanceof Map)) return "";
      const key = Number(year) * 12 + Number(monthIndex);
      const monthTotals = totals.get(key);
      return this._formatTotalsInline(monthTotals);
    }

    getYearTotalText(year) {
      if (!Number.isFinite(year)) return "";
      const totals = this._lastChargeTotals?.yearTotals;
      if (!(totals instanceof Map)) return "";
      const yearTotals = totals.get(Number(year));
      return this._formatTotalsInline(yearTotals);
    }

    getCurrentMonthTotalText() {
      const today = clampDayToSupportedRange(utils.getTodayDayNumber());
      const parts = utils.dayNumberToParts(today);
      return this.getMonthTotalText(parts.year, parts.monthIndex);
    }

    getCurrentYearTotalText() {
      const today = clampDayToSupportedRange(utils.getTodayDayNumber());
      const parts = utils.dayNumberToParts(today);
      return this.getYearTotalText(parts.year);
    }

    getSelectedTotalsInfo() {
      const spans = this._getSelectedSpans({ effective: true });
      if (!spans.length) return null;
      const totals = this._lastChargeTotals;
      const primary = spans[spans.length - 1];
      if (!totals) {
        return {
          kind: spans.length > 1 ? "multi" : primary.kind,
          label: spans.length > 1 ? "" : primary.label,
          text: "",
          startDay: primary.startDay,
        };
      }

      const combined = new Map();
      const countedDays = new Set();
      const addToCombined = (currency, value) => {
        if (!Number.isFinite(value) || value === 0) return;
        combined.set(currency, (combined.get(currency) || 0) + value);
      };

      for (const span of spans) {
        const start = utils.clamp(span.startDay, this.rangeStartDay, this.rangeEndDay);
        const end = utils.clamp(span.endDay, this.rangeStartDay, this.rangeEndDay);
        if (end < start) continue;
        for (let day = start; day <= end; day += 1) {
          if (countedDays.has(day)) continue;
          countedDays.add(day);
          const dayTotals = totals.dayTotals instanceof Map ? totals.dayTotals.get(day) : null;
          if (!dayTotals) continue;
          for (const [currency, value] of dayTotals.entries()) {
            addToCombined(currency, value);
          }
        }
      }

      return {
        kind: spans.length > 1 ? "multi" : primary.kind,
        label: spans.length > 1 ? "" : primary.label,
        text: this._formatTotalsInline(combined),
        startDay: primary.startDay,
      };
    }

    setSelectedTime(kind, dayNumber) {
      const normalized = Number(dayNumber);
      if (!Number.isFinite(normalized)) return;
      const requestedKind = normalizeSelectionKind(kind);
      const day = clampDayToSupportedRange(Math.round(normalized));

      // 对“月/年”选择，统一把 anchor 归一化到该月/该年的起点：便于识别同一段范围
      let anchorDay = day;
      if (requestedKind === SELECTION_KIND_MONTH || requestedKind === SELECTION_KIND_YEAR) {
        const parts = utils.dayNumberToParts(day);
        anchorDay =
          requestedKind === SELECTION_KIND_YEAR
            ? utils.toDayNumberUTC(parts.year, 0, 1)
            : utils.toDayNumberUTC(parts.year, parts.monthIndex, 1);
        anchorDay = clampDayToSupportedRange(anchorDay);
      }

      const list = Array.isArray(this.selectedTimes) ? this.selectedTimes : [];
      const existsIndex = list.findIndex((item) => item && item.kind === requestedKind && item.anchorDay === anchorDay);
      if (existsIndex >= 0) {
        this.selectedTimes = list.filter((_, idx) => idx !== existsIndex);
        this._updateSelectedIndicator();
        this._updateTickSelectionStyles();
        this._notifySelectionChange();
        return;
      }

      const newSpan = selectionSpanFor(requestedKind, anchorDay);
      const filtered = list.filter((item) => {
        if (!item) return false;
        const span = selectionSpanFor(normalizeSelectionKind(item.kind), item.anchorDay);
        if (!span) return false;
        const overlaps = span.startDay <= newSpan.endDay && span.endDay >= newSpan.startDay;
        return !overlaps;
      });

	      this.selectedTimes = filtered.concat({ kind: requestedKind, anchorDay });
	      // 选中后尽量保证“完整范围”可见（尤其是：日→缩放后变成月/年范围）
	      const rangeChanged = this._ensureRangeCoversEffectiveSelectedSpans();
      if (rangeChanged) {
        this.render();
        this._notifySelectionChange();
        return;
      }
      this._updateSelectedIndicator();
      this._updateTickSelectionStyles();
      this._notifySelectionChange();
    }

    setDayWidth(newDayWidth, options) {
      const requested = Number(newDayWidth);
      if (!Number.isFinite(requested)) return;

      const clamped = utils.clamp(requested, MIN_DAY_WIDTH, MAX_DAY_WIDTH);
      const rounded = roundToStep(clamped, ZOOM_STEP);
      if (!Number.isFinite(rounded) || rounded === this.dayWidth) return;

      const anchorX = this._normalizeAnchorX(options?.anchorX);
      const anchorDay = this._getDayAtScrollerX(anchorX);
      const prevScrollTop = this.scroller.scrollTop;

      this.dayWidth = rounded;
      this._applyCssVars();
      // 缩放时不需要重建左侧冻结列（否则 favicon 等资源会反复重载导致闪烁）
      this.render({ preserveYAxis: true });

      this._scrollToKeepDayAtX(anchorDay, anchorX);
      this.scroller.scrollTop = prevScrollTop;
      this._updateLineLabelPositions();

      if (typeof this.onZoomChange === "function") this.onZoomChange(this.dayWidth);
    }

    zoomIn(options) {
      this.setDayWidth(this.dayWidth + BUTTON_ZOOM_STEP, options);
    }

    zoomOut(options) {
      this.setDayWidth(this.dayWidth - BUTTON_ZOOM_STEP, options);
    }

    scrollToToday() {
      this.scrollToDay(clampDayToSupportedRange(utils.getTodayDayNumber()));
    }

    scrollToDay(dayNumber) {
      if (!Number.isFinite(dayNumber)) return;
      const targetDay = clampDayToSupportedRange(dayNumber);
      this._ensureRangeCoversDay(targetDay);

      const viewportTimelineWidth = Math.max(0, this.scroller.clientWidth - this.labelWidth);
      const dayOffsetPx = (targetDay - this.rangeStartDay) * this.dayWidth;
      const target = dayOffsetPx - viewportTimelineWidth / 2;
      const maxScrollLeft = Math.max(0, this.scroller.scrollWidth - this.scroller.clientWidth);
      this.scroller.scrollLeft = utils.clamp(target, 0, maxScrollLeft);
      this._updateLineLabelPositions();
    }

		    _bindEvents() {
		      this._bindDragToScroll();
		      this._bindWheelToZoom();
		      this._bindXAxisSelection();
		      this._bindSummaryAxisSelection();
		      this._bindCanvasSelection();
		      this._bindOutsideAxisClickToClearSelectedDay();
		      this._bindOutsideSubscriptionClickToClearSelectedId();

	      this.scroller.addEventListener("scroll", () => {
	        if (this._scrollRaf) return;
	        this._scrollRaf = global.requestAnimationFrame(() => {
	          this._scrollRaf = null;
          this._maybeExtendRangeOnScroll();
          this._updateLineLabelPositions();
        });
      });

      global.addEventListener("resize", () => {
        // 尺寸变化时，尽量保持“当前视图中心日期”不跳动
        const centerDay = this._getCenterDay();
        this._syncLayoutFromViewport();
        this._applyCssVars();
        this.render();
        if (centerDay != null) this.scrollToDay(centerDay);
        else this._updateLineLabelPositions();
      });
    }

	    _bindOutsideAxisClickToClearSelectedDay() {
	      // 用户已选取某个时间范围（日/月/年）后，点击坐标轴区域之外可快速取消选取（更接近 Excel 的操作习惯）
	      if (!global?.addEventListener) return;
	      const scroller = this.scroller;
	      if (!scroller) return;

	      global.addEventListener("click", (e) => {
	        if (this._shouldSuppressClick()) return;
	        if (!this.selectedTimes || !this.selectedTimes.length) return;
	        const target = e.target;
	        if (target && scroller.contains(target)) return;
	        this.clearSelectedTime();
	      });
	    }

    clearSelectedTime() {
      if (!this.selectedTimes || !this.selectedTimes.length) return;
      this.selectedTimes = [];
      this._updateSelectedIndicator();
      this._updateTickSelectionStyles();
      this._notifySelectionChange();
    }

	    clearSelectedDay() {
	      // 兼容：旧逻辑只支持“日选取”
	      this.clearSelectedTime();
	    }

	    _getLowestDisplayableSelectionKind() {
	      // 与“动态合成”阈值保持一致：
	      // - 月刻度线隐藏时（< 1 px/天）：只能选“年”
	      // - 日刻度线隐藏时（< 15 px/天）：最细只能选“月”
	      if (this.dayWidth < SHOW_MONTH_SCALE_AT_OR_ABOVE) return SELECTION_KIND_YEAR;
	      if (this.dayWidth < SHOW_DAY_SCALE_AT_OR_ABOVE) return SELECTION_KIND_MONTH;
	      return SELECTION_KIND_DAY;
	    }

	    _getEffectiveSelectionKind(requestedKind) {
	      const requested = normalizeSelectionKind(requestedKind);
	      const lowest = this._getLowestDisplayableSelectionKind();
	      const rank = Math.max(selectionKindRank(requested), selectionKindRank(lowest));
	      return selectionKindFromRank(rank);
	    }

	    _getSelectedSpans(options) {
	      const list = Array.isArray(this.selectedTimes) ? this.selectedTimes : [];
	      if (!list.length) return [];
	      const spans = [];
	      const seen = new Set();
	      for (const item of list) {
	        if (!item) continue;
	        const requested = normalizeSelectionKind(item.kind);
	        const anchorDay = item.anchorDay;
	        const effectiveKind = options?.effective ? this._getEffectiveSelectionKind(requested) : requested;
	        const span = selectionSpanFor(effectiveKind, anchorDay);
	        const key = `${span.kind}:${span.startDay}-${span.endDay}`;
	        if (seen.has(key)) continue;
	        seen.add(key);
	        spans.push(span);
	      }
	      return spans;
	    }

	    _getSelectedSpan(options) {
	      const spans = this._getSelectedSpans(options);
	      return spans.length ? spans[spans.length - 1] : null;
	    }

	    _ensureRangeCoversSpan(startDay, endDay) {
	      const start = clampDayToSupportedRange(startDay);
	      const end = clampDayToSupportedRange(endDay);
	      const minDay = Math.min(start, end);
	      const maxDay = Math.max(start, end);

	      const oldStart = this.rangeStartDay;
	      const oldEnd = this.rangeEndDay;
	      const nextStart = Math.max(MIN_SUPPORTED_DAY, Math.min(oldStart, minDay));
	      const nextEnd = Math.min(MAX_SUPPORTED_DAY, Math.max(oldEnd, maxDay));
	      if (nextStart === oldStart && nextEnd === oldEnd) return false;

	      const addedLeftDays = oldStart - nextStart;
	      this.rangeStartDay = nextStart;
	      this.rangeEndDay = nextEnd;
	      this._applyCssVars();

	      if (addedLeftDays > 0 && this.scroller) {
	        // 扩展左侧会把所有内容向右推：补偿 scrollLeft 以保持用户视图不动
	        this.scroller.scrollLeft += addedLeftDays * this.dayWidth;
	      }

	      return true;
	    }

	    _ensureRangeCoversEffectiveSelectedSpans() {
	      const spans = this._getSelectedSpans({ effective: true });
	      if (!spans.length) return false;
	      let minDay = Infinity;
	      let maxDay = -Infinity;
	      for (const span of spans) {
	        if (!span) continue;
	        minDay = Math.min(minDay, span.startDay);
	        maxDay = Math.max(maxDay, span.endDay);
	      }
	      if (!Number.isFinite(minDay) || !Number.isFinite(maxDay)) return false;
	      return this._ensureRangeCoversSpan(minDay, maxDay);
	    }

    _bindOutsideSubscriptionClickToClearSelectedId() {
		      // 用户已选取某个订阅服务后，点击其他区域可取消该订阅的高亮选取
		      if (!global?.addEventListener) return;

		      global.addEventListener("click", (e) => {
		        if (this._shouldSuppressClick()) return;
		        if (!this.selectedId) return;
		        const target = e.target;
		        // 弹窗内交互不应清空选中的订阅（编辑态需要保持左右同步高亮）
		        if (target?.closest?.(".modal")) return;
		        if (target?.closest?.(".subscription-bar")) return;
		        if (target?.closest?.(".y-row")) return;
		        this.setSelectedId(null);
		      });
		    }

		    _bindXAxisSelection() {
		      // X 轴可点击选取：支持选取 日 / 月 / 年 的“整段范围”
		      if (!this.xAxis || !this.scroller) return;

		      this.xAxis.addEventListener("click", (e) => {
	        if (this._shouldSuppressClick()) return;

	        // 根据点击的“表头行”决定选取粒度：年行 / 月行 / 日行
	        const axisRect = this.xAxis.getBoundingClientRect();
	        const offsetY = e.clientY - axisRect.top;
	        const yearBand = this._getCssPx(this.grid, "--axis-year-band", 24);
	        const monthBand = this._getCssPx(this.grid, "--axis-month-band", 24);
	        const kind =
	          offsetY < yearBand
	            ? SELECTION_KIND_YEAR
	            : offsetY < yearBand + monthBand
	              ? SELECTION_KIND_MONTH
	              : SELECTION_KIND_DAY;

	        const rect = this.scroller.getBoundingClientRect();
	        const scrollerX = e.clientX - rect.left;
	        const dayFloat = this._getDayAtScrollerX(scrollerX);
	        if (!Number.isFinite(dayFloat)) return;

	        const day = utils.clamp(Math.floor(dayFloat), this.rangeStartDay, this.rangeEndDay);
	        this.setSelectedTime(kind, day);
		      });
		    }

			    _bindSummaryAxisSelection() {
			      // 底部冻结行（花费统计）：与顶部冻结行保持一致，也支持点击选取 日 / 月 / 年
			      if (!this.summaryAxis || !this.scroller) return;

			      this.summaryAxis.addEventListener("click", (e) => {
			        if (this._shouldSuppressClick()) return;

			        const axisRect = this.summaryAxis.getBoundingClientRect();
			        const offsetY = e.clientY - axisRect.top;
			        const axisHeight = this._getCssPx(this.grid, "--axis-height", Number(this.axisHeight) || 72);
			        const yearBand = this._getCssPx(this.grid, "--axis-year-band", 24);
			        const monthBand = this._getCssPx(this.grid, "--axis-month-band", 24);
			        const dayBand = Math.max(0, axisHeight - yearBand - monthBand);
			        const kind =
			          offsetY < dayBand
			            ? SELECTION_KIND_DAY
			            : offsetY < dayBand + monthBand
			              ? SELECTION_KIND_MONTH
			              : SELECTION_KIND_YEAR;

			        const rect = this.scroller.getBoundingClientRect();
			        const scrollerX = e.clientX - rect.left;
			        const dayFloat = this._getDayAtScrollerX(scrollerX);
			        if (!Number.isFinite(dayFloat)) return;

		        const day = utils.clamp(Math.floor(dayFloat), this.rangeStartDay, this.rangeEndDay);
		        this.setSelectedTime(kind, day);
		      });
		    }

		    _bindCanvasSelection() {
		      // 主画布空白处点击：同样允许“选取时间范围”（不影响色块点击进入编辑）
		      if (!this.canvas || !this.scroller) return;

	      this.canvas.addEventListener("click", (e) => {
	        if (this._shouldSuppressClick()) return;

        // 点击订阅色块时，仍以“进入编辑”为主，不在此处触发选取
        const target = e.target;
        if (target?.closest?.(".subscription-bar")) return;

        const rect = this.scroller.getBoundingClientRect();
        const scrollerX = e.clientX - rect.left;
	        const dayFloat = this._getDayAtScrollerX(scrollerX);
	        if (!Number.isFinite(dayFloat)) return;

	        const day = utils.clamp(Math.floor(dayFloat), this.rangeStartDay, this.rangeEndDay);
	        // 画布上没有“年/月/日三行”，因此按当前可见最细粒度来选取：
	        // - 日刻度可见 => 选日
	        // - 日刻度隐藏 => 选月
	        // - 月刻度隐藏 => 选年
	        this.setSelectedTime(this._getLowestDisplayableSelectionKind(), day);
	      });
	    }

    _bindWheelToZoom() {
      // Excel 风格：Ctrl/⌘ + 滚轮（触控板）缩放
      const scroller = this.scroller;
      if (!scroller) return;

      scroller.addEventListener(
        "wheel",
        (e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();

          const rect = scroller.getBoundingClientRect();
          const anchorX = e.clientX - rect.left;

          const deltaY = wheelDeltaYPixels(e, scroller.clientHeight);
          // 使用指数映射，适配鼠标滚轮与触控板的不同 delta
          const scale = Math.exp(-deltaY / 520);
          const target = this.dayWidth * scale;
          this.setDayWidth(target, { anchorX });
        },
        { passive: false }
      );
    }

    _notifySelectionChange() {
      if (typeof this.onSelectionChange !== "function") return;
      const info = this.getSelectedTotalsInfo();
      this.onSelectionChange(info);
    }

    _bindDragToScroll() {
      // 鼠标“按住拖动”即可上下左右平移坐标轴（类似地图拖拽）
      const scroller = this.scroller;
      if (!scroller) return;

      let isPointerDown = false;
      let isDragging = false;
      let activePointerId = null;
      let startX = 0;
      let startY = 0;
      let startScrollLeft = 0;
      let startScrollTop = 0;

      const DRAG_THRESHOLD_PX = 3;

      function onPointerMove(e) {
        if (!isPointerDown || activePointerId == null || e.pointerId !== activePointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging) {
          if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
          isDragging = true;
          scroller.classList.add("is-dragging");
          try {
            scroller.setPointerCapture(e.pointerId);
          } catch {
            // 忽略：部分环境可能不支持 pointer capture
          }
        }

        scroller.scrollLeft = startScrollLeft - dx;
        scroller.scrollTop = startScrollTop - dy;
        e.preventDefault();
      }

      const endDrag = () => {
        if (!isPointerDown) return;
        const pointerIdToRelease = activePointerId;
        isPointerDown = false;
        scroller.classList.remove("is-dragging");

        if (isDragging) {
          // click 事件一般会在 pointerup 后触发，因此用一个短窗口抑制它
          this._suppressClickUntil = (global.performance?.now?.() || Date.now()) + 220;
        }
        isDragging = false;

        try {
          // 如果之前捕获过指针，释放它
          if (pointerIdToRelease != null) scroller.releasePointerCapture(pointerIdToRelease);
        } catch {
          // ignore
        }

        activePointerId = null;
      };

	      scroller.addEventListener("pointerdown", (e) => {
	        // 仅处理鼠标左键拖动；触控设备保留原生滚动体验
	        if (e.pointerType !== "mouse") return;
	        if (e.button !== 0) return;
	
	        // 交互控件（点击/编辑/选取）不触发“拖拽平移”，避免轻微抖动导致 click 被抑制
	        const target = e.target;
	        if (target?.closest?.("button, a, input, textarea, select, .subscription-bar, .y-row, .tick, .wheel")) return;

	        isPointerDown = true;
	        isDragging = false;
	        activePointerId = e.pointerId;
	        startX = e.clientX;
        startY = e.clientY;
        startScrollLeft = scroller.scrollLeft;
        startScrollTop = scroller.scrollTop;
      });

      scroller.addEventListener("pointermove", onPointerMove, { passive: false });
      scroller.addEventListener("pointerup", endDrag);
      scroller.addEventListener("pointercancel", endDrag);
      scroller.addEventListener("lostpointercapture", endDrag);
    }

    _shouldSuppressClick() {
      const now = global.performance?.now?.() || Date.now();
      return now < (this._suppressClickUntil || 0);
    }

    _normalizeAnchorX(anchorX) {
      const viewportWidth = this.scroller?.clientWidth || 0;
      if (viewportWidth <= 0) return this.labelWidth;

      const timelineViewport = Math.max(0, viewportWidth - this.labelWidth);
      const defaultX = this.labelWidth + timelineViewport / 2;
      if (!Number.isFinite(anchorX)) return defaultX;

      // 当视口比左侧标签更窄时，直接使用中心点作为锚（此时时间轴区域几乎不可见）
      if (viewportWidth <= this.labelWidth) return viewportWidth / 2;

      return utils.clamp(anchorX, this.labelWidth, viewportWidth);
    }

    _getDayAtScrollerX(scrollerX) {
      // scrollerX 是滚动容器内的“视口坐标”，转换成“天”（可带小数）用于缩放锚点
      return this.rangeStartDay + (this.scroller.scrollLeft + scrollerX - this.labelWidth) / this.dayWidth;
    }

    _scrollToKeepDayAtX(dayNumberFloat, scrollerX) {
      const target = this.labelWidth + (dayNumberFloat - this.rangeStartDay) * this.dayWidth - scrollerX;
      const maxScrollLeft = Math.max(0, this.scroller.scrollWidth - this.scroller.clientWidth);
      this.scroller.scrollLeft = utils.clamp(target, 0, maxScrollLeft);
    }

	    _syncLayoutFromViewport() {
	      const viewportWidth = this.scroller?.clientWidth || global.innerWidth || 0;

	      // 移动端/窄屏：减少左侧宽度，略增行高便于点击
	      if (viewportWidth && viewportWidth < 560) {
	        this.labelWidth = 240;
	        this.axisHeight = 64;
	        // 需求：底部“花费统计”与顶部“日期显示”模块完全一致
	        this.summaryHeight = this.axisHeight;
	        this.rowHeight = Math.round(54 * ROW_HEIGHT_SCALE);
	        return;
	      }

	      if (viewportWidth && viewportWidth < 860) {
	        this.labelWidth = 280;
	        this.axisHeight = 70;
	        // 需求：底部“花费统计”与顶部“日期显示”模块完全一致
	        this.summaryHeight = this.axisHeight;
	        this.rowHeight = Math.round(52 * ROW_HEIGHT_SCALE);
	        return;
	      }

	      this.labelWidth = 320;
	      this.axisHeight = 72;
	      // 需求：底部“花费统计”与顶部“日期显示”模块完全一致
	      this.summaryHeight = this.axisHeight;
	      this.rowHeight = Math.round(48 * ROW_HEIGHT_SCALE);
	    }

    _applyCssVars() {
      const timelineDays = Math.max(1, this.rangeEndDay - this.rangeStartDay + 1);
      const timelineWidth = timelineDays * this.dayWidth;

      this.grid.style.setProperty("--day-width", `${this.dayWidth}px`);
      this.grid.style.setProperty("--label-width", `${this.labelWidth}px`);
      this.grid.style.setProperty("--axis-height", `${this.axisHeight}px`);
      this.grid.style.setProperty("--summary-height", `${this.summaryHeight}px`);
      this.grid.style.setProperty("--row-height", `${this.rowHeight}px`);
      this.grid.style.setProperty("--row-gap", `${this.rowGap}px`);
      this.grid.style.setProperty("--timeline-width", `${timelineWidth}px`);

      // 动态合成：日刻度在缩小到一定程度时自动隐藏（< 15 px/天 不显示日网格/日行）
      const shouldHideDayGrid = this.dayWidth < SHOW_DAY_SCALE_AT_OR_ABOVE;
      this.grid.classList.toggle("is-day-grid-hidden", shouldHideDayGrid);

      // 动态合成：月刻度线在进一步缩小后自动隐藏（阈值包含边界值）
      const shouldHideMonthGrid = this.dayWidth < SHOW_MONTH_SCALE_AT_OR_ABOVE;
      this.grid.classList.toggle("is-month-grid-hidden", shouldHideMonthGrid);
    }

    _ensureRangeForSubscriptions() {
      const today = clampDayToSupportedRange(utils.getTodayDayNumber());
      let minDay = today - 365;
      let maxDay = today + 730;

      for (const sub of this.subscriptions) {
        const startRaw = utils.parseISODateToDayNumber(sub.startDate);
        if (startRaw == null) continue;
        const start = clampDayToSupportedRange(startRaw);
        const endRaw = utils.parseISODateToDayNumber(sub.endDate);
        const end = endRaw != null ? clampDayToSupportedRange(endRaw) : null;
        minDay = Math.min(minDay, start - 30);
        maxDay = Math.max(maxDay, start + 365);
        if (end != null && end >= start) maxDay = Math.max(maxDay, end + 30);
      }

	      // 若用户已选取某个时间范围（日/月/年），尽量保证选取仍在范围内
	      const selectedSpans = this._getSelectedSpans({ effective: true });
	      if (selectedSpans.length) {
	        for (const span of selectedSpans) {
	          if (!span) continue;
	          minDay = Math.min(minDay, span.startDay - 30);
	          maxDay = Math.max(maxDay, span.endDay + 30);
	        }
	      }

      minDay = Math.max(MIN_SUPPORTED_DAY, minDay);
      maxDay = Math.min(MAX_SUPPORTED_DAY, maxDay);

      // 注意：不要“缩回”范围（否则用户一旦滚动扩展过时间轴，后续 re-render 会把范围重置，
      // 造成视图闪烁/跳动，甚至看起来像自动跳回“今天”）。
      const oldStart = this.rangeStartDay;
      const oldEnd = this.rangeEndDay;
      const nextStart = Math.max(MIN_SUPPORTED_DAY, Math.min(oldStart, minDay));
      const nextEnd = Math.min(MAX_SUPPORTED_DAY, Math.max(oldEnd, maxDay));

      if (nextStart === oldStart && nextEnd === oldEnd) return;

      // 扩展左侧会把所有内容向右推：补偿 scrollLeft 以保持用户视图不动
      const addedLeftDays = oldStart - nextStart;

      this.rangeStartDay = nextStart;
      this.rangeEndDay = nextEnd;
      this._applyCssVars();

      if (addedLeftDays > 0 && this.scroller) {
        this.scroller.scrollLeft += addedLeftDays * this.dayWidth;
      }
    }

    _ensureRangeCoversDay(dayNumber) {
      const day = clampDayToSupportedRange(dayNumber);
      const extendBy = 365;
      if (day < this.rangeStartDay) {
        const need = this.rangeStartDay - day + 30;
        const chunks = Math.ceil(need / extendBy);
        this._extendLeft(chunks * extendBy);
      }
      if (day > this.rangeEndDay) {
        const need = day - this.rangeEndDay + 30;
        const chunks = Math.ceil(need / extendBy);
        this._extendRight(chunks * extendBy);
      }
    }

    _maybeExtendRangeOnScroll() {
      if (this._isExtending) return;
      if (this.rangeStartDay <= MIN_SUPPORTED_DAY && this.rangeEndDay >= MAX_SUPPORTED_DAY) return;
      const thresholdDays = 140;
      const thresholdPx = thresholdDays * this.dayWidth;

      const maxScrollLeft = this.scroller.scrollWidth - this.scroller.clientWidth;
      const leftDistance = this.scroller.scrollLeft;
      const rightDistance = maxScrollLeft - this.scroller.scrollLeft;

      if (leftDistance < thresholdPx && this.rangeStartDay > MIN_SUPPORTED_DAY) {
        this._extendLeft(365);
        return;
      }
      if (rightDistance < thresholdPx && this.rangeEndDay < MAX_SUPPORTED_DAY) {
        this._extendRight(365);
      }
    }

    _extendLeft(days) {
      this._isExtending = true;
      const requested = Math.max(1, days);
      const nextStart = Math.max(MIN_SUPPORTED_DAY, this.rangeStartDay - requested);
      const addedDays = this.rangeStartDay - nextStart;
      if (addedDays <= 0) {
        this._isExtending = false;
        return;
      }
      this.rangeStartDay = nextStart;
      this._applyCssVars();
      this.render();
      this.scroller.scrollLeft += addedDays * this.dayWidth;
      this._updateLineLabelPositions();
      this._isExtending = false;
    }

    _extendRight(days) {
      this._isExtending = true;
      const requested = Math.max(1, days);
      const nextEnd = Math.min(MAX_SUPPORTED_DAY, this.rangeEndDay + requested);
      const addedDays = nextEnd - this.rangeEndDay;
      if (addedDays <= 0) {
        this._isExtending = false;
        return;
      }
      this.rangeEndDay = nextEnd;
      this._applyCssVars();
      this.render();
      this._isExtending = false;
    }

    _getCenterDay() {
      const viewportTimelineWidth = Math.max(0, this.scroller.clientWidth - this.labelWidth);
      if (viewportTimelineWidth <= 0) return null;
      const centerX = this.scroller.scrollLeft + viewportTimelineWidth / 2;
      const day = this.rangeStartDay + Math.round(centerX / this.dayWidth);
      return day;
    }

		    render(options) {
		      // 当“日/月”刻度线因缩放被隐藏时，选取效果会自动提升到更粗粒度；
		      // 此处确保当前渲染范围覆盖“有效选取范围”，避免出现只高亮到半个月/半年这种截断效果。
		      this._ensureRangeCoversEffectiveSelectedSpans();
      this._renderXAxis();
      this._renderRows({ preserveYAxis: options?.preserveYAxis === true });
      this._renderSummary();
      this._updateTodayIndicator();
      this._updatePeriodHighlights();
      this._updateSelectedIndicator();
	      this._updateTickSelectionStyles();
	      this._autoHideCrowdedAxisLabels();
	      this._updateSelectionStyles();
	    }

	    _autoHideCrowdedAxisLabels() {
	      // 缩放导致“日/月/年”文本挤在一起时，自动隐藏会重叠的标签（保持表头干净）
      const axisLayer = this.xAxis?.querySelector?.(".axis-layer");
      const summaryLayer = this.summaryAxis?.querySelector?.(".axis-layer");
      if (!axisLayer && !summaryLayer) return;

      // 顶部冻结行：当“日文本/月文本”被隐藏时，剩余层吃掉空间（更像 Excel 的合并视觉）
      this._syncAxisBandLayoutByVisibleLabels(axisLayer || summaryLayer);
    }

    _autoHideOverlappingLabels(rootEl, selector, minGapPx) {
      if (!rootEl) return;
      const labels = Array.from(rootEl.querySelectorAll(selector));
      if (!labels.length) return;

      // 先恢复可见（避免上一次 render 的隐藏状态残留）
      for (const label of labels) {
        label.style.visibility = "";
      }

      const items = [];
      for (const label of labels) {
        const rect = label.getBoundingClientRect();
        if (!rect || rect.width <= 0) continue;
        items.push({ label, left: rect.left, right: rect.right });
      }
      items.sort((a, b) => a.left - b.left);

      let lastRight = -Infinity;
      for (const item of items) {
        if (item.left < lastRight + (Number(minGapPx) || 0)) {
          item.label.style.visibility = "hidden";
          continue;
        }
        lastRight = item.right;
      }
    }

    _autoHideLabelGroupWhenCrowded(rootEl, selector, minGapPx) {
      if (!rootEl) return;
      const labels = Array.from(rootEl.querySelectorAll(selector));
      if (!labels.length) return;

      // 先恢复可见（避免上一次 render 的隐藏状态残留）
      for (const label of labels) {
        label.style.visibility = "";
      }

      const items = [];
      for (const label of labels) {
        const rect = label.getBoundingClientRect();
        if (!rect || rect.width <= 0) continue;
        items.push({ left: rect.left, right: rect.right });
      }
      if (items.length <= 1) return;
      items.sort((a, b) => a.left - b.left);

      const gap = Number(minGapPx) || 0;
      let lastRight = -Infinity;
      let isCrowded = false;
      for (const item of items) {
        if (item.left < lastRight + gap) {
          isCrowded = true;
          break;
        }
        lastRight = item.right;
      }

      if (!isCrowded) return;
      for (const label of labels) {
        label.style.visibility = "hidden";
      }
    }

    _syncAxisBandLayoutByVisibleLabels(axisLayerEl) {
      if (!this.grid || !axisLayerEl) return;

      // “动态合成”逻辑：
      // - “日”网格线与顶部“日单元格”：仅在 >= SHOW_DAY_SCALE_AT_OR_ABOVE 时显示
      // - “月”刻度线与顶部“月单元格”：仅在 >= SHOW_MONTH_SCALE_AT_OR_ABOVE 时显示
      // - 月隐藏时，日也隐藏（层级关系：年 > 月 > 日）
      const hideMonth = this.dayWidth < SHOW_MONTH_SCALE_AT_OR_ABOVE;
      const hideDay = this.dayWidth < SHOW_DAY_SCALE_AT_OR_ABOVE || hideMonth;

      // 同步网格线显示状态（顶部冻结行 / 主画布 / 底部合计行共享同一组 class）
      this.grid.classList.toggle("is-day-grid-hidden", hideDay);
      this.grid.classList.toggle("is-month-grid-hidden", hideMonth);

      const isMonthVisible = !hideMonth;
      const isDayVisible = !hideDay;

      const axisHeight = Number(this.axisHeight) || 72;
      const half = axisHeight / 2;

      // 三层完整显示：回到默认（CSS 中的 24/24/其余）
      if (isMonthVisible && isDayVisible) {
        this.grid.classList.remove("is-axis-year-only", "is-axis-year-month");
        this.grid.style.removeProperty("--axis-year-band");
        this.grid.style.removeProperty("--axis-month-band");
        return;
      }

      // “月”隐藏：年独占整个顶部冻结行（不管日是否可见）
      if (!isMonthVisible) {
        this.grid.classList.add("is-axis-year-only");
        this.grid.classList.remove("is-axis-year-month");
        this.grid.style.setProperty("--axis-year-band", `${axisHeight}px`);
        this.grid.style.setProperty("--axis-month-band", "0px");
        return;
      }

      // “日”隐藏：年/月 平分顶部冻结行
      if (isMonthVisible && !isDayVisible) {
        this.grid.classList.add("is-axis-year-month");
        this.grid.classList.remove("is-axis-year-only");
        this.grid.style.setProperty("--axis-year-band", `${half}px`);
        this.grid.style.setProperty("--axis-month-band", `${half}px`);
        return;
      }

      // 兜底：不动（交给默认三层）
      this.grid.classList.remove("is-axis-year-only", "is-axis-year-month");
      this.grid.style.removeProperty("--axis-year-band");
      this.grid.style.removeProperty("--axis-month-band");
    }

    _isAxisLabelGroupVisible(rootEl, selector) {
      if (!rootEl) return false;
      const el = rootEl.querySelector(selector);
      if (!el) return false;
      if (!global.getComputedStyle) return true;
      const style = global.getComputedStyle(el);
      if (!style) return true;
      if (style.display === "none") return false;
      if (style.visibility === "hidden") return false;
      return true;
    }

	    _renderSummary() {
	      if (!this.summaryAxis) return;

      if (this.summaryCorner) {
        const titleEl =
          this.summaryCorner.querySelector?.('[data-role="summary-corner-title"]') || this.summaryCorner;
        titleEl.textContent = "花费合计（USD）";
      }

	      this.summaryAxis.innerHTML = "";

	      // 需求：底部“花费统计”模块与顶部“日期显示”模块结构完全一致
	      // （仅把显示内容从“日期文本”替换为“花费 sum”）
      const layer = document.createElement("div");
      layer.className = "axis-layer axis-layer--summary";

      // 本年/本月高亮（在刻度线下方）
      const yearBand = document.createElement("div");
      yearBand.className = "year-band";
      yearBand.dataset.role = "year-band";
      layer.appendChild(yearBand);

      const monthBand = document.createElement("div");
      monthBand.className = "month-band";
      monthBand.dataset.role = "month-band";
      layer.appendChild(monthBand);

      // 今天高亮（在刻度线下方）
      const todayBand = document.createElement("div");
      todayBand.className = "today-band";
      todayBand.dataset.role = "today-band";
      layer.appendChild(todayBand);

	      // 选中列（在刻度线下方）
	      const selectedGroup = document.createElement("div");
	      selectedGroup.className = "selected-band-group";
	      selectedGroup.dataset.role = "selected-band-group";
	      if (!this.selectedTimes || !this.selectedTimes.length) selectedGroup.hidden = true;
	      layer.appendChild(selectedGroup);

	      const { dayTotals, monthTotals, yearTotals } = this._computeChargeTotalsInRange();
	      this._lastChargeTotals = { dayTotals, monthTotals, yearTotals };

	      // 月刻度（显示“月合计”）
	      const monthTicks = this._buildMonthTotalTicks(monthTotals);
	      for (const tick of monthTicks) layer.appendChild(tick);

	      // 年刻度（显示“年合计”）
	      const yearTicks = this._buildYearTotalTicks(yearTotals);
	      for (const tick of yearTicks) layer.appendChild(tick);

	      // 日刻度（显示“日合计”）
	      const dayTicks = this._buildDayTotalTicks(dayTotals);
	      for (const tick of dayTicks) layer.appendChild(tick);

	      this.summaryAxis.appendChild(layer);
	    }

    _computeChargeTotalsInRange() {
      // 统计口径：
      // - 所有订阅周期都把“当期花费”均分到该周期内的每一天（用于底部合计展示）
      const rangeStart = this.rangeStartDay;
      const rangeEnd = this.rangeEndDay;

      const dayTotals = new Map(); // dayNumber -> Map<currency, sum>
      const monthTotals = new Map(); // monthKey(year*12+monthIndex) -> Map<currency, sum>
      const yearTotals = new Map(); // year -> Map<currency, sum>

      const addTo = (bucketMap, key, currency, delta) => {
        if (!Number.isFinite(delta) || delta === 0) return;
        let inner = bucketMap.get(key);
        if (!inner) {
          inner = new Map();
          bucketMap.set(key, inner);
        }
        inner.set(currency, (inner.get(currency) || 0) + delta);
      };

      const addDailyRange = (startDay, endDay, currency, perDay) => {
        if (!Number.isFinite(perDay) || perDay === 0) return;
        for (let d = startDay; d <= endDay; d += 1) {
          addTo(dayTotals, d, currency, perDay);
          const parts = utils.dayNumberToParts(d);
          addTo(monthTotals, parts.year * 12 + parts.monthIndex, currency, perDay);
          addTo(yearTotals, parts.year, currency, perDay);
        }
      };

	      for (const sub of this.subscriptions) {
	        const startDay = utils.parseISODateToDayNumber(sub.startDate);
	        if (startDay == null) continue;
	        const endRaw = utils.parseISODateToDayNumber(sub.endDate);
	        const endDay = endRaw != null ? endRaw : null;
	        if (endDay != null && endDay < startDay) continue;
	        const price = Number(sub.price);
	        if (!Number.isFinite(price) || price <= 0) continue;
	        const currency = normalizeCurrency(sub.currency);
	        const cycle = normalizeCycle(sub.cycle);

	        const effectiveRangeEnd = endDay != null ? Math.min(rangeEnd, endDay) : rangeEnd;
	        if (effectiveRangeEnd < rangeStart) continue;

          const startParts = utils.dayNumberToParts(startDay);
          const rangeParts = utils.dayNumberToParts(rangeStart);

          const getPeriodStartByStep = (step) => {
            if (cycle === "weekly") return startDay + step * 7;
            const parts =
              cycle === "monthly" ? utils.addMonthsClamped(startParts, step) : utils.addYearsClamped(startParts, step);
            return utils.toDayNumberUTC(parts.year, parts.monthIndex, parts.day);
          };

          const getNextStartByStep = (step) => {
            if (cycle === "weekly") return startDay + step * 7;
            const parts =
              cycle === "monthly" ? utils.addMonthsClamped(startParts, step) : utils.addYearsClamped(startParts, step);
            return utils.toDayNumberUTC(parts.year, parts.monthIndex, parts.day);
          };

          let step = 0;
          if (startDay < rangeStart) {
            if (cycle === "weekly") {
              step = Math.max(0, Math.floor((rangeStart - startDay) / 7));
            } else if (cycle === "monthly") {
              step =
                (rangeParts.year - startParts.year) * 12 + (rangeParts.monthIndex - startParts.monthIndex);
            } else {
              step = rangeParts.year - startParts.year;
            }
            step = Math.max(0, step);
            if (step > 0 && cycle !== "weekly") {
              const candidate = getPeriodStartByStep(step);
              if (candidate > rangeStart) step -= 1;
            }
          }

          let guard = 0;
          while (true) {
            const periodStart = getPeriodStartByStep(step);
            if (periodStart > effectiveRangeEnd) break;

            const nextStart = getNextStartByStep(step + 1);
            let periodEnd = nextStart - 1;
            if (endDay != null) periodEnd = Math.min(periodEnd, endDay);

            if (periodEnd < rangeStart) {
              step += 1;
              guard += 1;
              if (guard > 6000) break;
              continue;
            }

            const overlapStart = Math.max(periodStart, rangeStart);
            const overlapEnd = Math.min(periodEnd, effectiveRangeEnd);
            if (overlapEnd >= overlapStart) {
              const periodDays = Math.max(1, periodEnd - periodStart + 1);
              const perDay = price / periodDays;
              addDailyRange(overlapStart, overlapEnd, currency, perDay);
            }

            if (endDay != null && periodEnd >= endDay) break;
            step += 1;
            guard += 1;
            if (guard > 6000) break;
          }
	      }

      return { dayTotals, monthTotals, yearTotals };
    }

    _forEachChargeDayInRange(params, onDay) {
      const startDay = params.startDay;
      const cycle = normalizeCycle(params.cycle);
      const rangeStart = params.rangeStart;
      const rangeEnd = params.rangeEnd;

      if (!Number.isFinite(startDay) || !Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return;
      if (rangeEnd < rangeStart) return;

      if (cycle === "weekly") {
        const step = 7;
        let first = startDay;
        if (first < rangeStart) {
          const delta = rangeStart - first;
          first += Math.ceil(delta / step) * step;
        }
        for (let d = first; d <= rangeEnd; d += step) onDay(d);
        return;
      }

      if (cycle === "monthly" || cycle === "yearly") {
        const startParts = utils.dayNumberToParts(startDay);
        const rangeParts = utils.dayNumberToParts(rangeStart);

        let step = 0;
        if (startDay < rangeStart) {
          if (cycle === "monthly") {
            step =
              (rangeParts.year - startParts.year) * 12 + (rangeParts.monthIndex - startParts.monthIndex);
          } else {
            step = rangeParts.year - startParts.year;
          }
          step = Math.max(0, step);

          // 纠偏：候选日期可能仍在 rangeStart 之前
          while (true) {
            const nextParts =
              cycle === "monthly" ? utils.addMonthsClamped(startParts, step) : utils.addYearsClamped(startParts, step);
            const candidate = utils.toDayNumberUTC(nextParts.year, nextParts.monthIndex, nextParts.day);
            if (candidate >= rangeStart) break;
            step += 1;
            if (step > 6000) break; // 防御：异常数据避免死循环
          }
        }

        let guard = 0;
        while (true) {
          const nextParts =
            cycle === "monthly" ? utils.addMonthsClamped(startParts, step) : utils.addYearsClamped(startParts, step);
          const day = utils.toDayNumberUTC(nextParts.year, nextParts.monthIndex, nextParts.day);
          if (day > rangeEnd) break;
          if (day >= rangeStart) onDay(day);
          step += 1;
          guard += 1;
          if (guard > 6000) break;
        }
      }
    }

    _formatTotalsInline(totalsMap) {
      if (!totalsMap || !(totalsMap instanceof Map) || !totalsMap.size) return "";
      const entries = Array.from(totalsMap.entries())
        .filter(([, v]) => Number.isFinite(v) && v !== 0)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      if (!entries.length) return "";
      if (entries.length === 1) return utils.formatMoney(entries[0][1], entries[0][0]);
      const first = `${entries[0][0]} ${entries[0][1].toFixed(2)}`;
      return `${first} +${entries.length - 1}`;
    }

    _formatTotalsTitle(totalsMap) {
      if (!totalsMap || !(totalsMap instanceof Map) || !totalsMap.size) return "";
      const entries = Array.from(totalsMap.entries())
        .filter(([, v]) => Number.isFinite(v) && v !== 0)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      if (!entries.length) return "";
      return entries.map(([c, v]) => utils.formatMoney(v, c)).join(" / ");
    }

    _renderYearTotalsRow(container, yearTotals) {
      if (!container) return;
      container.innerHTML = "";

      let cursor = utils.dayNumberToUTCDate(this.rangeStartDay);
      cursor.setUTCMonth(0);
      cursor.setUTCDate(1);

      const firstYearStart = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
      if (firstYearStart < this.rangeStartDay) cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);

      while (true) {
        const dayNum = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
        if (dayNum > this.rangeEndDay) break;
        const year = cursor.getUTCFullYear();

        const totals = yearTotals.get(year);
        const text = this._formatTotalsInline(totals);
        if (text) {
          const nextYearStart = utils.toDayNumberUTC(year + 1, 0, 1);
          const widthDays = Math.max(1, Math.min(nextYearStart, this.rangeEndDay + 1) - dayNum);
          const leftPx = (dayNum - this.rangeStartDay) * this.dayWidth;
          const widthPx = widthDays * this.dayWidth;

          const cell = document.createElement("div");
          cell.className = "summary-cell";
          cell.style.left = `${leftPx}px`;
          cell.style.width = `${widthPx}px`;
          cell.textContent = text;
          cell.title = this._formatTotalsTitle(totals);
          container.appendChild(cell);
        }

        cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
      }
    }

    _renderMonthTotalsRow(container, monthTotals) {
      if (!container) return;
      container.innerHTML = "";

      let cursor = utils.dayNumberToUTCDate(this.rangeStartDay);
      cursor.setUTCDate(1);

      const firstMonthStart = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
      if (firstMonthStart < this.rangeStartDay) cursor.setUTCMonth(cursor.getUTCMonth() + 1);

      while (true) {
        const dayNum = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
        if (dayNum > this.rangeEndDay) break;

        const year = cursor.getUTCFullYear();
        const monthIndex = cursor.getUTCMonth();
        const key = year * 12 + monthIndex;
        const totals = monthTotals.get(key);
        const text = this._formatTotalsInline(totals);

        if (text) {
          const next = new Date(cursor.getTime());
          next.setUTCMonth(monthIndex + 1);
          const nextStart = Math.floor(next.getTime() / utils.MS_PER_DAY);
          const widthDays = Math.max(1, Math.min(nextStart, this.rangeEndDay + 1) - dayNum);
          const leftPx = (dayNum - this.rangeStartDay) * this.dayWidth;
          const widthPx = widthDays * this.dayWidth;

          const cell = document.createElement("div");
          cell.className = "summary-cell";
          cell.style.left = `${leftPx}px`;
          cell.style.width = `${widthPx}px`;
          cell.textContent = text;
          cell.title = `${year}-${String(monthIndex + 1).padStart(2, "0")}：${this._formatTotalsTitle(totals)}`;
          container.appendChild(cell);
        }

        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }

	    _renderDayTotalsRow(container, dayTotals) {
	      if (!container) return;
	      container.innerHTML = "";

	      // 日级别非常密：只用“标记条”呈现，并提供 hover title
	      for (const [day, totals] of dayTotals.entries()) {
        if (!Number.isFinite(day)) continue;
        if (day < this.rangeStartDay || day > this.rangeEndDay) continue;
        const leftPx = (day - this.rangeStartDay) * this.dayWidth;
        const widthPx = Math.max(1, this.dayWidth);

        const marker = document.createElement("div");
        marker.className = "summary-marker";
        if (totals && totals.size > 1) marker.classList.add("is-multi");
        marker.style.left = `${leftPx}px`;
        marker.style.width = `${widthPx}px`;
        marker.title = `${utils.dayNumberToISODate(day)}：${this._formatTotalsTitle(totals)}`;
	        container.appendChild(marker);
	      }
	    }

	    _buildYearTotalTicks(yearTotals) {
	      const ticks = [];
	      let cursor = utils.dayNumberToUTCDate(this.rangeStartDay);
	      cursor.setUTCMonth(0);
	      cursor.setUTCDate(1);

	      const firstYearStart = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
	      if (firstYearStart < this.rangeStartDay) cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);

	      while (true) {
	        const dayNum = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
	        if (dayNum > this.rangeEndDay) break;
	        const leftPx = (dayNum - this.rangeStartDay) * this.dayWidth;
	        const year = cursor.getUTCFullYear();

	        const tick = document.createElement("div");
	        tick.className = "tick tick--year";
	        tick.style.left = `${leftPx}px`;
	        tick.dataset.day = String(dayNum);
	        tick.setAttribute("role", "button");
	        tick.tabIndex = 0;
	        tick.setAttribute("aria-selected", "false");
	        tick.title = "点击选取该刻度";

	        const line = document.createElement("div");
	        line.className = "tick__line";

	        const label = document.createElement("div");
	        label.className = "tick__label";

	        const totals = yearTotals instanceof Map ? yearTotals.get(year) : null;
	        const text = this._formatTotalsInline(totals);
	        label.textContent = text;

	        const nextYearStart = utils.toDayNumberUTC(year + 1, 0, 1);
	        const visibleEnd = Math.min(nextYearStart, this.rangeEndDay + 1);
	        const widthDays = Math.max(1, visibleEnd - dayNum);
	        const midDay = dayNum + widthDays / 2;
	        label.style.left = `${(midDay - dayNum) * this.dayWidth}px`;
	        label.style.transform = "translateX(-50%)";
	        const widthPx = widthDays * this.dayWidth;
	        label.style.maxWidth = `${Math.max(0, widthPx - 12)}px`;

	        tick.setAttribute(
	          "aria-label",
	          text ? `选取：${utils.dayNumberToISODate(dayNum)}（${year}年，合计 ${text}）` : `选取：${utils.dayNumberToISODate(dayNum)}（${year}年）`
	        );

	        tick.appendChild(line);
	        tick.appendChild(label);
	        ticks.push(tick);

	        tick.addEventListener("click", (e) => {
	          if (this._shouldSuppressClick()) return;
	          e.preventDefault();
	          e.stopPropagation();
	          this.setSelectedTime(SELECTION_KIND_YEAR, dayNum);
	        });

	        tick.addEventListener("keydown", (e) => {
	          if (e.key !== "Enter" && e.key !== " ") return;
	          e.preventDefault();
	          this.setSelectedTime(SELECTION_KIND_YEAR, dayNum);
	        });

	        cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
	      }

	      return ticks;
	    }

	    _buildMonthTotalTicks(monthTotals) {
	      const ticks = [];

	      // 动态合成：月刻度线隐藏时不渲染月刻度（与顶部冻结行保持一致）
	      if (this.dayWidth < SHOW_MONTH_SCALE_AT_OR_ABOVE) return ticks;

	      let cursor = utils.dayNumberToUTCDate(this.rangeStartDay);
	      cursor.setUTCDate(1);

	      const firstMonthStart = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
	      if (firstMonthStart < this.rangeStartDay) cursor.setUTCMonth(cursor.getUTCMonth() + 1);

	      while (true) {
	        const dayNum = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
	        if (dayNum > this.rangeEndDay) break;
	        const leftPx = (dayNum - this.rangeStartDay) * this.dayWidth;
	        const year = cursor.getUTCFullYear();
	        const monthIndex = cursor.getUTCMonth();
	        const key = year * 12 + monthIndex;

	        const tick = document.createElement("div");
	        tick.className = "tick tick--month";
	        tick.style.left = `${leftPx}px`;
	        tick.dataset.day = String(dayNum);
	        tick.setAttribute("role", "button");
	        tick.tabIndex = 0;
	        tick.setAttribute("aria-selected", "false");
	        tick.title = "点击选取该刻度";

	        const line = document.createElement("div");
	        line.className = "tick__line";

	        const label = document.createElement("div");
	        label.className = "tick__label";

	        const totals = monthTotals instanceof Map ? monthTotals.get(key) : null;
	        const text = this._formatTotalsInline(totals);
	        label.textContent = text;

	        const nextMonth = new Date(cursor.getTime());
	        nextMonth.setUTCMonth(monthIndex + 1);
	        const nextStart = Math.floor(nextMonth.getTime() / utils.MS_PER_DAY);
	        const visibleEnd = Math.min(nextStart, this.rangeEndDay + 1);
	        const widthDays = Math.max(1, visibleEnd - dayNum);
	        const midDay = dayNum + widthDays / 2;
	        label.style.left = `${(midDay - dayNum) * this.dayWidth}px`;
	        label.style.transform = "translateX(-50%)";
	        const widthPx = widthDays * this.dayWidth;
	        label.style.maxWidth = `${Math.max(0, widthPx - 12)}px`;

	        tick.setAttribute(
	          "aria-label",
	          text
	            ? `选取：${utils.dayNumberToISODate(dayNum)}（${year}年${monthIndex + 1}月，合计 ${text}）`
	            : `选取：${utils.dayNumberToISODate(dayNum)}（${year}年${monthIndex + 1}月）`
	        );

	        tick.appendChild(line);
	        tick.appendChild(label);
	        ticks.push(tick);

	        tick.addEventListener("click", (e) => {
	          if (this._shouldSuppressClick()) return;
	          e.preventDefault();
	          e.stopPropagation();
	          this.setSelectedTime(SELECTION_KIND_MONTH, dayNum);
	        });

	        tick.addEventListener("keydown", (e) => {
	          if (e.key !== "Enter" && e.key !== " ") return;
	          e.preventDefault();
	          this.setSelectedTime(SELECTION_KIND_MONTH, dayNum);
	        });

	        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	      }

	      return ticks;
	    }

	    _buildDayTotalTicks(dayTotals) {
	      const ticks = [];

	      // 动态合成：缩得过密时不显示“日”行（与顶部冻结行保持一致）
	      if (this.dayWidth < SHOW_DAY_SCALE_AT_OR_ABOVE) return ticks;

	      // >= 15 px/天 时才会进入这里，因此直接逐日渲染即可
	      for (let day = this.rangeStartDay; day <= this.rangeEndDay; day += 1) {
	        const leftPx = (day - this.rangeStartDay) * this.dayWidth;
	        const tick = document.createElement("div");
	        tick.className = "tick tick--day";
	        tick.style.left = `${leftPx}px`;

	        const label = document.createElement("div");
	        label.className = "tick__label";
	        const totals = dayTotals instanceof Map ? dayTotals.get(day) : null;
	        label.textContent = this._formatTotalsInline(totals);
	        label.style.left = `${this.dayWidth / 2}px`;
	        label.style.transform = "translateX(-50%)";
        label.style.maxWidth = `${Math.max(0, this.dayWidth - 8)}px`;
	        tick.appendChild(label);
	        ticks.push(tick);
	      }

	      return ticks;
	    }

	    _renderXAxis() {
	      this.xAxis.innerHTML = "";
	      this.xAxis.style.position = "sticky";

      const layer = document.createElement("div");
      layer.className = "axis-layer";

      // 本年/本月高亮（在刻度线下方）
      const yearBand = document.createElement("div");
      yearBand.className = "year-band";
      yearBand.dataset.role = "year-band";
      layer.appendChild(yearBand);

      const monthBand = document.createElement("div");
      monthBand.className = "month-band";
      monthBand.dataset.role = "month-band";
      layer.appendChild(monthBand);

      // 今天高亮（在刻度线下方）
      const todayBand = document.createElement("div");
      todayBand.className = "today-band";
      todayBand.dataset.role = "today-band";
      layer.appendChild(todayBand);

      // 选中列（在刻度线下方）
	      const selectedGroup = document.createElement("div");
	      selectedGroup.className = "selected-band-group";
	      selectedGroup.dataset.role = "selected-band-group";
	      if (!this.selectedTimes || !this.selectedTimes.length) selectedGroup.hidden = true;
	      layer.appendChild(selectedGroup);

      // 月刻度
      const monthTicks = this._buildMonthTicks();
      for (const tick of monthTicks) layer.appendChild(tick);

      // 年刻度
      const yearTicks = this._buildYearTicks();
      for (const tick of yearTicks) layer.appendChild(tick);

      // 日刻度（底行）：按缩放密度自动抽样显示日期数字
      const dayTicks = this._buildDayTicks();
      for (const tick of dayTicks) layer.appendChild(tick);

      this.xAxis.appendChild(layer);
    }

    _renderRows(options) {
      const preserveYAxis = options?.preserveYAxis === true;
      if (!preserveYAxis) this.yAxis.innerHTML = "";
      this.canvas.innerHTML = "";

      const rowHeight = this._getCssPx(this.grid, "--row-height", 48);
      const rowGap = this._getCssPx(this.grid, "--row-gap", 0);
      const rowsCount = this.subscriptions.length;
      const rowsHeight = rowsCount > 0 ? rowsCount * rowHeight + (rowsCount - 1) * rowGap : 0;
      if (this.grid) this.grid.style.setProperty("--rows-height", `${rowsHeight}px`);

      if (!this.subscriptions.length) {
        if (this.grid) this.grid.classList.add("is-empty");
        if (!preserveYAxis) {
          const addRow = this._buildAddSubscriptionRow();
          if (addRow) this.yAxis.appendChild(addRow);
        }

        return;
      }
      if (this.grid) this.grid.classList.remove("is-empty");

	      const yFrag = preserveYAxis ? null : document.createDocumentFragment();
	      const cFrag = document.createDocumentFragment();

      const today = utils.getTodayDayNumber();

	      for (const sub of this.subscriptions) {
	        const color = sub.color || "#b3e2cd";
	        const cycle = normalizeCycle(sub.cycle);
	        const currency = normalizeCurrency(sub.currency);
	        const startDay = utils.parseISODateToDayNumber(sub.startDate);
	        if (startDay == null) continue;

	        if (!preserveYAxis) {
	          // 左侧冻结列：四列（favicon / 名称 / 价格 / 周期）
	          const yRow = document.createElement("div");
	          yRow.className = "y-row";
	          if (sub.id) yRow.dataset.id = sub.id;
	          // 需求：左侧冻结列行背景色与该订阅色块一致
	          yRow.style.background = color;

	          const iconCell = document.createElement("div");
	          iconCell.className = "y-cell y-cell--icon";

	          const nameCell = document.createElement("div");
	          nameCell.className = "y-cell y-cell--name";

	          const openUrl = normalizeUrlForOpen(sub.link);
	          const faviconInfo = faviconCandidatesForLink(sub.link);

	          if (openUrl && faviconInfo && Array.isArray(faviconInfo.candidates) && faviconInfo.candidates.length) {
	            const iconLink = document.createElement("a");
	            iconLink.className = "y-row__favicon-link";
	            iconLink.href = openUrl;
	            iconLink.target = "_blank";
	            iconLink.rel = "noopener noreferrer";
	            iconLink.title = openUrl;
	            iconLink.setAttribute("aria-label", `打开链接：${openUrl}`);

	            const iconImg = document.createElement("img");
	            iconImg.className = "y-row__favicon";
	            iconImg.alt = "";
	            iconImg.decoding = "async";
	            iconImg.loading = "lazy";
	            // 某些站点（例如 instagram）可能禁止跨站点嵌入其 /favicon.ico；
	            // 因此采用“多候选 + 失败降级”策略，尽量保证可展示。
	            iconImg.referrerPolicy = "no-referrer";
	            attachFaviconWithFallback(
	              iconImg,
	              faviconInfo.key,
	              faviconInfo.candidates,
	              () => {
	                try {
	                  iconLink.remove();
	                } catch {
	                  // ignore
	                }
	              }
	            );

	            iconLink.appendChild(iconImg);
	            iconCell.appendChild(iconLink);

	            iconLink.addEventListener("click", (e) => {
	              if (this._shouldSuppressClick()) {
	                e.preventDefault();
	                e.stopPropagation();
	              }
	            });
	          }

	          const nameEl = document.createElement("div");
	          nameEl.className = "y-row__name";
	          nameEl.textContent = sub.name || "-";

	          nameCell.appendChild(nameEl);

	          const priceCell = document.createElement("div");
	          priceCell.className = "y-cell y-cell--price";
	          const money = utils.formatMoney(sub.price, currency);
	          priceCell.textContent = money;
	          priceCell.title = money;

	          const cycleCell = document.createElement("div");
	          cycleCell.className = "y-cell y-cell--cycle";
	          const cycleText = utils.cycleLabel(cycle);
	          cycleCell.textContent = cycleText;
	          cycleCell.title = cycleText;

	          yRow.appendChild(iconCell);
	          yRow.appendChild(nameCell);
	          yRow.appendChild(priceCell);
	          yRow.appendChild(cycleCell);

	          // 左侧冻结列点击：与右侧色块一致（高亮 + 进入编辑）
	          yRow.addEventListener("click", (e) => {
	            if (this._shouldSuppressClick()) return;
	            const target = e.target;

	            // 点击链接时保持“打开链接”行为，不切换编辑态
	            if (target?.closest?.("a")) return;

	            const id = yRow.dataset.id;
	            if (!id) return;
	            e.preventDefault();

	            this.setSelectedId(id);
	            if (typeof this.onSubscriptionClick === "function") this.onSubscriptionClick(id);
	          });

	          yFrag.appendChild(yRow);
	        }

	        // 右侧时间轴区：每个服务一行
	        const row = document.createElement("div");
	        row.className = "service-row";

	        const endRaw = utils.parseISODateToDayNumber(sub.endDate);
	        const endDay = endRaw != null ? clampDayToSupportedRange(endRaw) : null;
	        const isContinuous = endDay == null;

	        // 色块：有结束日期则显示到结束日期；无结束日期则延伸到当前渲染范围右侧
	        const visibleStart = Math.max(startDay, this.rangeStartDay);
	        const visibleEnd = isContinuous ? this.rangeEndDay : Math.min(this.rangeEndDay, endDay);
	        if (visibleEnd >= visibleStart) {
	          const leftPx = (visibleStart - this.rangeStartDay) * this.dayWidth;
	          const widthPx = Math.max(1, (visibleEnd - visibleStart + 1) * this.dayWidth);

	          const bar = document.createElement("div");
	          bar.className = "subscription-bar";
	          if (isContinuous) bar.classList.add("is-continuous");
	          if (startDay > today) bar.classList.add("is-future");
	          if (sub.id && sub.id === this.selectedId) bar.classList.add("is-selected");

	          bar.style.left = `${leftPx}px`;
	          bar.style.width = `${widthPx}px`;
          bar.style.background = color;
	          bar.dataset.id = sub.id;

	          // 周期分隔线
	          this._renderCycleLines(bar, { startDay, cycle }, visibleStart, visibleEnd);

	          // 方块内部：每个订阅周期都显示一次价格（不展示服务名称/周期）
	          const priceLayer = document.createElement("div");
	          priceLayer.className = "bar-price-layer";
	          this._renderCyclePriceLabels(
	            priceLayer,
	            { startDay, cycle, priceText: utils.formatMoney(sub.price, currency) },
	            visibleStart,
	            visibleEnd
	          );
	          bar.appendChild(priceLayer);

	          bar.addEventListener("click", (e) => {
	            if (this._shouldSuppressClick()) {
	              e.preventDefault();
	              e.stopPropagation();
	              return;
	            }
	            e.preventDefault();
	            const id = bar.dataset.id;
	            if (typeof this.onSubscriptionClick === "function") this.onSubscriptionClick(id);
	          });

	          row.appendChild(bar);
	        }
        cFrag.appendChild(row);
      }

	      if (!preserveYAxis) {
	        const addRow = this._buildAddSubscriptionRow();
	        if (addRow) yFrag.appendChild(addRow);
	      }

      const addSpacer = document.createElement("div");
      addSpacer.className = "service-row service-row--add";
      cFrag.appendChild(addSpacer);

      // canvas 内层：月/年网格线（在色块下方）+ 今天高亮（在色块上方）
      const gridLayer = document.createElement("div");
      gridLayer.className = "canvas-grid-layer";
      for (const tick of this._buildMonthGridLines()) gridLayer.appendChild(tick);
      for (const tick of this._buildYearGridLines()) gridLayer.appendChild(tick);

      const selectionLayer = document.createElement("div");
      selectionLayer.className = "canvas-selection-layer";
	      const selectedGroup = document.createElement("div");
	      selectedGroup.className = "selected-band-group";
	      selectedGroup.dataset.role = "selected-band-group";
	      if (!this.selectedTimes || !this.selectedTimes.length) selectedGroup.hidden = true;
	      selectionLayer.appendChild(selectedGroup);

      const todayLayer = document.createElement("div");
      todayLayer.className = "canvas-today-layer";
      const yearBand = document.createElement("div");
      yearBand.className = "year-band";
      yearBand.dataset.role = "year-band";
      todayLayer.appendChild(yearBand);
      const monthBand = document.createElement("div");
      monthBand.className = "month-band";
      monthBand.dataset.role = "month-band";
      todayLayer.appendChild(monthBand);
      const todayBand = document.createElement("div");
      todayBand.className = "today-band";
      todayBand.dataset.role = "today-band";
      todayLayer.appendChild(todayBand);

	      if (!preserveYAxis) this.yAxis.appendChild(yFrag);
	      this.canvas.appendChild(cFrag);
      this.canvas.appendChild(gridLayer);
      this.canvas.appendChild(selectionLayer);
      this.canvas.appendChild(todayLayer);
    }

	    _buildAddSubscriptionRow() {
	      // 冻结列底部：新增订阅入口（按钮在第一个冻结列中）
	      if (!this.yAxis) return null;

	      const row = document.createElement("button");
	      row.type = "button";
	      row.className = "y-row y-row--add";
	      row.setAttribute("aria-label", "新增订阅");

	      // button 内容必须是 phrasing content：用 span，避免浏览器自动重排导致点击失效
	      const iconCell = document.createElement("span");
	      iconCell.className = "y-cell y-cell--icon";
	      iconCell.textContent = "+";

	      const nameCell = document.createElement("span");
	      nameCell.className = "y-cell y-cell--name";
	      const nameEl = document.createElement("span");
	      nameEl.className = "y-row__name";
	      nameEl.textContent = "新增订阅";
	      nameCell.appendChild(nameEl);

	      const priceCell = document.createElement("span");
	      priceCell.className = "y-cell y-cell--price";

	      const cycleCell = document.createElement("span");
	      cycleCell.className = "y-cell y-cell--cycle";

      row.appendChild(iconCell);
      row.appendChild(nameCell);
      row.appendChild(priceCell);
      row.appendChild(cycleCell);

      row.addEventListener("click", (e) => {
        if (this._shouldSuppressClick()) return;
        e.preventDefault();
        this.setSelectedId(null);
        if (typeof this.onAddSubscription === "function") this.onAddSubscription();
      });

      return row;
    }

    _getCssPx(el, name, fallbackPx) {
      if (!el || !global.getComputedStyle) return fallbackPx;
      const raw = global.getComputedStyle(el).getPropertyValue(name);
      const value = Number.parseFloat(String(raw || "").trim());
      if (!Number.isFinite(value)) return fallbackPx;
      return value;
    }

	    _updateLineLabelPositions() {
	      const panelEl = this.panelEl;
	      const scroller = this.scroller;
	      const layer = this.lineLabelLayerEl;
	      if (!panelEl || !scroller || !layer) return;

      const todayEl = this.todayLineLabelEl;
      const selectedEl = this.selectedLineLabelEl;
      if (!todayEl && !selectedEl) return;

      const panelRect = panelEl.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const scrollerInsideLeft = scrollerRect.left + (scroller.clientLeft || 0);
      const scrollerInsideTop = scrollerRect.top + (scroller.clientTop || 0);
      const baseLeft = scrollerInsideLeft - panelRect.left;
      const baseTop = scrollerInsideTop - panelRect.top;

      const labelHeight = this._getCssPx(panelEl, "--line-label-height", 24);
      const stemHeight = this._getCssPx(panelEl, "--line-label-stem", 8);
      const top = baseTop - (labelHeight + stemHeight + 2);

      const scrollerWidth = scroller.clientWidth || 0;
      const timelineHasViewport = scrollerWidth > this.labelWidth + 10;

	      const positionForSpan = (startDay, endDay) => {
	        if (!Number.isFinite(startDay) || !Number.isFinite(endDay)) return null;
	        if (!timelineHasViewport) return null;
	        const start = utils.clamp(startDay, this.rangeStartDay, this.rangeEndDay);
	        const end = utils.clamp(endDay, this.rangeStartDay, this.rangeEndDay);
	        if (end < start) return null;

	        const leftPx = (start - this.rangeStartDay) * this.dayWidth;
	        const widthPx = Math.max(1, (end - start + 1) * this.dayWidth);
	        const xInScroller = this.labelWidth + leftPx - scroller.scrollLeft + widthPx / 2;
	        if (!Number.isFinite(xInScroller)) return null;
	        if (xInScroller < this.labelWidth || xInScroller > scrollerWidth) return null;
	        return baseLeft + xInScroller;
	      };

	      if (todayEl) {
	        const today = clampDayToSupportedRange(utils.getTodayDayNumber());
	        const x = positionForSpan(today, today);
	        if (x == null) {
	          todayEl.hidden = true;
	        } else {
	          todayEl.hidden = false;
          todayEl.style.left = `${x}px`;
          todayEl.style.top = `${top}px`;
        }
	      }

	      if (selectedEl) {
	        const spans = this._getSelectedSpans({ effective: true });
	        if (spans.length !== 1) {
	          selectedEl.hidden = true;
	        } else {
	          const span = spans[0];
	          const x = span ? positionForSpan(span.startDay, span.endDay) : null;
	          if (!span || x == null) {
	            selectedEl.hidden = true;
	          } else {
	            selectedEl.hidden = false;
	            selectedEl.style.left = `${x}px`;
            selectedEl.style.top = `${top}px`;
          }
        }
      }
	    }

    _updateTodayIndicator() {
      const enabled = this.todayHighlightEnabled !== false;
      const today = clampDayToSupportedRange(utils.getTodayDayNumber());
      const leftPx = (today - this.rangeStartDay) * this.dayWidth;
      const widthPx = Math.max(1, this.dayWidth);

	      const axisBand = this.xAxis.querySelector('[data-role="today-band"]');
	      if (axisBand) {
	        axisBand.hidden = !enabled;
	        axisBand.style.left = `${leftPx}px`;
	        axisBand.style.width = `${widthPx}px`;
	      }
	      if (this.todayLineLabelEl) {
	        this.todayLineLabelEl.textContent = "今天";
	        this.todayLineLabelEl.hidden = !enabled;
	      }

	      const canvasBand = this.canvas.querySelector('[data-role="today-band"]');
	      if (canvasBand) {
	        canvasBand.hidden = !enabled;
	        canvasBand.style.left = `${leftPx}px`;
	        canvasBand.style.width = `${widthPx}px`;
	      }

	      const summaryBand = this.summaryAxis?.querySelector?.('[data-role="today-band"]');
	      if (summaryBand) {
	        summaryBand.hidden = !enabled;
	        summaryBand.style.left = `${leftPx}px`;
	        summaryBand.style.width = `${widthPx}px`;
	      }

      this._updateLineLabelPositions();
    }

    _getCurrentMonthSpan() {
      const today = clampDayToSupportedRange(utils.getTodayDayNumber());
      const parts = utils.dayNumberToParts(today);
      const start = utils.toDayNumberUTC(parts.year, parts.monthIndex, 1);
      const end = utils.toDayNumberUTC(
        parts.year,
        parts.monthIndex,
        utils.daysInMonthUTC(parts.year, parts.monthIndex)
      );
      return {
        startDay: clampDayToSupportedRange(start),
        endDay: clampDayToSupportedRange(end),
      };
    }

    _getCurrentYearSpan() {
      const today = clampDayToSupportedRange(utils.getTodayDayNumber());
      const parts = utils.dayNumberToParts(today);
      const start = utils.toDayNumberUTC(parts.year, 0, 1);
      const end = utils.toDayNumberUTC(parts.year, 11, 31);
      return {
        startDay: clampDayToSupportedRange(start),
        endDay: clampDayToSupportedRange(end),
      };
    }

    _updatePeriodHighlights() {
      const updateBand = (band, span) => {
        if (!band) return;
        if (!span) {
          band.hidden = true;
          return;
        }
        const start = utils.clamp(span.startDay, this.rangeStartDay, this.rangeEndDay);
        const end = utils.clamp(span.endDay, this.rangeStartDay, this.rangeEndDay);
        if (end < this.rangeStartDay || start > this.rangeEndDay) {
          band.hidden = true;
          return;
        }
        const leftPx = (start - this.rangeStartDay) * this.dayWidth;
        const widthDays = Math.max(1, end - start + 1);
        const widthPx = Math.max(1, widthDays * this.dayWidth);
        band.hidden = false;
        band.style.left = `${leftPx}px`;
        band.style.width = `${widthPx}px`;
      };

      const monthSpan = this.monthHighlightEnabled ? this._getCurrentMonthSpan() : null;
      const yearSpan = this.yearHighlightEnabled ? this._getCurrentYearSpan() : null;

      const axisMonth = this.xAxis?.querySelector?.('[data-role="month-band"]');
      const axisYear = this.xAxis?.querySelector?.('[data-role="year-band"]');
      const canvasMonth = this.canvas?.querySelector?.('[data-role="month-band"]');
      const canvasYear = this.canvas?.querySelector?.('[data-role="year-band"]');
      const summaryMonth = this.summaryAxis?.querySelector?.('[data-role="month-band"]');
      const summaryYear = this.summaryAxis?.querySelector?.('[data-role="year-band"]');

      updateBand(axisMonth, monthSpan);
      updateBand(canvasMonth, monthSpan);
      updateBand(summaryMonth, monthSpan);

      updateBand(axisYear, yearSpan);
      updateBand(canvasYear, yearSpan);
      updateBand(summaryYear, yearSpan);
    }

	    _updateSelectedIndicator() {
	      const spans = this._getSelectedSpans({ effective: true });

	      const axisGroup = this.xAxis?.querySelector?.('[data-role="selected-band-group"]');
	      const canvasGroup = this.canvas?.querySelector?.('[data-role="selected-band-group"]');
	      const summaryGroup = this.summaryAxis?.querySelector?.('[data-role="selected-band-group"]');

	      const resetBandVertical = (band) => {
	        if (!band) return;
	        band.style.top = "";
	        band.style.bottom = "";
	        band.style.height = "";
	      };

	      const clearGroup = (group) => {
	        if (!group) return;
	        group.innerHTML = "";
	        group.hidden = !spans.length;
	      };

	      clearGroup(axisGroup);
	      clearGroup(canvasGroup);
	      clearGroup(summaryGroup);

	      if (!spans.length) {
	        if (this.selectedLineLabelEl) {
          this.selectedLineLabelEl.hidden = true;
          this.selectedLineLabelEl.textContent = "";
        }
        this._updateLineLabelPositions();
	        return;
	      }

	      for (const span of spans) {
	        const start = utils.clamp(span.startDay, this.rangeStartDay, this.rangeEndDay);
	        const end = utils.clamp(span.endDay, this.rangeStartDay, this.rangeEndDay);
	        const leftPx = (start - this.rangeStartDay) * this.dayWidth;
	        const widthDays = Math.max(1, end - start + 1);
	        const widthPx = Math.max(1, widthDays * this.dayWidth);
	        const bandKind = span.kind;

	        if (axisGroup) {
	          const axisBand = document.createElement("div");
	          axisBand.className = "selected-band";
	          axisBand.style.left = `${leftPx}px`;
          axisBand.style.width = `${widthPx}px`;
	          if (bandKind === SELECTION_KIND_DAY) {
	            axisBand.style.top = "calc(var(--axis-year-band) + var(--axis-month-band))";
	            axisBand.style.height = "var(--axis-day-band)";
	            axisBand.style.bottom = "auto";
	          } else if (bandKind === SELECTION_KIND_MONTH) {
	            axisBand.style.top = "var(--axis-year-band)";
	            axisBand.style.height = "calc(var(--axis-month-band) + var(--axis-day-band))";
	            axisBand.style.bottom = "auto";
	          } else {
	            resetBandVertical(axisBand);
	          }
	          axisGroup.appendChild(axisBand);
        }

        if (canvasGroup) {
          const canvasBand = document.createElement("div");
          canvasBand.className = "selected-band";
          canvasBand.style.left = `${leftPx}px`;
          canvasBand.style.width = `${widthPx}px`;
          canvasGroup.appendChild(canvasBand);
        }

	        if (summaryGroup) {
	          const summaryBand = document.createElement("div");
	          summaryBand.className = "selected-band";
	          summaryBand.style.left = `${leftPx}px`;
	          summaryBand.style.width = `${widthPx}px`;
	          if (bandKind === SELECTION_KIND_DAY) {
	            summaryBand.style.top = "0";
	            summaryBand.style.height = "var(--axis-day-band)";
	            summaryBand.style.bottom = "auto";
	          } else if (bandKind === SELECTION_KIND_MONTH) {
	            summaryBand.style.top = "0";
	            summaryBand.style.height = "calc(var(--axis-day-band) + var(--axis-month-band))";
	            summaryBand.style.bottom = "auto";
	          } else {
	            resetBandVertical(summaryBand);
	          }
	          summaryGroup.appendChild(summaryBand);
	        }
	      }

	      if (this.selectedLineLabelEl) {
	        const label = spans.length === 1 ? spans[0].label || "" : "";
	        this.selectedLineLabelEl.textContent = label;
	      }

	      this._updateLineLabelPositions();
	    }

		    _updateTickSelectionStyles() {
		      const spans = this._getSelectedSpans({ effective: true });
		      const roots = [this.xAxis, this.summaryAxis].filter(Boolean);
		      for (const root of roots) {
		        const ticks = root.querySelectorAll(".tick[data-day]");
		        for (const tick of ticks) {
		          const day = Number(tick.dataset.day);
		          let isPicked = false;
		          if (Number.isFinite(day) && spans.length) {
		            for (const span of spans) {
		              if (day !== span.startDay) continue;
		              if (span.kind === SELECTION_KIND_DAY && tick.classList.contains("tick--day")) {
		                isPicked = true;
		                break;
		              }
		              if (span.kind === SELECTION_KIND_MONTH && tick.classList.contains("tick--month")) {
		                isPicked = true;
		                break;
		              }
		              if (span.kind === SELECTION_KIND_YEAR && tick.classList.contains("tick--year")) {
		                isPicked = true;
		                break;
		              }
		            }
		          }
		          tick.classList.toggle("is-picked", isPicked);
		          tick.setAttribute("aria-selected", isPicked ? "true" : "false");
		        }
		      }
		    }

    _updateSelectionStyles() {
      const bars = this.canvas.querySelectorAll(".subscription-bar");
      for (const bar of bars) {
        const id = bar.dataset.id;
        bar.classList.toggle("is-selected", Boolean(this.selectedId && id === this.selectedId));
      }

      const rows = this.yAxis.querySelectorAll(".y-row[data-id]");
      for (const row of rows) {
        const id = row.dataset.id;
        row.classList.toggle("is-selected", Boolean(this.selectedId && id === this.selectedId));
      }
    }

	    _buildMonthTicks() {
	      const ticks = [];
	
	      // 动态合成：月刻度线隐藏时不渲染月刻度（避免覆盖年刻度的交互）
	      if (this.dayWidth < SHOW_MONTH_SCALE_AT_OR_ABOVE) return ticks;
	      let cursor = utils.dayNumberToUTCDate(this.rangeStartDay);
	      cursor.setUTCDate(1);

      // 如果本月 1 号在 rangeStart 之前，则从下个月开始
      const firstMonthStart = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
      if (firstMonthStart < this.rangeStartDay) cursor.setUTCMonth(cursor.getUTCMonth() + 1);

      while (true) {
        const dayNum = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
        if (dayNum > this.rangeEndDay) break;
        const leftPx = (dayNum - this.rangeStartDay) * this.dayWidth;
        const year = cursor.getUTCFullYear();
        const monthIndex = cursor.getUTCMonth();
        const tick = document.createElement("div");
        tick.className = "tick tick--month";
        tick.style.left = `${leftPx}px`;
        tick.dataset.day = String(dayNum);
        tick.setAttribute("role", "button");
        tick.tabIndex = 0;
        tick.setAttribute("aria-label", `选取：${utils.dayNumberToISODate(dayNum)}（${year}年${monthIndex + 1}月）`);
        tick.setAttribute("aria-selected", "false");
        tick.title = "点击选取该刻度";

        const line = document.createElement("div");
        line.className = "tick__line";

        const label = document.createElement("div");
        label.className = "tick__label";
        label.textContent = utils.monthLabel(monthIndex);
        // Excel 风格“合并后居中”：月份标签居中显示在该月跨度中间
        const nextMonth = new Date(cursor.getTime());
        nextMonth.setUTCMonth(monthIndex + 1);
        const nextStart = Math.floor(nextMonth.getTime() / utils.MS_PER_DAY);
        const visibleEnd = Math.min(nextStart, this.rangeEndDay + 1);
        const widthDays = Math.max(1, visibleEnd - dayNum);
        const midDay = dayNum + widthDays / 2;
        label.style.left = `${(midDay - dayNum) * this.dayWidth}px`;
        label.style.transform = "translateX(-50%)";

        tick.appendChild(line);
        tick.appendChild(label);
        ticks.push(tick);

	        tick.addEventListener("click", (e) => {
	          if (this._shouldSuppressClick()) return;
	          e.preventDefault();
	          e.stopPropagation();
	          this.setSelectedTime(SELECTION_KIND_MONTH, dayNum);
	        });

	        tick.addEventListener("keydown", (e) => {
	          if (e.key !== "Enter" && e.key !== " ") return;
	          e.preventDefault();
	          this.setSelectedTime(SELECTION_KIND_MONTH, dayNum);
	        });

        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }

      return ticks;
    }

    _buildDayTicks() {
      const ticks = [];

      // 动态合成：缩得过密时不显示“日”文字（只保留月/年）
      if (this.dayWidth < SHOW_DAY_SCALE_AT_OR_ABOVE) return ticks;

      const MAX_TICKS = 2500;

      // 高倍率缩放：显示“每天”
      // 由于时间范围已限制在 2020~2035（最多约 5844 天），渲染全量“日”刻度不会过重，
      // 也能避免因为抽样步长变化导致的“只显示奇数/只显示偶数”错觉。
      if (this.dayWidth >= 14) {
        for (let day = this.rangeStartDay; day <= this.rangeEndDay; day += 1) {
          const leftPx = (day - this.rangeStartDay) * this.dayWidth;
          const parts = utils.dayNumberToParts(day);

          const tick = document.createElement("div");
          tick.className = "tick tick--day";
          tick.style.left = `${leftPx}px`;

          const label = document.createElement("div");
          label.className = "tick__label";
          label.textContent = String(parts.day);
          label.style.left = `${this.dayWidth / 2}px`;
          label.style.transform = "translateX(-50%)";

          tick.appendChild(label);
          ticks.push(tick);
        }
        return ticks;
      }

      // 中/低倍率缩放：以“每月的自然日期点”展示（更像 Excel 的日期表头）
      // 这样能稳定看到 1、15 等单数日期，而不是偶尔因为抽样对齐导致全是双位数
      let daysToShow = [1, 15];
      if (this.dayWidth >= 8) daysToShow = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31];
      else if (this.dayWidth >= 5) daysToShow = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31];
      else if (this.dayWidth >= 3) daysToShow = [1, 5, 10, 15, 20, 25, 30];

      const startParts = utils.dayNumberToParts(this.rangeStartDay);
      const endParts = utils.dayNumberToParts(this.rangeEndDay);
      const startKey = startParts.year * 12 + startParts.monthIndex;
      const endKey = endParts.year * 12 + endParts.monthIndex;
      const monthsInRange = Math.max(1, endKey - startKey + 1);

      const maxMonths = Math.max(1, Math.floor(MAX_TICKS / Math.max(1, daysToShow.length)));
      const monthStep = Math.max(1, Math.ceil(monthsInRange / maxMonths));

      for (let key = startKey; key <= endKey; key += monthStep) {
        const year = Math.floor(key / 12);
        const monthIndex = key % 12;
        const maxDay = utils.daysInMonthUTC(year, monthIndex);

        for (const dayOfMonth of daysToShow) {
          if (dayOfMonth > maxDay) continue;
          const day = utils.toDayNumberUTC(year, monthIndex, dayOfMonth);
          if (day < this.rangeStartDay || day > this.rangeEndDay) continue;

          const leftPx = (day - this.rangeStartDay) * this.dayWidth;

          const tick = document.createElement("div");
          tick.className = "tick tick--day";
          tick.style.left = `${leftPx}px`;

          const label = document.createElement("div");
          label.className = "tick__label";
          label.textContent = String(dayOfMonth);
          label.style.left = `${this.dayWidth / 2}px`;
          label.style.transform = "translateX(-50%)";

          tick.appendChild(label);
          ticks.push(tick);
        }
      }

      return ticks;
    }

    _buildMonthGridLines() {
      const ticks = [];
      let cursor = utils.dayNumberToUTCDate(this.rangeStartDay);
      cursor.setUTCDate(1);

      const firstMonthStart = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
      if (firstMonthStart < this.rangeStartDay) cursor.setUTCMonth(cursor.getUTCMonth() + 1);

      while (true) {
        const dayNum = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
        if (dayNum > this.rangeEndDay) break;
        const leftPx = (dayNum - this.rangeStartDay) * this.dayWidth;
        const monthIndex = cursor.getUTCMonth();
        if (monthIndex !== 0) {
          const tick = document.createElement("div");
          tick.className = "tick tick--month";
          tick.style.left = `${leftPx}px`;
          const line = document.createElement("div");
          line.className = "tick__line";
          tick.appendChild(line);
          ticks.push(tick);
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }

      return ticks;
    }

    _buildYearTicks() {
      const ticks = [];
      let cursor = utils.dayNumberToUTCDate(this.rangeStartDay);
      cursor.setUTCMonth(0);
      cursor.setUTCDate(1);

      const firstYearStart = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
      if (firstYearStart < this.rangeStartDay) cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);

      while (true) {
        const dayNum = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
        if (dayNum > this.rangeEndDay) break;
        const leftPx = (dayNum - this.rangeStartDay) * this.dayWidth;
        const year = cursor.getUTCFullYear();
        const tick = document.createElement("div");
        tick.className = "tick tick--year";
        tick.style.left = `${leftPx}px`;
        tick.dataset.day = String(dayNum);
        tick.setAttribute("role", "button");
        tick.tabIndex = 0;
        tick.setAttribute("aria-label", `选取：${utils.dayNumberToISODate(dayNum)}（${year}年）`);
        tick.setAttribute("aria-selected", "false");
        tick.title = "点击选取该刻度";

        const line = document.createElement("div");
        line.className = "tick__line";

        const label = document.createElement("div");
        label.className = "tick__label";
        label.textContent = String(year);
        // Excel 风格“合并后居中”：年份标签居中显示在该年跨度中间
        const nextYearStart = utils.toDayNumberUTC(year + 1, 0, 1);
        const visibleEnd = Math.min(nextYearStart, this.rangeEndDay + 1);
        const widthDays = Math.max(1, visibleEnd - dayNum);
        const midDay = dayNum + widthDays / 2;
        label.style.left = `${(midDay - dayNum) * this.dayWidth}px`;
        label.style.transform = "translateX(-50%)";

        tick.appendChild(line);
        tick.appendChild(label);
        ticks.push(tick);

	        tick.addEventListener("click", (e) => {
	          if (this._shouldSuppressClick()) return;
	          e.preventDefault();
	          e.stopPropagation();
	          this.setSelectedTime(SELECTION_KIND_YEAR, dayNum);
	        });

	        tick.addEventListener("keydown", (e) => {
	          if (e.key !== "Enter" && e.key !== " ") return;
	          e.preventDefault();
	          this.setSelectedTime(SELECTION_KIND_YEAR, dayNum);
	        });

        cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
      }

      return ticks;
    }

    _buildYearGridLines() {
      const ticks = [];
      let cursor = utils.dayNumberToUTCDate(this.rangeStartDay);
      cursor.setUTCMonth(0);
      cursor.setUTCDate(1);

      const firstYearStart = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
      if (firstYearStart < this.rangeStartDay) cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);

      while (true) {
        const dayNum = Math.floor(cursor.getTime() / utils.MS_PER_DAY);
        if (dayNum > this.rangeEndDay) break;
        const leftPx = (dayNum - this.rangeStartDay) * this.dayWidth;
        const tick = document.createElement("div");
        tick.className = "tick tick--year";
        tick.style.left = `${leftPx}px`;
        const line = document.createElement("div");
        line.className = "tick__line";
        tick.appendChild(line);
        ticks.push(tick);
        cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
      }

      return ticks;
    }

    _renderCycleLines(barEl, subInfo, visibleStartDay, visibleEndDay) {
      const cycle = normalizeCycle(subInfo.cycle);
      const startDay = subInfo.startDay;
      // bar 内部绝对定位的 containing block 是 padding box（不包含 border），
      // 为了让周期分割线与坐标轴日刻度线重叠，需要把 x 坐标向左补回 1px（边框宽度）。
      const BAR_BORDER_PX = 1;

      if (cycle === "weekly") {
        // 以 startDay 为基准，每 7 天一个边界
        const step = 7;
        let first = startDay + step;
        if (first < visibleStartDay) {
          const delta = visibleStartDay - first;
          first += Math.ceil(delta / step) * step;
        }
        this._renderCycleLinesByStep(barEl, first, step, visibleStartDay, visibleEndDay);
        return;
      }

      if (cycle === "monthly" || cycle === "yearly") {
        const startParts = utils.dayNumberToParts(startDay);
        let count = 0;
        const maxLines = 240;

        // 从下一周期开始画线
        let step = 1;
        while (true) {
          const nextParts =
            cycle === "monthly" ? utils.addMonthsClamped(startParts, step) : utils.addYearsClamped(startParts, step);
          const boundaryDay = utils.toDayNumberUTC(nextParts.year, nextParts.monthIndex, nextParts.day);
          if (boundaryDay > visibleEndDay) break;
          if (boundaryDay >= visibleStartDay) {
            count += 1;
            if (count <= maxLines) {
              const leftPx = (boundaryDay - visibleStartDay) * this.dayWidth - BAR_BORDER_PX;
              const line = document.createElement("div");
              line.className = "cycle-line";
              line.style.left = `${leftPx}px`;
              barEl.appendChild(line);
            }
          }
          step += 1;
          if (step > 2000) break; // 防御：避免死循环
        }

        if (count > maxLines) {
          // 线太多时，给出轻微提示（不强制渲染全部）
          barEl.title = `周期分隔线过多（${count}），已为性能限制显示数量。`;
        }
      }
    }

    _renderCycleLinesByStep(barEl, firstBoundaryDay, stepDays, visibleStartDay, visibleEndDay) {
      if (!Number.isFinite(firstBoundaryDay) || !Number.isFinite(stepDays)) return;
      const BAR_BORDER_PX = 1;
      const maxLines = 260;
      let count = 0;
      for (let d = firstBoundaryDay; d <= visibleEndDay; d += stepDays) {
        if (d < visibleStartDay) continue;
        count += 1;
        if (count > maxLines) break;
        const leftPx = (d - visibleStartDay) * this.dayWidth - BAR_BORDER_PX;
        const line = document.createElement("div");
        line.className = "cycle-line";
        line.style.left = `${leftPx}px`;
        barEl.appendChild(line);
      }
      if (count > maxLines) {
        barEl.title = `周期分隔线过多（>${maxLines}），已为性能限制显示数量。`;
      }
    }

    _ensurePriceLabelMeasurer() {
      if (this._priceLabelMeasureEl) return;
      if (!global.document || !global.document.body) return;

      const el = document.createElement("span");
      el.className = "bar-price-label";
      el.style.position = "absolute";
      el.style.left = "-10000px";
      el.style.top = "-10000px";
      el.style.transform = "none";
      el.style.maxWidth = "none";
      el.style.visibility = "hidden";
      el.style.pointerEvents = "none";
      el.style.whiteSpace = "nowrap";
      el.style.overflow = "visible";

      try {
        document.body.appendChild(el);
      } catch {
        // ignore
      }

      this._priceLabelMeasureEl = el;
    }

    _measurePriceLabelWidthPx(text) {
      const value = String(text || "");
      if (!value) return 0;
      const cached = this._priceLabelWidthCache.get(value);
      if (Number.isFinite(cached) && cached > 0) return cached;

      this._ensurePriceLabelMeasurer();
      const el = this._priceLabelMeasureEl;
      if (!el || !global.getComputedStyle) return 0;

      // 赋值后读宽度：确保用真实字体宽度判断“是否挤压”
      el.textContent = value;
      const width = el.getBoundingClientRect ? el.getBoundingClientRect().width : el.offsetWidth;
      const safe = Number(width);
      if (Number.isFinite(safe) && safe > 0) {
        this._priceLabelWidthCache.set(value, safe);
        return safe;
      }
      return 0;
    }

    _renderCyclePriceLabels(containerEl, subInfo, visibleStartDay, visibleEndDay) {
      if (!containerEl) return;
      const cycle = normalizeCycle(subInfo.cycle);
      const startDay = subInfo.startDay;
      const text = String(subInfo.priceText || "").trim();
      if (!text) return;

      // 过小缩放时不渲染文字，避免挤压/重叠
      const LABEL_PAD_PX = 10;
      const textWidthPx = this._measurePriceLabelWidthPx(text);
      if (!Number.isFinite(textWidthPx) || textWidthPx <= 0) return;
      const requiredPx = textWidthPx + LABEL_PAD_PX * 2;

      // 智能规则：只有当文字“确实放不下”才隐藏
      // 若连该周期“最大可能宽度”都放不下，则直接不渲染（性能优化）
      let maxCycleDays = 0;
      if (cycle === "weekly") maxCycleDays = 7;
      else if (cycle === "monthly") maxCycleDays = 31;
      else if (cycle === "yearly") maxCycleDays = 366;
      if (maxCycleDays && maxCycleDays * this.dayWidth < requiredPx) return;

      const starts = [visibleStartDay];
      const rangeStart = visibleStartDay + 1;
      if (rangeStart <= visibleEndDay) {
        // 用“扣费发生日”作为“新周期开始”的锚点：每个周期开始日追加一个价格文本
        this._forEachChargeDayInRange({ startDay, cycle, rangeStart, rangeEnd: visibleEndDay }, (day) => {
          if (day > visibleStartDay && day <= visibleEndDay) starts.push(day);
        });
      }

      // 防御：极端数据导致过多节点时限制数量
      const MAX_LABELS = 220;
      if (starts.length > MAX_LABELS) return;

      // 每个“周期段”左对齐放置一次价格（仅当文本不被挤压）
      for (let i = 0; i < starts.length; i += 1) {
        const segStart = starts[i];
        const nextStart = i + 1 < starts.length ? starts[i + 1] : visibleEndDay + 1;
        const segDays = nextStart - segStart;
        if (segDays <= 0) continue;

        const segWidthPx = segDays * this.dayWidth;
        if (segWidthPx < requiredPx) continue;

        const segLeftPx = (segStart - visibleStartDay) * this.dayWidth;
        const leftPx = segLeftPx + LABEL_PAD_PX;
        const maxWidth = Math.max(0, segWidthPx - LABEL_PAD_PX * 2);

        const label = document.createElement("div");
        label.className = "bar-price-label";
        label.style.left = `${leftPx}px`;
        label.style.maxWidth = `${maxWidth}px`;
        label.textContent = text;
        containerEl.appendChild(label);
      }
    }
  }

  global.SubTracker = global.SubTracker || {};
  global.SubTracker.Timeline = Timeline;
})(window);
