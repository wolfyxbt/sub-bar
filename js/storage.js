(function (global) {
  "use strict";

  // localStorage 存储封装：只负责读写与基本的 upsert/delete
  const STORAGE_KEY = "subscription-tracker:v1";
  // UI 偏好：上一次选择的“货币单位”（用于下次新增的默认值）
  const PREF_LAST_CURRENCY_KEY = "subscription-tracker:pref:last-currency:v1";
	  // UI 偏好：上一次选择的“排序方式”（用于下次打开时恢复）
	  const PREF_SORT_MODE_KEY = "subscription-tracker:pref:sort-mode:v1";
	  // UI 偏好：今天高亮是否显示（用于下次打开时恢复）
	  const PREF_TODAY_HIGHLIGHT_KEY = "subscription-tracker:pref:today-highlight:v1";
	  // UI 偏好：本月高亮是否显示（用于下次打开时恢复）
	  const PREF_MONTH_HIGHLIGHT_KEY = "subscription-tracker:pref:month-highlight:v1";
	  // UI 偏好：本年高亮是否显示（用于下次打开时恢复）
	  const PREF_YEAR_HIGHLIGHT_KEY = "subscription-tracker:pref:year-highlight:v1";

  function normalizeCurrencyCode(code) {
    return String(code || "")
      .trim()
      .toUpperCase();
  }

  function isIso4217Like(code) {
    return /^[A-Z]{3}$/.test(String(code || ""));
  }

  function safeParse(jsonText) {
    try {
      return JSON.parse(jsonText);
    } catch {
      return null;
    }
  }

	  function loadState() {
	    const raw = global.localStorage.getItem(STORAGE_KEY);
	    if (!raw) return { subscriptions: [] };
	    const parsed = safeParse(raw);
	    if (!parsed) return { subscriptions: [] };
	
	    // 兼容旧格式：直接存数组（后续统一迁移为 { subscriptions: [...] }）
	    if (Array.isArray(parsed)) {
	      const state = { subscriptions: parsed.slice() };
	      try {
	        saveState(state);
	      } catch {
	        // ignore
	      }
	      return state;
	    }
	
	    if (typeof parsed !== "object") return { subscriptions: [] };
	    const subscriptions = Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [];
	    return { subscriptions };
	  }

  function saveState(state) {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getSubscriptions() {
    const { subscriptions } = loadState();
    return subscriptions.slice();
  }

  function setSubscriptions(subscriptions) {
    saveState({ subscriptions: subscriptions.slice() });
  }

  function upsertSubscription(subscription) {
    const state = loadState();
    const idx = state.subscriptions.findIndex((s) => s && s.id === subscription.id);
    if (idx >= 0) {
      state.subscriptions[idx] = subscription;
    } else {
      state.subscriptions.push(subscription);
    }
    saveState(state);
  }

  function deleteSubscription(id) {
    const state = loadState();
    state.subscriptions = state.subscriptions.filter((s) => s && s.id !== id);
    saveState(state);
  }

  function getPreferredCurrency(fallback) {
    const fb = normalizeCurrencyCode(fallback || "CNY") || "CNY";
    try {
      const raw = global.localStorage.getItem(PREF_LAST_CURRENCY_KEY);
      const code = normalizeCurrencyCode(raw);
      if (!code) return fb;
      if (!isIso4217Like(code)) return fb;
      return code;
    } catch {
      return fb;
    }
  }

  function setPreferredCurrency(code) {
    const normalized = normalizeCurrencyCode(code);
    if (!normalized) return;
    if (!isIso4217Like(normalized)) return;
    try {
      global.localStorage.setItem(PREF_LAST_CURRENCY_KEY, normalized);
    } catch {
      // ignore
    }
  }

  function normalizeSortMode(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function getPreferredSortMode(fallback) {
    const fb = normalizeSortMode(fallback || "next-charge") || "next-charge";
    try {
      const raw = global.localStorage.getItem(PREF_SORT_MODE_KEY);
      const mode = normalizeSortMode(raw);
      if (!mode) return fb;
      // 防御：限制长度，避免异常数据污染 UI
      if (mode.length > 60) return fb;
      return mode;
    } catch {
      return fb;
    }
  }

	  function setPreferredSortMode(mode) {
	    const value = normalizeSortMode(mode);
	    if (!value) return;
	    if (value.length > 60) return;
	    try {
	      global.localStorage.setItem(PREF_SORT_MODE_KEY, value);
	    } catch {
	      // ignore
	    }
	  }
	
	  function getPreferredTodayHighlightEnabled(fallback) {
	    const fb = fallback !== false;
	    try {
	      const raw = global.localStorage.getItem(PREF_TODAY_HIGHLIGHT_KEY);
	      if (raw == null) return fb;
	      const v = String(raw).trim().toLowerCase();
	      if (v === "0" || v === "false" || v === "off" || v === "no") return false;
	      if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
	      return fb;
	    } catch {
	      return fb;
	    }
	  }
	
	  function setPreferredTodayHighlightEnabled(enabled) {
	    try {
	      global.localStorage.setItem(PREF_TODAY_HIGHLIGHT_KEY, enabled !== false ? "1" : "0");
	    } catch {
	      // ignore
	    }
	  }

	  function getPreferredMonthHighlightEnabled(fallback) {
	    const fb = fallback === true;
	    try {
	      const raw = global.localStorage.getItem(PREF_MONTH_HIGHLIGHT_KEY);
	      if (raw == null) return fb;
	      const v = String(raw).trim().toLowerCase();
	      if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
	      if (v === "0" || v === "false" || v === "off" || v === "no") return false;
	      return fb;
	    } catch {
	      return fb;
	    }
	  }

	  function setPreferredMonthHighlightEnabled(enabled) {
	    try {
	      global.localStorage.setItem(PREF_MONTH_HIGHLIGHT_KEY, enabled === true ? "1" : "0");
	    } catch {
	      // ignore
	    }
	  }

	  function getPreferredYearHighlightEnabled(fallback) {
	    const fb = fallback === true;
	    try {
	      const raw = global.localStorage.getItem(PREF_YEAR_HIGHLIGHT_KEY);
	      if (raw == null) return fb;
	      const v = String(raw).trim().toLowerCase();
	      if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
	      if (v === "0" || v === "false" || v === "off" || v === "no") return false;
	      return fb;
	    } catch {
	      return fb;
	    }
	  }

	  function setPreferredYearHighlightEnabled(enabled) {
	    try {
	      global.localStorage.setItem(PREF_YEAR_HIGHLIGHT_KEY, enabled === true ? "1" : "0");
	    } catch {
	      // ignore
	    }
	  }

  global.SubTracker = global.SubTracker || {};
	  global.SubTracker.storage = {
	    STORAGE_KEY,
	    PREF_LAST_CURRENCY_KEY,
	    PREF_SORT_MODE_KEY,
	    PREF_TODAY_HIGHLIGHT_KEY,
	    PREF_MONTH_HIGHLIGHT_KEY,
	    PREF_YEAR_HIGHLIGHT_KEY,
	    loadState,
	    saveState,
	    getSubscriptions,
	    setSubscriptions,
	    upsertSubscription,
	    deleteSubscription,
	    getPreferredCurrency,
	    setPreferredCurrency,
	    getPreferredSortMode,
	    setPreferredSortMode,
	    getPreferredTodayHighlightEnabled,
	    setPreferredTodayHighlightEnabled,
	    getPreferredMonthHighlightEnabled,
	    setPreferredMonthHighlightEnabled,
	    getPreferredYearHighlightEnabled,
	    setPreferredYearHighlightEnabled,
	  };
})(window);
