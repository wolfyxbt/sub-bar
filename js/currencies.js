(function (global) {
  "use strict";

  // 货币列表：从 open.er-api.com 获取支持的法币（以 code 为主），并缓存到 localStorage

  const CACHE_KEY = "subscription-tracker:currency-codes:v1";
  const USD_RATES_CACHE_KEY = "subscription-tracker:usd-rates:v1";
  const API_URL = "https://open.er-api.com/v6/latest/USD";

  // 常用货币：用于更友好的显示（其余币种只显示 code）
  const DEFAULT_LABELS = {
    CNY: "CNY（人民币）",
    USD: "USD（美元）",
    EUR: "EUR（欧元）",
    JPY: "JPY（日元）",
    GBP: "GBP（英镑）",
  };

  // 这些通常不是“法币”，避免混入下拉菜单（仍可手动保证兼容）
  const EXCLUDED_CODES = new Set(["XAU", "XAG", "XDR", "XPD", "XPT", "XTS"]);

  function normalizeCode(code) {
    return String(code || "")
      .trim()
      .toUpperCase();
  }

  function isIso4217Like(code) {
    return /^[A-Z]{3}$/.test(code);
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function getCachedCodes() {
    try {
      const raw = global.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = safeJsonParse(raw);
      const codes = parsed && Array.isArray(parsed.codes) ? parsed.codes : null;
      if (!codes) return null;
      return codes.map(normalizeCode).filter(Boolean);
    } catch {
      return null;
    }
  }

  function getCachedUsdRates() {
    try {
      const raw = global.localStorage.getItem(USD_RATES_CACHE_KEY);
      if (!raw) return null;
      const parsed = safeJsonParse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const ratesRaw = parsed.rates && typeof parsed.rates === "object" ? parsed.rates : null;
      if (!ratesRaw) return null;
      const rates = normalizeRatesObject(ratesRaw);
      if (!rates) return null;
      const fetchedAt = Number(parsed.fetchedAt) || 0;
      return { rates, fetchedAt };
    } catch {
      return null;
    }
  }

  function setCachedCodes(codes) {
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify({ codes: codes.slice(), fetchedAt: Date.now() }));
    } catch {
      // ignore
    }
  }

  function setCachedUsdRates(rates) {
    try {
      global.localStorage.setItem(USD_RATES_CACHE_KEY, JSON.stringify({ rates, fetchedAt: Date.now() }));
    } catch {
      // ignore
    }
  }

  function uniq(list) {
    const out = [];
    const seen = new Set();
    for (const item of list) {
      const normalized = normalizeCode(item);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  function sortWithPriority(codes) {
    const priority = ["CNY", "USD", "EUR", "JPY", "GBP"];
    const uniqCodes = uniq(codes);
    const set = new Set(uniqCodes);
    const head = [];
    for (const code of priority) {
      if (set.has(code)) head.push(code);
    }
    const headSet = new Set(head);
    const tail = uniqCodes
      .filter((code) => !headSet.has(code))
      .slice()
      .sort((a, b) => a.localeCompare(b));
    return head.concat(tail);
  }

  function optionLabel(code) {
    const normalized = normalizeCode(code);
    return DEFAULT_LABELS[normalized] || normalized || "-";
  }

  function bootstrapCurrencyCodes(options) {
    const onUpdate = typeof options?.onUpdate === "function" ? options.onUpdate : null;
    const fallbackCodes = Array.isArray(options?.fallbackCodes) ? options.fallbackCodes : Object.keys(DEFAULT_LABELS);

    const cached = getCachedCodes();
    const initial = cached && cached.length ? uniq(cached.concat(fallbackCodes)) : uniq(fallbackCodes);
    if (onUpdate) onUpdate(initial);

    // 后台更新（失败就静默忽略）
    const controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
    const signal = controller ? controller.signal : undefined;
    const timeoutId = global.setTimeout(() => {
      try {
        if (controller) controller.abort();
      } catch {
        // ignore
      }
    }, 6000);

    fetchSupportedCodes(signal)
      .then((codes) => {
        global.clearTimeout(timeoutId);
        setCachedCodes(codes);
        if (onUpdate) onUpdate(uniq(codes.concat(fallbackCodes)));
      })
      .catch(() => {
        global.clearTimeout(timeoutId);
      });

    return {
      cancel() {
        try {
          if (controller) controller.abort();
        } catch {
          // ignore
        }
      },
    };
  }

  function applySelectOptions(selectEl, codes, options) {
    if (!selectEl) return;
    const keepValue = options?.keepValue !== false;
    const prev = keepValue ? normalizeCode(selectEl.value) : "";

    const filtered = sortWithPriority(
      uniq(codes)
        .map(normalizeCode)
        .filter((code) => isIso4217Like(code) && !EXCLUDED_CODES.has(code))
    );

    selectEl.innerHTML = "";
    for (const code of filtered) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = optionLabel(code);
      // 让 form.reset() 时回到 CNY（如果存在）
      if (code === "CNY") opt.defaultSelected = true;
      selectEl.appendChild(opt);
    }

    if (prev && filtered.includes(prev)) {
      selectEl.value = prev;
    } else if (filtered.includes("CNY")) {
      selectEl.value = "CNY";
    }
  }

  function ensureSelectHasOption(selectEl, code) {
    if (!selectEl) return;
    const normalized = normalizeCode(code);
    if (!normalized) return;
    if (!isIso4217Like(normalized)) return;

    for (const opt of selectEl.options) {
      if (normalizeCode(opt.value) === normalized) return;
    }

    const opt = document.createElement("option");
    opt.value = normalized;
    opt.textContent = optionLabel(normalized);
    selectEl.appendChild(opt);
  }

  function parseSupportedCodesFromResponse(data) {
    if (!data || typeof data !== "object") return null;

    // /v6/latest/USD：常见结构是 { rates: { CNY: 7.2, ... } }
    if (data.rates && typeof data.rates === "object") {
      return Object.keys(data.rates);
    }

    // 兼容：某些接口会返回 { supported_codes: [[ "USD", "United States Dollar" ], ...] }
    if (Array.isArray(data.supported_codes)) {
      return data.supported_codes
        .map((row) => (Array.isArray(row) ? row[0] : null))
        .filter((code) => typeof code === "string");
    }

    return null;
  }

  function normalizeRatesObject(rates) {
    if (!rates || typeof rates !== "object") return null;
    const out = {};
    for (const [codeRaw, valueRaw] of Object.entries(rates)) {
      const code = normalizeCode(codeRaw);
      if (!isIso4217Like(code)) continue;
      const value = Number(valueRaw);
      if (!Number.isFinite(value) || value <= 0) continue;
      out[code] = value;
    }
    if (!out.USD) out.USD = 1;
    return Object.keys(out).length ? out : null;
  }

  async function fetchUsdRates(signal) {
    if (typeof global.fetch !== "function") throw new Error("fetch-not-available");
    const resp = await global.fetch(API_URL, { signal, cache: "no-store" });
    if (!resp.ok) throw new Error(`http-${resp.status}`);
    const data = await resp.json();
    const rates = normalizeRatesObject(data && data.rates ? data.rates : null);
    if (!rates) throw new Error("invalid-response");
    return rates;
  }

  async function fetchSupportedCodes(signal) {
    if (typeof global.fetch !== "function") throw new Error("fetch-not-available");
    const resp = await global.fetch(API_URL, { signal, cache: "no-store" });
    if (!resp.ok) throw new Error(`http-${resp.status}`);
    const data = await resp.json();
    const codes = parseSupportedCodesFromResponse(data);
    if (!codes) throw new Error("invalid-response");
    return uniq(codes.map(normalizeCode));
  }

  function bootstrapCurrencySelect(selectEl) {
    if (!selectEl) return;

    // 先用页面里已有的选项作为兜底
    const existingCodes = Array.from(selectEl.options)
      .map((opt) => normalizeCode(opt.value))
      .filter(Boolean);

    // 有缓存就先渲染缓存（更完整、也支持离线），随后再后台刷新
    const cached = getCachedCodes();
    const initial = cached && cached.length ? uniq(cached.concat(existingCodes)) : uniq(existingCodes);
    applySelectOptions(selectEl, initial, { keepValue: true });

    // 后台更新（失败就静默忽略）
    const controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
    const signal = controller ? controller.signal : undefined;
    const timeoutId = global.setTimeout(() => {
      try {
        if (controller) controller.abort();
      } catch {
        // ignore
      }
    }, 6000);

    fetchSupportedCodes(signal)
      .then((codes) => {
        global.clearTimeout(timeoutId);
        setCachedCodes(codes);
        applySelectOptions(selectEl, uniq(codes.concat(existingCodes)), { keepValue: true });
      })
      .catch(() => {
        global.clearTimeout(timeoutId);
      });
  }

  global.SubTracker = global.SubTracker || {};
  global.SubTracker.currencies = {
    CACHE_KEY,
    USD_RATES_CACHE_KEY,
    API_URL,
    DEFAULT_LABELS,
    optionLabel,
    bootstrapCurrencyCodes,
    bootstrapCurrencySelect,
    ensureSelectHasOption,
    getCachedCodes,
    setCachedCodes,
    getCachedUsdRates,
    setCachedUsdRates,
    fetchUsdRates,
    fetchSupportedCodes,
    normalizeCode,
  };
})(window);
