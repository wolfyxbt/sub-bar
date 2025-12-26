(function (global) {
  "use strict";

  // 主应用逻辑：表单交互、统计摘要、与 Timeline/Storage 的协调
  const utils = global.SubTracker?.utils;
  const storage = global.SubTracker?.storage;

  function byId(id) {
    return document.getElementById(id);
  }

  function getFormValue(formEl, name) {
    const el = formEl.elements.namedItem(name);
    if (!el) return "";
    return String(el.value || "");
  }

  function setFormValue(formEl, name, value) {
    const el = formEl.elements.namedItem(name);
    if (!el) return;
    el.value = value ?? "";
  }

  function estimateMonthlyCost(sub) {
    const price = Number(sub.price);
    if (!Number.isFinite(price) || price < 0) return NaN;
    const cycle = sub.cycle;
    if (cycle === "weekly") return (price * 52) / 12;
    if (cycle === "monthly") return price;
    if (cycle === "yearly") return price / 12;
    return price;
  }

  function estimateYearlyCost(sub) {
    const monthly = estimateMonthlyCost(sub);
    if (!Number.isFinite(monthly)) return NaN;
    return monthly * 12;
  }

  function groupTotalsByCurrency(subscriptions, estimator) {
    const totals = new Map();
    for (const sub of subscriptions) {
      const currency = (sub.currency || "CNY").toUpperCase();
      const value = estimator(sub);
      if (!Number.isFinite(value)) continue;
      totals.set(currency, (totals.get(currency) || 0) + value);
    }
    return totals;
  }

  function formatTotalsMap(totals) {
    if (!totals.size) return "-";
    const parts = [];
    for (const [currency, value] of totals.entries()) {
      parts.push(utils.formatMoney(value, currency));
    }
    return parts.join(" / ");
  }

		  function normalizeSubscriptionInput({ id, name, price, currency, cycle, startDate, endDate, color, link }, existing) {
	    const cleanName = String(name || "").trim();
	    const priceText = String(price ?? "").trim();
	    const cleanPrice = Number(priceText);
	    const rawCurrency = String(currency || "").trim();
	    const rawCycle = String(cycle || "").trim();
	    const cleanCurrency = String(rawCurrency || "CNY").toUpperCase();
	    const cleanCycle = String(rawCycle || "monthly");
	    const cleanStartDate = String(startDate || "");
	    const cleanEndDate = String(endDate || "").trim();
	    const cleanLink = String(link || "").trim();

	    if (!cleanName) return { error: "请填写服务名称。" };
	    if (!priceText) return { error: "请填写订阅价格。" };
	    if (!rawCurrency) return { error: "请选择货币单位。" };
	    if (!rawCycle) return { error: "请选择订阅周期。" };
	    if (!Number.isFinite(cleanPrice) || cleanPrice < 0) return { error: "请填写有效的订阅价格（≥ 0）。" };
	    const startDay = utils.parseISODateToDayNumber(cleanStartDate);
	    if (startDay == null) return { error: "请选择有效的开始日期。" };
	    if (typeof utils.isDayNumberWithinSupportedRange === "function" && !utils.isDayNumberWithinSupportedRange(startDay)) {
	      return { error: `开始日期仅支持 ${utils.MIN_SUPPORTED_YEAR}～${utils.MAX_SUPPORTED_YEAR}。` };
	    }

	    let endDay = null;
	    if (cleanEndDate) {
	      endDay = utils.parseISODateToDayNumber(cleanEndDate);
	      if (endDay == null) return { error: "请选择有效的结束日期。" };
	      if (typeof utils.isDayNumberWithinSupportedRange === "function" && !utils.isDayNumberWithinSupportedRange(endDay)) {
	        return { error: `结束日期仅支持 ${utils.MIN_SUPPORTED_YEAR}～${utils.MAX_SUPPORTED_YEAR}。` };
	      }
	      if (endDay < startDay) return { error: "结束日期不能早于开始日期。" };
	    }

    const nowIso = new Date().toISOString();
    return {
      subscription: {
        id: id || existing?.id || utils.generateId(),
        name: cleanName,
        price: cleanPrice,
        currency: cleanCurrency,
        cycle: cleanCycle,
        startDate: cleanStartDate,
        endDate: cleanEndDate ? cleanEndDate : undefined,
        color: color || existing?.color || "#b3e2cd",
        link: cleanLink,
        createdAt: existing?.createdAt || nowIso,
      },
    };
  }

	  function init() {
	    const form = byId("subscriptionForm");
		    const formTitle = byId("formTitle");
			    const formError = byId("formError");
			    const subscriptionModal = byId("subscriptionModal");
			    const subscriptionModalBackdrop = subscriptionModal?.querySelector?.('[data-role="backdrop"]') || null;
			    const btnCloseModal = byId("btnCloseModal");
			    const currencyInput = byId("subCurrency");
			    // 新增订阅时：货币默认 USD（本次会话内用户手动改过则沿用该值）
			    let preferredCurrencySession = "USD";
			    const currencyPickerRoot = byId("currencyPicker");
			    const currencyPicker =
			      currencyPickerRoot && currencyInput && global.SubTracker?.CurrencyPicker
		        ? new global.SubTracker.CurrencyPicker({ root: currencyPickerRoot, input: currencyInput })
		        : null;
	    const cycleInput = byId("subCycle");
		    const cyclePickerRoot = byId("cyclePicker");
		    const cyclePicker =
		      cyclePickerRoot && cycleInput && global.SubTracker?.CyclePicker
		        ? new global.SubTracker.CyclePicker({ root: cyclePickerRoot, input: cycleInput })
		        : null;

	    const btnSubmit = byId("btnSubmit");
	    const btnCancelEdit = byId("btnCancelEdit");
	    const btnDelete = byId("btnDelete");
    const btnToday = byId("btnToday");
    const btnExport = byId("btnExport");
    const btnImport = byId("btnImport");
    const importFileInput = byId("importFile");
    const btnZoomOut = null;
    const btnZoomIn = null;
    const zoomRange = null;
    const zoomLabel = null;
    const zoomPresetButtons = Array.from(document.querySelectorAll("[data-zoom-preset]"));
    const toggleTodayHighlight = byId("toggleTodayHighlight");
    const toggleMonthHighlight = byId("toggleMonthHighlight");
    const toggleYearHighlight = byId("toggleYearHighlight");
    const todayStatCard = toggleTodayHighlight ? toggleTodayHighlight.closest(".stat") : null;
    const monthStatCard = toggleMonthHighlight ? toggleMonthHighlight.closest(".stat") : null;
    const yearStatCard = toggleYearHighlight ? toggleYearHighlight.closest(".stat") : null;
    const sortModeInput = byId("sortMode");
    const priceSortToggle = byId("priceSortToggle");
    const sortPickerRoot = byId("sortPicker");

    const statActiveCount = byId("statActiveCount");
    const statTodayCost = byId("statTodayCost");
    const statSelectedMeta = byId("statSelectedMeta");
    const statMonthlyTotal = byId("statMonthlyTotal");
    const statYearlyTotal = byId("statYearlyTotal");
    const toggleSelectedHighlight = byId("toggleSelectedHighlight");

    function setStatValue(el, value) {
      if (!el) return;
      const text = String(value || "").trim();
      if (!text || text === "-") {
        el.textContent = "-";
        return;
      }
      const amount = text.replace(/\\s*USD\\b/i, "").trim();
      if (!amount) {
        el.textContent = "-";
        return;
      }
      el.textContent = "";
      const amountEl = document.createElement("span");
      amountEl.className = "stat-value__amount";
      amountEl.textContent = amount;
      const unitEl = document.createElement("span");
      unitEl.className = "stat-value__unit";
      unitEl.textContent = "USD";
      el.appendChild(amountEl);
      el.appendChild(document.createTextNode(" "));
      el.appendChild(unitEl);
    }

		    function showSubscriptionModal() {
		      if (!subscriptionModal) return;
		      subscriptionModal.hidden = false;
		      document.documentElement.classList.add("is-modal-open");
		      document.body.classList.add("is-modal-open");
		      const nameInput = byId("subName");
		      global.requestAnimationFrame(() => {
		        // 弹窗从 display:none 切换到可见后，补一次滚轴定位，避免部分浏览器出现滚轴“停在旧位置”
		        try {
		          if (dateWheel) dateWheel.setDateISO(getFormValue(form, "startDate"), { behavior: "auto" });
		        } catch {
		          // ignore
		        }
		        try {
		          if (endDateWheel) endDateWheel.setDateISO(getFormValue(form, "endDate"), { behavior: "auto" });
		        } catch {
		          // ignore
		        }
		        try {
		          nameInput?.focus({ preventScroll: true });
		        } catch {
		          // ignore
		        }
		      });
		    }

		    function hideSubscriptionModal() {
		      if (!subscriptionModal) return;
		      subscriptionModal.hidden = true;
		      document.documentElement.classList.remove("is-modal-open");
		      document.body.classList.remove("is-modal-open");
		    }

		    function closeSubscriptionModal() {
		      // 关闭弹窗时：尽量把最后一次编辑落盘，并退出编辑态
		      try {
		        flushAutoPersist();
		      } catch {
		        // ignore
		      }
		      setEditMode(null);
		      refreshUI({ scrollToToday: false });
		      hideSubscriptionModal();
		    }

	    // 需求：取消“滚轮选日期”，仅保留输入框
	    const DATE_WHEEL_ENABLED = false;
	    const dateWheelRoot = byId("startDateWheel");
	    const startDateInput = byId("subStartDate");
	    const startYearInput = byId("subStartYear");
	    const startMonthInput = byId("subStartMonth");
	    const startDayInput = byId("subStartDay");
	    const dateWheel =
	      DATE_WHEEL_ENABLED && dateWheelRoot && global.SubTracker.DateWheelPicker
	        ? new global.SubTracker.DateWheelPicker({ root: dateWheelRoot, input: startDateInput })
	        : null;

	    const endDateControls = byId("endDateControls");
	    const btnToggleEndDate = byId("btnToggleEndDate");
	    const btnCancelEndDate = byId("btnCancelEndDate");
	    const endDateToggle =
	      endDateControls?.closest?.(".end-date-toggle") ||
	      btnToggleEndDate?.closest?.(".end-date-toggle") ||
	      btnCancelEndDate?.closest?.(".end-date-toggle") ||
	      null;
	    const endDateStatus =
	      subscriptionModal?.querySelector?.('[data-role="end-date-status"]') ||
	      document.querySelector?.('[data-role="end-date-status"]') ||
	      null;

	    const endDateWheelRoot = byId("endDateWheel");
	    const endDateInput = byId("subEndDate");
	    const endYearInput = byId("subEndYear");
	    const endMonthInput = byId("subEndMonth");
	    const endDayInput = byId("subEndDay");
	    const endDateWheel =
	      DATE_WHEEL_ENABLED && endDateWheelRoot && global.SubTracker.DateWheelPicker
	        ? new global.SubTracker.DateWheelPicker({ root: endDateWheelRoot, input: endDateInput, allowEmpty: true })
	        : null;

    function setEndDateUiVisible(isVisible, options) {
      const visible = Boolean(isVisible);
      if (endDateControls) endDateControls.hidden = !visible;
      if (endDateToggle) endDateToggle.classList.toggle("is-active", visible);
      if (btnToggleEndDate) {
        btnToggleEndDate.hidden = visible;
        btnToggleEndDate.setAttribute("aria-expanded", visible ? "true" : "false");
      }
      if (btnCancelEndDate) btnCancelEndDate.hidden = !visible;
      if (endDateStatus) {
        endDateStatus.hidden = visible;
        if (!visible) endDateStatus.textContent = "默认永久持续";
      }

      if (!visible && options?.clear === true) {
        // 清空结束日期：回到“永久持续”
        if (endDateWheel) endDateWheel.setDateISO("", { behavior: "auto" });
        else if (form) setFormValue(form, "endDate", "");
        setDateInputsFromIso("end", "");
      }
    }

    function getDefaultEndDateIsoFromStart() {
      if (!utils) return "";
      const startIso = getDateIsoFromInputs("start");
      if (!startIso) return "";
      const startDay = utils.parseISODateToDayNumber(startIso);
      if (!Number.isFinite(startDay)) return "";
      const prevDay = startDay - 1;
      const clamped =
        typeof utils.clampDayNumberToSupportedRange === "function"
          ? utils.clampDayNumberToSupportedRange(prevDay)
          : prevDay;
      return utils.dayNumberToISODate(clamped);
    }

    function parseIsoParts(iso) {
      const text = String(iso || "").trim();
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return null;
      return { year: match[1], month: match[2], day: match[3] };
    }

    function buildIsoFromParts(year, month, day) {
      const y = String(year || "").trim();
      const m = String(month || "").trim();
      const d = String(day || "").trim();
      if (!/^\d{4}$/.test(y)) return "";
      if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return "";
      const mm = String(Number(m)).padStart(2, "0");
      const dd = String(Number(d)).padStart(2, "0");
      const iso = `${y}-${mm}-${dd}`;
      if (utils && typeof utils.parseISODateToDayNumber === "function") {
        const parsed = utils.parseISODateToDayNumber(iso);
        if (parsed == null) return "";
      }
      return iso;
    }

    function setDateInputsFromIso(kind, iso) {
      const parts = parseIsoParts(iso);
      if (kind === "start") {
        if (startYearInput) startYearInput.value = parts ? parts.year : "";
        if (startMonthInput) startMonthInput.value = parts ? parts.month : "";
        if (startDayInput) startDayInput.value = parts ? parts.day : "";
        if (form) setFormValue(form, "startDate", parts ? iso : "");
        return;
      }
      if (kind === "end") {
        if (endYearInput) endYearInput.value = parts ? parts.year : "";
        if (endMonthInput) endMonthInput.value = parts ? parts.month : "";
        if (endDayInput) endDayInput.value = parts ? parts.day : "";
        if (form) setFormValue(form, "endDate", parts ? iso : "");
      }
    }

    function getDateIsoFromInputs(kind) {
      if (kind === "start") {
        const hasInputs = Boolean(startYearInput || startMonthInput || startDayInput);
        if (hasInputs) {
          const year = startYearInput?.value;
          const month = startMonthInput?.value;
          const day = startDayInput?.value;
          const hasAny = [year, month, day].some((val) => String(val || "").trim() !== "");
          if (!hasAny) return "";
          return buildIsoFromParts(year, month, day);
        }
        return getFormValue(form, "startDate");
      }
      const hasInputs = Boolean(endYearInput || endMonthInput || endDayInput);
      if (hasInputs) {
        const year = endYearInput?.value;
        const month = endMonthInput?.value;
        const day = endDayInput?.value;
        const hasAny = [year, month, day].some((val) => String(val || "").trim() !== "");
        if (!hasAny) return "";
        return buildIsoFromParts(year, month, day);
      }
      return getFormValue(form, "endDate");
    }

    function syncDateInputs(kind) {
      const iso = getDateIsoFromInputs(kind);
      if (form) setFormValue(form, kind === "start" ? "startDate" : "endDate", iso);
    }

    if (startYearInput || startMonthInput || startDayInput) {
      const onStartInput = () => syncDateInputs("start");
      startYearInput?.addEventListener("input", onStartInput);
      startMonthInput?.addEventListener("input", onStartInput);
      startDayInput?.addEventListener("input", onStartInput);
    }

    if (endYearInput || endMonthInput || endDayInput) {
      const onEndInput = () => syncDateInputs("end");
      endYearInput?.addEventListener("input", onEndInput);
      endMonthInput?.addEventListener("input", onEndInput);
      endDayInput?.addEventListener("input", onEndInput);
    }

    if (btnToggleEndDate) {
      btnToggleEndDate.addEventListener("click", () => {
        const currentlyVisible = endDateControls ? !endDateControls.hidden : false;
        if (currentlyVisible) return;
        setEndDateUiVisible(true, { clear: false });
        // 默认把结束日定位到“开始日的前一天”
        const existingEnd = getFormValue(form, "endDate");
        if (!existingEnd) {
          const cycle = String(getFormValue(form, "cycle") || "").trim().toLowerCase();
          const startIso = getDateIsoFromInputs("start");
          const startDay = utils.parseISODateToDayNumber(startIso);
          if (Number.isFinite(startDay)) {
            if (cycle === "monthly") {
              const parts = utils.dayNumberToParts(startDay);
              const next = utils.addMonthsClamped(parts, 1);
              const nextIso = utils.dayNumberToISODate(
                utils.toDayNumberUTC(next.year, next.monthIndex, next.day)
              );
              if (endDateWheel) endDateWheel.setDateISO(nextIso, { behavior: "auto" });
              else setDateInputsFromIso("end", nextIso);
              return;
            }
            if (cycle === "yearly") {
              const parts = utils.dayNumberToParts(startDay);
              const next = utils.addYearsClamped(parts, 1);
              const nextIso = utils.dayNumberToISODate(
                utils.toDayNumberUTC(next.year, next.monthIndex, next.day)
              );
              if (endDateWheel) endDateWheel.setDateISO(nextIso, { behavior: "auto" });
              else setDateInputsFromIso("end", nextIso);
              return;
            }
          }

          const fallbackIso = getDefaultEndDateIsoFromStart();
          if (fallbackIso) {
            if (endDateWheel) endDateWheel.setDateISO(fallbackIso, { behavior: "auto" });
            else setDateInputsFromIso("end", fallbackIso);
          }
        }
      });
    }

    if (btnCancelEndDate) {
      btnCancelEndDate.addEventListener("click", () => {
        setEndDateUiVisible(false, { clear: true });
      });
    }

	    // 统一以 USD 显示：通过汇率 API 把原币种换算为 USD
	    const currencies = global.SubTracker?.currencies || null;
	    let usdRates = null; // { CNY: 7.2, ... }（以 USD 为基准：1 USD = rate * currency）
	    let usdRatesJob = null;
    // 启动时尽量先读缓存：避免首次渲染全部显示 "-"
    const cachedUsd =
      currencies && typeof currencies.getCachedUsdRates === "function" ? currencies.getCachedUsdRates() : null;
    if (cachedUsd && cachedUsd.rates) usdRates = cachedUsd.rates;

    function convertToUsd(amount, currency, rates) {
      const value = Number(amount);
      if (!Number.isFinite(value)) return NaN;
      const code = String(currency || "CNY").toUpperCase();
      if (code === "USD") return value;
      const rate = Number(rates && rates[code]);
      if (!Number.isFinite(rate) || rate <= 0) return NaN;
      return value / rate;
    }

    function toDisplaySubscriptions(subscriptions) {
      const list = Array.isArray(subscriptions) ? subscriptions : [];
      return list.map((sub) => {
        if (!sub || typeof sub !== "object") return sub;
        const converted = convertToUsd(sub.price, sub.currency, usdRates);
        return { ...sub, price: converted, currency: "USD" };
      });
    }

    async function ensureUsdRates(options) {
      const forceRefresh = Boolean(options?.forceRefresh);
      if (usdRates && !forceRefresh) return { rates: usdRates, fromCache: false };

      // 先读缓存，避免网络失败时无可用结果
      const cached =
        currencies && typeof currencies.getCachedUsdRates === "function" ? currencies.getCachedUsdRates() : null;
      if (cached && cached.rates) usdRates = cached.rates;

      const controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
      const signal = controller ? controller.signal : undefined;
      const timeoutId = global.setTimeout(() => {
        try {
          if (controller) controller.abort();
        } catch {
          // ignore
        }
      }, 6500);

      let fetched = null;
      try {
        if (currencies && typeof currencies.fetchUsdRates === "function") {
          fetched = await currencies.fetchUsdRates(signal);
        }
      } catch {
        fetched = null;
      } finally {
        global.clearTimeout(timeoutId);
      }

      if (fetched && typeof fetched === "object") {
        usdRates = fetched;
        if (currencies && typeof currencies.setCachedUsdRates === "function") currencies.setCachedUsdRates(fetched);
        return { rates: usdRates, fromCache: false };
      }

      if (usdRates) return { rates: usdRates, fromCache: true };
      throw new Error("usd-rates-unavailable");
    }

	    // 时间轴行排序
		    const SORT_OPTIONS = [
		      { value: "start-desc", label: "订阅日期：近 → 远" },
		      { value: "start-asc", label: "订阅日期：远 → 近" },
		      { separator: true },
		      { value: "next-charge", label: "下次付费：近 → 远" },
		      { value: "next-charge-desc", label: "下次付费：远 → 近" },
		      { separator: true },
		      { value: "price-desc", label: "订阅价格：高 → 低" },
		      { value: "price-asc", label: "订阅价格：低 → 高" },
		      { separator: true },
		      { value: "recent-charge", label: "上次付费：近 → 远" },
		      { value: "recent-charge-asc", label: "上次付费：远 → 近" },
		    ];

	    // 恢复上一次的“排序方式”（写入 hidden input，再由 CyclePicker 同步 UI）
	    if (sortModeInput && typeof storage?.getPreferredSortMode === "function") {
	      const preferred = storage.getPreferredSortMode(sortModeInput.value || "next-charge");
	      if (preferred) sortModeInput.value = preferred;
	    }
	    let sortMode = String(sortModeInput?.value || "next-charge").trim().toLowerCase();
	    const sortPicker =
	      sortPickerRoot && sortModeInput && global.SubTracker?.CyclePicker
	        ? new global.SubTracker.CyclePicker({
	            root: sortPickerRoot,
	            input: sortModeInput,
	            options: SORT_OPTIONS,
	            onChange: (value) => {
	              sortMode = String(value || "").trim().toLowerCase() || "next-charge";
	              if (typeof storage?.setPreferredSortMode === "function") storage.setPreferredSortMode(sortMode);
	              refreshUI({ scrollToToday: false });
	            },
	          })
	        : null;
	    if (sortPicker) sortMode = sortPicker.getValue() || sortMode;
	    // 若本地存储值无效导致回退，补写一次确保下次打开仍然一致
	    if (typeof storage?.setPreferredSortMode === "function") storage.setPreferredSortMode(sortMode);

	    function setSortMode(nextMode) {
	      const normalized = normalizeSortMode(nextMode);
	      sortMode = normalized;
	      if (sortModeInput) sortModeInput.value = normalized;
	      if (sortPicker) sortPicker.setValue(normalized, { ensure: true, silent: true });
	      if (typeof storage?.setPreferredSortMode === "function") storage.setPreferredSortMode(normalized);
	      refreshUI({ scrollToToday: false });
	    }

	    if (priceSortToggle) {
	      priceSortToggle.addEventListener("click", () => {
	        const next =
	          sortMode === "price-desc"
	            ? "price-asc"
	            : sortMode === "price-asc"
	              ? "price-desc"
	              : "price-desc";
	        setSortMode(next);
	      });
	    }

    // 货币下拉：用 open.er-api.com 支持的币种自动补全（并缓存），避免手动维护列表
    if (currencyPicker && global.SubTracker?.currencies?.bootstrapCurrencyCodes) {
      global.SubTracker.currencies.bootstrapCurrencyCodes({
        fallbackCodes: ["CNY", "USD", "EUR", "JPY", "GBP"],
        onUpdate: (codes) => {
          currencyPicker.setCodes(codes);
        },
      });
    }

	    // 记住“上一次选择的货币”，用于下次新增的默认值
	    if (currencyInput && typeof storage?.setPreferredCurrency === "function") {
	      const savePreferredCurrency = () => {
	        preferredCurrencySession = String(currencyInput.value || "").trim().toUpperCase() || "USD";
	        storage.setPreferredCurrency(currencyInput.value);
	      };
	      currencyInput.addEventListener("input", savePreferredCurrency);
	      currencyInput.addEventListener("change", savePreferredCurrency);
	    }

		    // 今天高亮：iOS 开关（可显示/隐藏），并写入 localStorage 偏好
		    // 注意：需要在 Timeline 首次 render 之前就读出偏好，否则会出现“刷新时先亮一下再灭掉”的闪烁。
    let todayHighlightEnabled =
      typeof storage?.getPreferredTodayHighlightEnabled === "function"
        ? storage.getPreferredTodayHighlightEnabled(false)
        : false;
    let monthHighlightEnabled =
      typeof storage?.getPreferredMonthHighlightEnabled === "function"
        ? storage.getPreferredMonthHighlightEnabled(true)
        : true;
      let yearHighlightEnabled =
        typeof storage?.getPreferredYearHighlightEnabled === "function"
          ? storage.getPreferredYearHighlightEnabled(false)
          : false;

						    const timeline = new global.SubTracker.Timeline({
						      scroller: byId("timelineScroller"),
						      grid: byId("timelineGrid"),
						      xAxis: byId("xAxis"),
						      yAxis: byId("yAxis"),
						      canvas: byId("canvas"),
						      corner: byId("timelineCorner"),
						      summaryAxis: byId("summaryAxis"),
						      summaryCorner: byId("timelineSummaryCorner"),
						      todayHighlightEnabled,
						      monthHighlightEnabled,
						      yearHighlightEnabled,
						    });
	
	    function applyTodayHighlightEnabled(next, options) {
	      todayHighlightEnabled = next !== false;
		      // 同步到根节点 data 属性：用于首屏样式与后续交互保持一致
		      try {
		        document.documentElement.dataset.todayHighlight = todayHighlightEnabled ? "1" : "0";
		      } catch {
		        // ignore
		      }
      if (toggleTodayHighlight) {
        toggleTodayHighlight.classList.toggle("is-on", todayHighlightEnabled);
        toggleTodayHighlight.setAttribute("aria-checked", todayHighlightEnabled ? "true" : "false");
      }
      if (todayStatCard) {
        todayStatCard.classList.toggle("is-active", todayHighlightEnabled);
      }
      if (typeof timeline.setTodayHighlightEnabled === "function") timeline.setTodayHighlightEnabled(todayHighlightEnabled);
	      if (!options?.silent && typeof storage?.setPreferredTodayHighlightEnabled === "function") {
	        storage.setPreferredTodayHighlightEnabled(todayHighlightEnabled);
	      }
	      if (todayHighlightEnabled && !options?.silent) {
	        timeline.scrollToToday();
	      }
	    }

	    applyTodayHighlightEnabled(todayHighlightEnabled, { silent: true });

      function applyMonthHighlightEnabled(next, options) {
        monthHighlightEnabled = next === true;
        if (toggleMonthHighlight) {
          toggleMonthHighlight.classList.toggle("is-on", monthHighlightEnabled);
          toggleMonthHighlight.setAttribute("aria-checked", monthHighlightEnabled ? "true" : "false");
        }
        if (monthStatCard) {
          monthStatCard.classList.toggle("is-active", monthHighlightEnabled);
        }
        if (typeof timeline.setMonthHighlightEnabled === "function") {
          timeline.setMonthHighlightEnabled(monthHighlightEnabled);
        }
        if (!options?.silent && typeof storage?.setPreferredMonthHighlightEnabled === "function") {
          storage.setPreferredMonthHighlightEnabled(monthHighlightEnabled);
        }
      }

      function applyYearHighlightEnabled(next, options) {
        yearHighlightEnabled = next === true;
        if (toggleYearHighlight) {
          toggleYearHighlight.classList.toggle("is-on", yearHighlightEnabled);
          toggleYearHighlight.setAttribute("aria-checked", yearHighlightEnabled ? "true" : "false");
        }
        if (yearStatCard) {
          yearStatCard.classList.toggle("is-active", yearHighlightEnabled);
        }
        if (typeof timeline.setYearHighlightEnabled === "function") {
          timeline.setYearHighlightEnabled(yearHighlightEnabled);
        }
        if (!options?.silent && typeof storage?.setPreferredYearHighlightEnabled === "function") {
          storage.setPreferredYearHighlightEnabled(yearHighlightEnabled);
        }
      }

      applyMonthHighlightEnabled(monthHighlightEnabled, { silent: true });
      applyYearHighlightEnabled(yearHighlightEnabled, { silent: true });

      const bindStatCardToggle = (cardEl, onToggle) => {
        if (!cardEl || typeof onToggle !== "function") return;
        cardEl.classList.add("stat--toggle");
        cardEl.addEventListener("click", () => {
          onToggle();
        });
      };

      bindStatCardToggle(todayStatCard, () => applyTodayHighlightEnabled(!todayHighlightEnabled));
      bindStatCardToggle(monthStatCard, () => applyMonthHighlightEnabled(!monthHighlightEnabled));
      bindStatCardToggle(yearStatCard, () => applyYearHighlightEnabled(!yearHighlightEnabled));

		    if (typeof timeline.setOnAddSubscription === "function") {
		      timeline.setOnAddSubscription(() => {
		        setEditMode(null);
		        showSubscriptionModal();
	      });
	    }

    // 推荐色块：低饱和度色盘，支持一键点选（仍保留原生 color picker 作为“自定义”入口）
    const colorInput = byId("subColor");
    const colorSwatches = byId("colorSwatches");
    const logoPalette = byId("logoPalette");
    const logoPreviewWrap = byId("logoPreviewWrap");
    const logoPreview = byId("logoPreview");
    const logoSwatches = byId("logoSwatches");
    const linkInput = byId("subLink");
    const colorPaletteInput = byId("colorPalette");
    const recommendedColors =
      typeof timeline.getRecommendedColors === "function"
        ? timeline.getRecommendedColors()
        : [
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
    let swatchButtons = [];
    let logoSwatchButtons = [];
    const logoCache = new Map();
    let logoFetchToken = 0;
    let logoDebounce = null;

    function normalizeHexColor(value) {
      return String(value || "").trim().toLowerCase();
    }

    function clampRgbChannel(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      return Math.max(0, Math.min(255, Math.round(num)));
    }

    function rgbToHex(r, g, b) {
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }

    function hexToRgb(hex) {
      const text = normalizeHexColor(hex);
      const match = text.match(/^#([0-9a-f]{6})$/i);
      if (!match) return null;
      const value = match[1];
      const r = Number.parseInt(value.slice(0, 2), 16);
      const g = Number.parseInt(value.slice(2, 4), 16);
      const b = Number.parseInt(value.slice(4, 6), 16);
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
      return { r, g, b };
    }

    function syncColorSwatches() {
      if (!colorInput) return;
      const allSwatches = swatchButtons.concat(logoSwatchButtons);
      const current = normalizeHexColor(colorInput.value);
      if (allSwatches.length) {
        for (const btn of allSwatches) {
          const hit = normalizeHexColor(btn.dataset.color) === current;
          btn.classList.toggle("is-selected", hit);
          btn.setAttribute("aria-pressed", hit ? "true" : "false");
        }
      }
      syncCustomColorInputs();
    }

    function syncCustomColorInputs() {
      if (!colorInput) return;
      const rgb = hexToRgb(colorInput.value);
      if (!rgb) return;
      if (colorPaletteInput) colorPaletteInput.value = rgbToHex(rgb.r, rgb.g, rgb.b);
    }

    function renderColorSwatches() {
      if (!colorSwatches || !colorInput) return;
      colorSwatches.innerHTML = "";
      swatchButtons = [];

      const frag = document.createDocumentFragment();
      for (const color of recommendedColors) {
        const normalized = normalizeHexColor(color);
        if (!normalized) continue;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "color-swatch";
        btn.dataset.color = normalized;
        btn.style.background = normalized;
        btn.title = normalized.toUpperCase();
        btn.setAttribute("aria-label", `选择颜色：${normalized.toUpperCase()}`);
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", () => {
          colorInput.value = normalized;
          syncColorSwatches();
          // programmatic value change 不会触发 input/change：手动派发，保证编辑态“输入即生效”
          try {
            colorInput.dispatchEvent(new Event("input", { bubbles: true }));
            colorInput.dispatchEvent(new Event("change", { bubbles: true }));
          } catch {
            // ignore
          }
        });

        swatchButtons.push(btn);
        frag.appendChild(btn);
      }

      colorSwatches.appendChild(frag);
      syncColorSwatches();

      colorInput.addEventListener("input", syncColorSwatches);
      colorInput.addEventListener("change", syncColorSwatches);
    }

    renderColorSwatches();

    if (colorPaletteInput) {
      const onPaletteInput = () => {
        if (!colorInput) return;
        const value = normalizeHexColor(colorPaletteInput.value);
        if (!value) return;
        colorInput.value = value;
        syncColorSwatches();
        try {
          colorInput.dispatchEvent(new Event("input", { bubbles: true }));
          colorInput.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {
          // ignore
        }
      };
      colorPaletteInput.addEventListener("input", onPaletteInput);
      colorPaletteInput.addEventListener("change", onPaletteInput);
    }

    function normalizeUrlForOpen(raw) {
      const text = String(raw || "").trim();
      if (!text) return null;
      let candidate = text;
      const hasScheme = /^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(candidate);
      if (!hasScheme) candidate = `https://${candidate}`;
      try {
        const url = new URL(candidate);
        const protocol = String(url.protocol || "").toLowerCase();
        if (protocol !== "http:" && protocol !== "https:") return null;
        return url.toString();
      } catch {
        return null;
      }
    }

    function buildFaviconCandidates(openUrl) {
      try {
        const url = new URL(openUrl);
        const origin = url.origin;
        const host = url.hostname;
        const hostNoWww = String(host || "").replace(/^www\\./i, "");
        return {
          key: origin,
          candidates: [
            `${origin}/favicon.svg`,
            `${origin}/safari-pinned-tab.svg`,
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
          ].filter(Boolean),
        };
      } catch {
        return null;
      }
    }

    function normalizeSvgColorToken(token) {
      if (!token) return null;
      const value = String(token || "").trim().toLowerCase();
      if (!value || value === "none" || value === "transparent" || value === "currentcolor") return null;
      const hexMatch = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
      if (hexMatch) {
        const hex = hexMatch[1];
        if (hex.length === 3 || hex.length === 4) {
          const r = hex[0];
          const g = hex[1];
          const b = hex[2];
          return `#${r}${r}${g}${g}${b}${b}`;
        }
        if (hex.length === 6) return `#${hex}`;
        if (hex.length === 8) return `#${hex.slice(0, 6)}`;
      }
      const rgbMatch = value.match(/rgba?\\(\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*(?:,\\s*([0-9.]+)\\s*)?\\)/i);
      if (rgbMatch) {
        const r = Math.max(0, Math.min(255, Math.round(Number(rgbMatch[1]))));
        const g = Math.max(0, Math.min(255, Math.round(Number(rgbMatch[2]))));
        const b = Math.max(0, Math.min(255, Math.round(Number(rgbMatch[3]))));
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
          .toString(16)
          .padStart(2, "0")}`;
      }
      return null;
    }

    function extractSvgColors(svgText) {
      if (!svgText) return [];
      const text = String(svgText);
      const colors = new Set();
      const hexMatches = text.match(/#[0-9a-fA-F]{3,8}\\b/g) || [];
      for (const token of hexMatches) {
        const normalized = normalizeSvgColorToken(token);
        if (normalized) colors.add(normalized);
      }
      const rgbMatches = text.match(/rgba?\\([^\\)]*\\)/gi) || [];
      for (const token of rgbMatches) {
        const normalized = normalizeSvgColorToken(token);
        if (normalized) colors.add(normalized);
      }
      return Array.from(colors);
    }

    function renderLogoSwatches(colors) {
      if (!logoSwatches) return;
      logoSwatches.innerHTML = "";
      logoSwatchButtons = [];

      const list = Array.isArray(colors) ? colors : [];
      if (!list.length) {
        syncColorSwatches();
        return;
      }

      const frag = document.createDocumentFragment();
      for (const color of list) {
        const normalized = normalizeHexColor(color);
        if (!normalized) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "color-swatch";
        btn.dataset.color = normalized;
        btn.style.background = normalized;
        btn.title = normalized.toUpperCase();
        btn.setAttribute("aria-label", `选择颜色：${normalized.toUpperCase()}`);
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", () => {
          colorInput.value = normalized;
          syncColorSwatches();
          try {
            colorInput.dispatchEvent(new Event("input", { bubbles: true }));
            colorInput.dispatchEvent(new Event("change", { bubbles: true }));
          } catch {
            // ignore
          }
        });
        logoSwatchButtons.push(btn);
        frag.appendChild(btn);
      }

      logoSwatches.appendChild(frag);
      syncColorSwatches();
    }

    function setLogoPaletteVisible(visible) {
      if (logoPalette) logoPalette.hidden = !visible;
    }

    function clearLogoPalette() {
      if (logoPreview) logoPreview.removeAttribute("src");
      if (logoSwatches) logoSwatches.innerHTML = "";
      logoSwatchButtons = [];
      setLogoPaletteVisible(false);
    }

    async function fetchSvgFromCandidates(candidates, token) {
      for (const url of candidates) {
        if (!/\\.svg(\\?|$)/i.test(url)) continue;
        try {
          const res = await fetch(url, { cache: "force-cache" });
          if (!res.ok) continue;
          const text = await res.text();
          if (token !== logoFetchToken) return null;
          if (!/\\<svg[\\s\\>]/i.test(text)) continue;
          return { svgText: text, url };
        } catch {
          continue;
        }
      }
      return null;
    }

    function loadPreviewImage(candidates, token) {
      if (!logoPreview) return;
      let idx = 0;
      const tryNext = () => {
        if (token !== logoFetchToken) return;
        if (idx >= candidates.length) {
          logoPreview.removeAttribute("src");
          setLogoPaletteVisible(false);
          return;
        }
        const url = candidates[idx];
        idx += 1;
        logoPreview.onload = null;
        logoPreview.onerror = () => {
          logoPreview.onerror = null;
          tryNext();
        };
        logoPreview.src = url;
      };
      tryNext();
    }

    async function updateLogoPaletteFromLink(raw) {
      if (!logoPreview || !logoSwatches) return;
      const openUrl = normalizeUrlForOpen(raw);
      if (!openUrl) {
        clearLogoPalette();
        return;
      }
      const meta = buildFaviconCandidates(openUrl);
      if (!meta || !meta.candidates.length) {
        clearLogoPalette();
        return;
      }

      const cached = logoCache.get(meta.key);
      if (cached) {
        setLogoPaletteVisible(true);
        if (cached.previewUrl) logoPreview.src = cached.previewUrl;
        renderLogoSwatches(cached.colors || []);
        return;
      }

      setLogoPaletteVisible(true);
      renderLogoSwatches([]);

      const token = ++logoFetchToken;
      const svgResult = await fetchSvgFromCandidates(meta.candidates, token);
      if (token !== logoFetchToken) return;

      if (svgResult && svgResult.svgText) {
        const previewUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgResult.svgText)}`;
        logoPreview.src = previewUrl;
        const colors = extractSvgColors(svgResult.svgText);
        renderLogoSwatches(colors);
        logoCache.set(meta.key, { previewUrl, colors });
        return;
      }

      logoPreview.removeAttribute("src");
      renderLogoSwatches([]);
      loadPreviewImage(meta.candidates, token);
    }

    function scheduleLogoPaletteRefresh() {
      if (!linkInput) return;
      if (logoDebounce) global.clearTimeout(logoDebounce);
      const value = linkInput.value;
      logoDebounce = global.setTimeout(() => {
        logoDebounce = null;
        updateLogoPaletteFromLink(value);
      }, 260);
    }

    if (linkInput) {
      linkInput.addEventListener("input", scheduleLogoPaletteRefresh);
      linkInput.addEventListener("change", scheduleLogoPaletteRefresh);
    }

    function updateZoomUi(dayWidth) {
      const value = Number(dayWidth);
      if (!Number.isFinite(value)) return;
      if (zoomRange) zoomRange.value = String(value);
      if (zoomLabel) zoomLabel.textContent = `${String(value)} px/天`;
      updateSelectedCost();
    }

    timeline.setOnZoomChange(updateZoomUi);
    updateZoomUi(timeline.getDayWidth());

    if (typeof timeline.setOnSelectionChange === "function") {
      timeline.setOnSelectionChange(() => {
        updateSelectedCost();
      });
    }

    if (btnZoomIn) {
      btnZoomIn.addEventListener("click", () => {
        timeline.zoomIn();
      });
    }

    if (btnZoomOut) {
      btnZoomOut.addEventListener("click", () => {
        timeline.zoomOut();
      });
    }

    if (zoomRange) {
      let zoomRaf = null;
      let pending = timeline.getDayWidth();
      zoomRange.addEventListener("input", () => {
        pending = Number(zoomRange.value);
        if (zoomRaf) return;
        zoomRaf = global.requestAnimationFrame(() => {
          zoomRaf = null;
          timeline.setDayWidth(pending);
        });
      });
    }

	    if (zoomPresetButtons.length) {
	      for (const btn of zoomPresetButtons) {
	        btn.addEventListener("click", () => {
	          const value = Number(btn.dataset.zoomPreset);
	          if (!Number.isFinite(value)) return;
	          timeline.setDayWidth(value);
	          global.requestAnimationFrame(() => {
	            timeline.scrollToToday();
	          });
	        });
	      }
	    }

	    function loadSubscriptions() {
	      const list = storage.getSubscriptions();
	      // 保持存储层原始顺序（用于稳定排序的兜底）
	      return list.slice();
	    }

    function normalizeSortMode(value) {
      const v = String(value || "")
        .trim()
        .toLowerCase();
      if (!v) return "next-charge";
      return v;
    }

    function normalizeCycleForSort(value) {
      const v = String(value || "")
        .trim()
        .toLowerCase();
      if (v === "weekly" || v === "monthly" || v === "yearly") return v;
      return "monthly";
    }

    function toMs(iso) {
      const t = Date.parse(String(iso || ""));
      return Number.isFinite(t) ? t : 0;
    }

	    function computePrevAndNextChargeDay(sub, todayDay) {
	      const startDay = utils.parseISODateToDayNumber(sub?.startDate);
	      if (startDay == null) return { prev: null, next: null, startDay: null };
	      const endDayRaw = utils.parseISODateToDayNumber(sub?.endDate);
	      const endDay = endDayRaw != null ? endDayRaw : null;
	      const cycle = normalizeCycleForSort(sub?.cycle);

	      // 防御：结束日期早于开始日期，按“无效”处理
	      if (endDay != null && endDay < startDay) return { prev: null, next: null, startDay, endDay };

	      // 未开始：只有“下一次”是 startDate
	      if (startDay > todayDay) {
	        const next = endDay != null && startDay > endDay ? null : startDay;
	        return { prev: null, next, startDay, endDay };
	      }

	      // 已结束：用 endDay 作为参照计算“最后一次扣费”，但不再有 next
	      const referenceDay = endDay != null && endDay < todayDay ? endDay : todayDay;
	      if (startDay > referenceDay) return { prev: null, next: null, startDay, endDay };

	      if (cycle === "weekly") {
	        const delta = referenceDay - startDay;
	        const prev = startDay + Math.floor(delta / 7) * 7;
	        const next = startDay + Math.ceil(delta / 7) * 7;
	        const finalNext = endDay != null && (endDay < todayDay || next > endDay) ? null : next;
	        const finalPrev = endDay != null && prev > endDay ? null : prev;
	        return { prev: finalPrev, next: finalNext, startDay, endDay };
	      }

	      const startParts = utils.dayNumberToParts(startDay);
	      const refParts = utils.dayNumberToParts(referenceDay);

	      if (cycle === "yearly") {
	        let step = Math.max(0, refParts.year - startParts.year);
	        let candidateParts = utils.addYearsClamped(startParts, step);
	        let candidate = utils.toDayNumberUTC(candidateParts.year, candidateParts.monthIndex, candidateParts.day);

	        let next = candidate;
	        if (next < referenceDay) {
	          step += 1;
	          candidateParts = utils.addYearsClamped(startParts, step);
	          next = utils.toDayNumberUTC(candidateParts.year, candidateParts.monthIndex, candidateParts.day);
	        }

	        let prev = candidate;
	        if (prev > referenceDay) {
	          step = Math.max(0, step - 1);
	          candidateParts = utils.addYearsClamped(startParts, step);
	          prev = utils.toDayNumberUTC(candidateParts.year, candidateParts.monthIndex, candidateParts.day);
	        }

	        if (endDay != null && endDay < todayDay) next = null;
	        if (endDay != null && next != null && next > endDay) next = null;
	        if (endDay != null && prev != null && prev > endDay) prev = null;
	        return { prev, next, startDay, endDay };
	      }

	      // monthly（默认）
	      let step = Math.max(0, (refParts.year - startParts.year) * 12 + (refParts.monthIndex - startParts.monthIndex));
	      let candidateParts = utils.addMonthsClamped(startParts, step);
	      let candidate = utils.toDayNumberUTC(candidateParts.year, candidateParts.monthIndex, candidateParts.day);

	      let next = candidate;
	      if (next < referenceDay) {
	        step += 1;
	        candidateParts = utils.addMonthsClamped(startParts, step);
	        next = utils.toDayNumberUTC(candidateParts.year, candidateParts.monthIndex, candidateParts.day);
	      }

	      let prev = candidate;
	      if (prev > referenceDay) {
	        step = Math.max(0, step - 1);
	        candidateParts = utils.addMonthsClamped(startParts, step);
	        prev = utils.toDayNumberUTC(candidateParts.year, candidateParts.monthIndex, candidateParts.day);
	      }

	      if (endDay != null && endDay < todayDay) next = null;
	      if (endDay != null && next != null && next > endDay) next = null;
	      if (endDay != null && prev != null && prev > endDay) prev = null;
	      return { prev, next, startDay, endDay };
	    }

    function sortDisplaySubscriptions(subscriptions) {
      const mode = normalizeSortMode(sortMode);
      const list = Array.isArray(subscriptions) ? subscriptions.slice() : [];
      if (list.length <= 1) return list;

      const todayDay = utils.getTodayDayNumber();

      const decorated = list.map((sub, index) => {
        const price = Number(sub?.price);
        const safePrice = Number.isFinite(price) ? price : NaN;
        const { prev, next, startDay } = computePrevAndNextChargeDay(sub, todayDay);
        return {
          sub,
          index,
          id: String(sub?.id || ""),
          createdAtMs: toMs(sub?.createdAt),
          startDay: Number.isFinite(startDay) ? startDay : null,
          price: safePrice,
          prevChargeDay: Number.isFinite(prev) ? prev : null,
          nextChargeDay: Number.isFinite(next) ? next : null,
        };
      });

	      const cmpNumber = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
	      const cmpString = (a, b) => String(a || "").localeCompare(String(b || ""));

	      decorated.sort((a, b) => {
	        if (mode === "price-desc") {
	          const ap = Number.isFinite(a.price) ? a.price : -Infinity;
	          const bp = Number.isFinite(b.price) ? b.price : -Infinity;
	          const d = cmpNumber(bp, ap);
	          if (d !== 0) return d;
	        } else if (mode === "price-asc") {
	          const ap = Number.isFinite(a.price) ? a.price : Infinity;
	          const bp = Number.isFinite(b.price) ? b.price : Infinity;
	          const d = cmpNumber(ap, bp);
	          if (d !== 0) return d;
	        } else if (mode === "start-asc") {
	          const ap = a.startDay != null ? a.startDay : Infinity;
	          const bp = b.startDay != null ? b.startDay : Infinity;
	          const d = cmpNumber(ap, bp);
	          if (d !== 0) return d;
	        } else if (mode === "start-desc") {
	          const ap = a.startDay != null ? a.startDay : -Infinity;
	          const bp = b.startDay != null ? b.startDay : -Infinity;
	          const d = cmpNumber(bp, ap);
	          if (d !== 0) return d;
	        } else if (mode === "recent-charge") {
	          const ap = a.prevChargeDay != null ? a.prevChargeDay : -Infinity;
	          const bp = b.prevChargeDay != null ? b.prevChargeDay : -Infinity;
	          const d = cmpNumber(bp, ap);
	          if (d !== 0) return d;
	        } else if (mode === "recent-charge-asc") {
	          const ap = a.prevChargeDay != null ? a.prevChargeDay : Infinity;
	          const bp = b.prevChargeDay != null ? b.prevChargeDay : Infinity;
	          const d = cmpNumber(ap, bp);
	          if (d !== 0) return d;
	        } else if (mode === "next-charge-desc") {
	          const ap = a.nextChargeDay != null ? a.nextChargeDay : -Infinity;
	          const bp = b.nextChargeDay != null ? b.nextChargeDay : -Infinity;
	          const d = cmpNumber(bp, ap);
	          if (d !== 0) return d;
	        } else {
	          // next-charge（默认）
	          const ap = a.nextChargeDay != null ? a.nextChargeDay : Infinity;
	          const bp = b.nextChargeDay != null ? b.nextChargeDay : Infinity;
	          const d = cmpNumber(ap, bp);
	          if (d !== 0) return d;
	        }

        // 次级排序：尽量稳定
        const nextDiff = cmpNumber(
          a.nextChargeDay != null ? a.nextChargeDay : Infinity,
          b.nextChargeDay != null ? b.nextChargeDay : Infinity
        );
        if (nextDiff !== 0) return nextDiff;

        const startDiff = cmpNumber(
          a.startDay != null ? a.startDay : Infinity,
          b.startDay != null ? b.startDay : Infinity
        );
        if (startDiff !== 0) return startDiff;

        const createdDiff = cmpNumber(b.createdAtMs, a.createdAtMs);
        if (createdDiff !== 0) return createdDiff;

        const idDiff = cmpString(a.id, b.id);
        if (idDiff !== 0) return idDiff;

        return a.index - b.index;
      });

      return decorated.map((d) => d.sub);
    }

    function updateStats(subscriptions) {
      const today = utils.getTodayDayNumber();
      const active = subscriptions.filter((s) => {
        const start = utils.parseISODateToDayNumber(s.startDate);
        const end = utils.parseISODateToDayNumber(s.endDate);
        return start != null && start <= today && (end == null || end >= today);
      });

      statActiveCount.textContent = String(active.length);

      const monthlyTotals = groupTotalsByCurrency(active, estimateMonthlyCost);
      const yearlyTotals = groupTotalsByCurrency(active, estimateYearlyCost);
      const monthText =
        timeline && typeof timeline.getCurrentMonthTotalText === "function"
          ? timeline.getCurrentMonthTotalText()
          : formatTotalsMap(monthlyTotals);
      const yearText =
        timeline && typeof timeline.getCurrentYearTotalText === "function"
          ? timeline.getCurrentYearTotalText()
          : formatTotalsMap(yearlyTotals);
      setStatValue(statMonthlyTotal, monthText);
      setStatValue(statYearlyTotal, yearText);

      if (statTodayCost && timeline && typeof timeline.getDayTotalText === "function") {
        const todayText = timeline.getDayTotalText(today);
        setStatValue(statTodayCost, todayText);
      }

      updateSelectedCost();
    }

    function updateSelectedCost() {
      if (!statSelectedMeta || !timeline) return;
      const info = typeof timeline.getSelectedTotalsInfo === "function" ? timeline.getSelectedTotalsInfo() : null;
      if (!info) {
        statSelectedMeta.textContent = "-";
        const selectedCard = statSelectedMeta.closest(".stat");
        if (selectedCard) selectedCard.classList.remove("is-active");
        if (toggleSelectedHighlight) {
          toggleSelectedHighlight.classList.remove("is-on");
          toggleSelectedHighlight.setAttribute("aria-checked", "false");
        }
        return;
      }
      setStatValue(statSelectedMeta, info.text);
      const selectedCard = statSelectedMeta.closest(".stat");
      if (selectedCard) selectedCard.classList.add("is-active");
      if (toggleSelectedHighlight) {
        toggleSelectedHighlight.classList.add("is-on");
        toggleSelectedHighlight.setAttribute("aria-checked", "true");
      }
    }

    function refreshUI(options) {
      const subscriptions = getSubscriptionsWithDraft();
      const displaySubs = sortDisplaySubscriptions(toDisplaySubscriptions(subscriptions));
      timeline.setSubscriptions(displaySubs);
      updateStats(displaySubs);

      if (options?.scrollToToday) timeline.scrollToToday();
    }

    // 编辑态：仅在点击“保存修改”时生效（不再自动预览/自动落盘）
    const AUTO_PERSIST_DELAY_MS = 260;
    const AUTO_APPLY_ENABLED = false;
    let suppressAutoApply = false;
    let previewRaf = null;
    let persistTimer = null;

    function getEditingId() {
      return getFormValue(form, "id").trim();
    }

    function cancelAutoJobs() {
      if (previewRaf) {
        global.cancelAnimationFrame(previewRaf);
        previewRaf = null;
      }
      if (persistTimer) {
        global.clearTimeout(persistTimer);
        persistTimer = null;
      }
    }

	    function buildDraftSubscription(existing) {
      if (!existing) return null;

      const name = String(getFormValue(form, "name") || "").trim();

      const priceText = String(getFormValue(form, "price") ?? "").trim();
      const priceNumber = Number(priceText);
      const price = priceText && Number.isFinite(priceNumber) ? priceNumber : existing.price;

      const currencyRaw = String(getFormValue(form, "currency") || "").trim();
      const currency = (currencyRaw || existing.currency || "CNY").toUpperCase();

      const cycle = String(getFormValue(form, "cycle") || existing.cycle || "monthly");

      const startDateRaw = String(getDateIsoFromInputs("start") || "").trim();
	      const startDay = utils.parseISODateToDayNumber(startDateRaw);
	      const startDateOk =
	        startDay != null &&
	        (typeof utils.isDayNumberWithinSupportedRange !== "function" || utils.isDayNumberWithinSupportedRange(startDay));
	      const startDate = startDateOk ? startDateRaw : existing.startDate;

	      const effectiveStartDay = startDateOk ? startDay : utils.parseISODateToDayNumber(existing.startDate);

	      const endDateRaw = String(getDateIsoFromInputs("end") || "").trim();
	      let endDate = endDateRaw;
	      if (!endDateRaw) {
	        endDate = "";
	      } else {
	        const endDay = utils.parseISODateToDayNumber(endDateRaw);
	        const endOk =
	          endDay != null &&
	          (typeof utils.isDayNumberWithinSupportedRange !== "function" || utils.isDayNumberWithinSupportedRange(endDay)) &&
	          (effectiveStartDay == null || endDay >= effectiveStartDay);
	        endDate = endOk ? endDateRaw : String(existing.endDate || "");
	      }

      const colorRaw = String(getFormValue(form, "color") || "").trim();
      const color = colorRaw || existing.color || "#b3e2cd";

      const link = String(getFormValue(form, "link") || "").trim();

	      return {
	        ...existing,
	        name,
	        price,
	        currency,
	        cycle,
	        startDate,
	        endDate,
	        color,
	        link,
	      };
	    }

    function getSubscriptionsWithDraft() {
      const list = loadSubscriptions();
      if (!AUTO_APPLY_ENABLED) return list;
      const editingId = getEditingId();
      if (!editingId) return list;

      const idx = list.findIndex((s) => s && s.id === editingId);
      if (idx < 0) return list;

      const draft = buildDraftSubscription(list[idx]);
      if (!draft) return list;

	      const next = list.slice();
	      next[idx] = draft;
	      return next;
	    }

    function schedulePreviewRender() {
      if (!AUTO_APPLY_ENABLED) return;
      if (previewRaf) return;
      previewRaf = global.requestAnimationFrame(() => {
        previewRaf = null;
        const subscriptions = getSubscriptionsWithDraft();
        const displaySubs = sortDisplaySubscriptions(toDisplaySubscriptions(subscriptions));
        timeline.setSubscriptions(displaySubs);
        updateStats(displaySubs);
      });
    }

    function persistEditIfValid() {
      if (!AUTO_APPLY_ENABLED) return;
      if (suppressAutoApply) return;
      const id = getEditingId();
      if (!id) return;

      const existing = storage.getSubscriptions().find((s) => s && s.id === id) || null;
      if (!existing) return;

	      const { subscription, error } = normalizeSubscriptionInput(
	        {
	          id,
	          name: getFormValue(form, "name"),
	          price: getFormValue(form, "price"),
	          currency: getFormValue(form, "currency"),
	          cycle: getFormValue(form, "cycle"),
          startDate: getDateIsoFromInputs("start"),
          endDate: getDateIsoFromInputs("end"),
	          color: getFormValue(form, "color"),
	          link: getFormValue(form, "link"),
	        },
	        existing
	      );

      if (error) {
        formError.textContent = error;
        formError.hidden = false;
        return;
      }

	      const changed =
	        subscription.name !== existing.name ||
	        Number(subscription.price) !== Number(existing.price) ||
	        subscription.currency !== existing.currency ||
	        subscription.cycle !== existing.cycle ||
	        subscription.startDate !== existing.startDate ||
	        (subscription.endDate || "") !== (existing.endDate || "") ||
	        (subscription.color || "") !== (existing.color || "") ||
	        (subscription.link || "") !== (existing.link || "");

      if (!changed) return;

      storage.upsertSubscription(subscription);
      formError.hidden = true;
    }

    function scheduleAutoPersist() {
      if (!AUTO_APPLY_ENABLED) return;
      if (persistTimer) global.clearTimeout(persistTimer);
      persistTimer = global.setTimeout(() => {
        persistTimer = null;
        persistEditIfValid();
      }, AUTO_PERSIST_DELAY_MS);
    }

    function flushAutoPersist() {
      if (!AUTO_APPLY_ENABLED) return;
      if (!persistTimer) {
        persistEditIfValid();
        return;
      }
      global.clearTimeout(persistTimer);
      persistTimer = null;
      persistEditIfValid();
    }

    function handleEditChange() {
      if (!AUTO_APPLY_ENABLED) return;
      if (suppressAutoApply) return;
      if (!getEditingId()) return;
      formError.hidden = true;
      schedulePreviewRender();
      scheduleAutoPersist();
    }

	    function setEditMode(subscription) {
	      // 切换编辑对象/退出编辑前，尽量把最后一次输入落盘
	      flushAutoPersist();
	      cancelAutoJobs();

		      suppressAutoApply = true;
      if (!subscription) {
        formTitle.textContent = "添加订阅";
        if (btnSubmit) {
          btnSubmit.hidden = false;
          btnSubmit.textContent = "新增";
        }
        btnCancelEdit.hidden = true;
        btnDelete.hidden = true;
        timeline.setSelectedId(null);
		        form.reset();
		        formError.hidden = true;
	        setFormValue(form, "id", "");
		        // 默认货币：USD（会话内若用户手动改过，则沿用该值）
		        const preferredCurrency = preferredCurrencySession || "USD";
		        if (currencyPicker) currencyPicker.setValue(preferredCurrency, { ensure: true, silent: true });
		        else setFormValue(form, "currency", preferredCurrency);
		        // 默认开始日期：今天
		        const todayDay = utils.getTodayDayNumber();
		        const safeTodayDay =
		          typeof utils.clampDayNumberToSupportedRange === "function"
		            ? utils.clampDayNumberToSupportedRange(todayDay)
		            : todayDay;
			        const todayIso = utils.dayNumberToISODate(safeTodayDay);
        if (dateWheel) dateWheel.setDateISO(todayIso, { behavior: "auto" });
        else setDateInputsFromIso("start", todayIso);
			        // 默认结束日期：永久持续（不展示滚轴，除非用户主动点“设置结束日期”）
			        setEndDateUiVisible(false, { clear: true });
			        // 默认周期：月度
			        if (cyclePicker) cyclePicker.setValue("monthly", { silent: true });
			        else setFormValue(form, "cycle", "monthly");
		        // 颜色：按当前数量取色盘
        const usedCount = storage.getSubscriptions().length;
        setFormValue(form, "color", timeline.getDefaultColor(usedCount));
        syncColorSwatches();
        scheduleLogoPaletteRefresh();
        suppressAutoApply = false;
        return;
      }

      formTitle.textContent = "编辑订阅";
      if (btnSubmit) {
        btnSubmit.hidden = false;
        btnSubmit.textContent = "保存修改";
      }
      btnCancelEdit.hidden = false;
      btnDelete.hidden = false;
      formError.hidden = true;

      setFormValue(form, "id", subscription.id);
      setFormValue(form, "name", subscription.name);
		      setFormValue(form, "price", subscription.price);
		      if (currencyPicker) currencyPicker.setValue(subscription.currency, { ensure: true, silent: true });
		      else setFormValue(form, "currency", subscription.currency);
			      if (cyclePicker) cyclePicker.setValue(subscription.cycle, { ensure: true, silent: true });
			      else setFormValue(form, "cycle", subscription.cycle);
      if (dateWheel) dateWheel.setDateISO(subscription.startDate, { behavior: "auto" });
      else setDateInputsFromIso("start", subscription.startDate);
      if (endDateWheel) endDateWheel.setDateISO(subscription.endDate || "", { behavior: "auto" });
      else setDateInputsFromIso("end", subscription.endDate || "");
			      // 编辑态：有结束日期才展开；否则显示“永久持续 + 设置结束日期”按钮
			      setEndDateUiVisible(Boolean(subscription.endDate), { clear: !subscription.endDate });
			      setFormValue(form, "color", subscription.color || "#b3e2cd");
      setFormValue(form, "link", subscription.link || "");
      syncColorSwatches();
      scheduleLogoPaletteRefresh();
      timeline.setSelectedId(subscription.id);
      suppressAutoApply = false;
    }

    async function bootstrapUsdRates() {
      if (usdRatesJob) return;
      usdRatesJob = (async () => {
        try {
          const result = await ensureUsdRates({ forceRefresh: true });
          usdRates = result.rates;
          refreshUI({ scrollToToday: false });
        } catch {
          // 没有任何可用汇率：保持 "-"（用户恢复网络后刷新页面即可）
        } finally {
          usdRatesJob = null;
        }
      })();
      await usdRatesJob;
    }

    function findById(id) {
      const list = storage.getSubscriptions();
      return list.find((s) => s && s.id === id) || null;
    }

	    function requestDeleteById(id) {
	      if (!id) return;
	      const sub = findById(id);
	      if (!sub) return;

	      storage.deleteSubscription(id);

	      // 若正在编辑被删除的订阅，则退出编辑态
	      if (getFormValue(form, "id") === id) {
	        setEditMode(null);
	        hideSubscriptionModal();
	      }

	      refreshUI({ scrollToToday: false });
	    }

	    timeline.setOnSubscriptionClick((id) => {
	      if (!id) return;
	      flushAutoPersist();
	      const sub = findById(id);
	      if (!sub) return;
	      setEditMode(sub);
	      showSubscriptionModal();
	    });

    timeline.setOnSubscriptionDelete((id) => {
      requestDeleteById(id);
    });

    btnToday.addEventListener("click", () => {
      timeline.scrollToToday();
      applyTodayHighlightEnabled(true);
    });

    function buildExportPayload() {
      const list = typeof storage?.getSubscriptions === "function" ? storage.getSubscriptions() : [];
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        subscriptions: Array.isArray(list) ? list : [],
      };
    }

    function normalizeImportedSubscription(raw) {
      if (!raw || typeof raw !== "object") return null;
      const name = String(raw.name || "").trim();
      const startDate = String(raw.startDate || "").trim();
      if (!name || !startDate) return null;
      if (utils && typeof utils.parseISODateToDayNumber === "function") {
        const parsed = utils.parseISODateToDayNumber(startDate);
        if (parsed == null) return null;
      }
      const id =
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id.trim()
          : utils && typeof utils.generateId === "function"
            ? utils.generateId()
            : `sub_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const price = Number(raw.price);
      return {
        id,
        name,
        price: Number.isFinite(price) ? price : 0,
        currency: String(raw.currency || "USD").toUpperCase(),
        cycle: String(raw.cycle || "monthly").toLowerCase(),
        startDate,
        endDate: raw.endDate ? String(raw.endDate).trim() : "",
        color: raw.color ? String(raw.color).trim() : "",
        link: raw.link ? String(raw.link).trim() : "",
        createdAt: raw.createdAt ? String(raw.createdAt).trim() : new Date().toISOString(),
      };
    }

    function handleImportPayload(payload) {
      let subscriptions = null;
      if (Array.isArray(payload)) {
        subscriptions = payload;
      } else if (payload && Array.isArray(payload.subscriptions)) {
        subscriptions = payload.subscriptions;
      } else if (payload && payload.data && Array.isArray(payload.data.subscriptions)) {
        subscriptions = payload.data.subscriptions;
      }
      if (!subscriptions) return false;
      const cleaned = subscriptions
        .map((item) => normalizeImportedSubscription(item))
        .filter((item) => item);
      if (!cleaned.length) return false;
      if (typeof storage?.setSubscriptions === "function") storage.setSubscriptions(cleaned);
      refreshUI({ scrollToToday: false });
      return true;
    }

    if (btnExport) {
      btnExport.addEventListener("click", () => {
        const payload = buildExportPayload();
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().slice(0, 10);
        const link = document.createElement("a");
        link.href = url;
        link.download = `subscriptions-${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      });
    }

    if (btnImport && importFileInput) {
      btnImport.addEventListener("click", () => {
        importFileInput.value = "";
        importFileInput.click();
      });
      importFileInput.addEventListener("change", async () => {
        const file = importFileInput.files && importFileInput.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          handleImportPayload(parsed);
        } catch {
          // ignore
        } finally {
          importFileInput.value = "";
        }
      });
    }

	    btnCancelEdit.addEventListener("click", () => {
	      closeSubscriptionModal();
	    });

	    btnDelete.addEventListener("click", () => {
	      requestDeleteById(getFormValue(form, "id"));
	    });

    // 表单编辑：监听输入变化（仅在编辑态生效）
    form.addEventListener("input", handleEditChange);
    form.addEventListener("change", handleEditChange);
    if (dateWheel) dateWheel.onChange = handleEditChange;
    if (endDateWheel) endDateWheel.onChange = handleEditChange;
    global.addEventListener("beforeunload", () => {
      try {
        flushAutoPersist();
      } catch {
        // ignore
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const id = getFormValue(form, "id");
      const existing = id ? findById(id) : null;

      const { subscription, error } = normalizeSubscriptionInput(
        {
          id: id || "",
          name: getFormValue(form, "name"),
          price: getFormValue(form, "price"),
	          currency: getFormValue(form, "currency"),
	          cycle: getFormValue(form, "cycle"),
          startDate: getDateIsoFromInputs("start"),
          endDate: getDateIsoFromInputs("end"),
	          color: getFormValue(form, "color"),
	          link: getFormValue(form, "link"),
	        },
	        existing
	      );

      if (error) {
        formError.textContent = error;
        formError.hidden = false;
        return;
      }

      storage.upsertSubscription(subscription);
      if (typeof storage?.setPreferredCurrency === "function") storage.setPreferredCurrency(subscription.currency);
      formError.hidden = true;

      if (!id) {
        // 保存新增后回到“添加模式”，并保留一个合理的默认颜色/日期
        setEditMode(null);
        refreshUI({ scrollToToday: false });
        hideSubscriptionModal();
        return;
      }

      // 保存修改：仅在点击按钮时生效
      refreshUI({ scrollToToday: false });
    });

		    if (btnCloseModal) btnCloseModal.addEventListener("click", closeSubscriptionModal);
		    if (subscriptionModalBackdrop) subscriptionModalBackdrop.addEventListener("click", closeSubscriptionModal);

		    global.addEventListener("keydown", (e) => {
		      if (e.key !== "Escape") return;
		      if (!subscriptionModal || subscriptionModal.hidden) return;
		      e.preventDefault();
		      closeSubscriptionModal();
		    });

	    // 初始化默认值
	    setEditMode(null);
	    // 统一换算为 USD 显示（汇率异步更新不影响滚动定位）
	    bootstrapUsdRates();
    refreshUI({ scrollToToday: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
