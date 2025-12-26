(function (global) {
	  "use strict";

	  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  // Demo 支持的日期范围：2024 ~ 2030（含）
  const MIN_SUPPORTED_YEAR = 2024;
  const MAX_SUPPORTED_YEAR = 2030;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

	  // 以“天”为单位的整数时间轴（UTC），避免时区/DST 导致的日期偏移
	  function toDayNumberUTC(year, monthIndex, day) {
	    return Math.floor(Date.UTC(year, monthIndex, day) / MS_PER_DAY);
	  }

	  const MIN_SUPPORTED_DAY = toDayNumberUTC(MIN_SUPPORTED_YEAR, 0, 1);
	  const MAX_SUPPORTED_DAY = toDayNumberUTC(MAX_SUPPORTED_YEAR, 11, 31);

	  function getTodayDayNumber() {
	    const now = new Date();
	    return toDayNumberUTC(now.getFullYear(), now.getMonth(), now.getDate());
	  }

	  function isDayNumberWithinSupportedRange(dayNumber) {
	    const value = Number(dayNumber);
	    if (!Number.isFinite(value)) return false;
	    return value >= MIN_SUPPORTED_DAY && value <= MAX_SUPPORTED_DAY;
	  }

	  function clampDayNumberToSupportedRange(dayNumber) {
	    const value = Number(dayNumber);
	    if (!Number.isFinite(value)) return MIN_SUPPORTED_DAY;
	    return clamp(value, MIN_SUPPORTED_DAY, MAX_SUPPORTED_DAY);
	  }

  function parseISODateToDayNumber(isoDate) {
    if (typeof isoDate !== "string") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!match) return null;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return null;
    if (monthIndex < 0 || monthIndex > 11) return null;
    if (day < 1) return null;
    const maxDay = daysInMonthUTC(year, monthIndex);
    if (day > maxDay) return null;
    return toDayNumberUTC(year, monthIndex, day);
  }

  function dayNumberToUTCDate(dayNumber) {
    return new Date(dayNumber * MS_PER_DAY);
  }

  function dayNumberToParts(dayNumber) {
    const date = dayNumberToUTCDate(dayNumber);
    return {
      year: date.getUTCFullYear(),
      monthIndex: date.getUTCMonth(),
      day: date.getUTCDate(),
    };
  }

  function dayNumberToISODate(dayNumber) {
    const { year, monthIndex, day } = dayNumberToParts(dayNumber);
    return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
  }

  function daysInMonthUTC(year, monthIndex) {
    // 0 表示上个月最后一天
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  }

  // 按月增加，并把“日”裁剪到目标月份的最大天数（避免 31 号滚到下下月）
  function addMonthsClamped(parts, deltaMonths) {
    const totalMonths = parts.year * 12 + parts.monthIndex + deltaMonths;
    const year = Math.floor(totalMonths / 12);
    const monthIndex = totalMonths % 12;
    const maxDay = daysInMonthUTC(year, monthIndex);
    const day = Math.min(parts.day, maxDay);
    return { year, monthIndex, day };
  }

  function addYearsClamped(parts, deltaYears) {
    const year = parts.year + deltaYears;
    const maxDay = daysInMonthUTC(year, parts.monthIndex);
    const day = Math.min(parts.day, maxDay);
    return { year, monthIndex: parts.monthIndex, day };
  }

  function cycleLabel(cycle) {
    if (cycle === "weekly") return "每周";
    if (cycle === "monthly") return "月";
    if (cycle === "yearly") return "年";
    return cycle || "-";
  }

  function currencyLabel(code) {
    if (code === "CNY") return "CNY";
    if (code === "USD") return "USD";
    if (code === "EUR") return "EUR";
    if (code === "JPY") return "JPY";
    if (code === "GBP") return "GBP";
    return code || "-";
  }

  function formatMoney(amount, currency) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return "-";
    try {
      // 需求：展示价格时不显示货币单位（例如不显示“US$”）
      // 小数位“有用”才显示：最多两位小数，自动去掉尾随 0（仍保留 currency 参数以兼容旧调用）
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
    } catch {
      const fixed = value.toFixed(2);
      return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    }
  }

  function generateId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return `sub_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function monthLabel(monthIndex) {
    return `${monthIndex + 1}月`;
  }

	  global.SubTracker = global.SubTracker || {};
	  global.SubTracker.utils = {
	    MS_PER_DAY,
	    MIN_SUPPORTED_YEAR,
	    MAX_SUPPORTED_YEAR,
	    MIN_SUPPORTED_DAY,
	    MAX_SUPPORTED_DAY,
	    clamp,
	    toDayNumberUTC,
	    getTodayDayNumber,
	    isDayNumberWithinSupportedRange,
	    clampDayNumberToSupportedRange,
	    parseISODateToDayNumber,
	    dayNumberToUTCDate,
	    dayNumberToParts,
	    dayNumberToISODate,
	    daysInMonthUTC,
    addMonthsClamped,
    addYearsClamped,
    cycleLabel,
    currencyLabel,
    formatMoney,
    generateId,
    monthLabel,
  };
})(window);
