(function (global) {
  "use strict";

  const utils = global.SubTracker?.utils;
  if (!utils) return;

  const PARTS = ["year", "month", "day"];
  const SCROLL_END_DELAY_MS = 140;
  const INPUT_COMMIT_DELAY_MS = 220;

  function clampInt(value, min, max) {
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }

  function numberFromCssVar(el, name, fallback) {
    if (!el) return fallback;
    const raw = global.getComputedStyle(el).getPropertyValue(name);
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function parseUserDateInputToISO(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;

    let year = null;
    let month = null;
    let day = null;

    // 支持：
    // - YYYY-MM-DD / YYYY-M-D / YYYY/MM/DD
    // - YYYYMMDD（纯数字，方便移动端数字键盘输入）
    const match = /^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/.exec(text) || /^(\d{4})(\d{2})(\d{2})$/.exec(text);
    if (!match) return null;

    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12) return null;
    const maxDay = utils.daysInMonthUTC(year, month - 1);
    if (day < 1 || day > maxDay) return null;

    const dayNumber = utils.toDayNumberUTC(year, month - 1, day);
    return utils.dayNumberToISODate(dayNumber);
  }

  function isCompleteDateInput(raw) {
    const text = String(raw || "").trim();
    if (!text) return false;
    if (/^\d{8}$/.test(text)) return true;
    if (/^\d{4}[\/.-]\d{2}[\/.-]\d{2}$/.test(text)) return true;
    return false;
  }

  // iPhone 闹钟风格的日期滚轴选择器（年/月/日三列）
	  class DateWheelPicker {
	    constructor(options) {
	      this.root = options.root;
	      this.input = options.input || this.root.querySelector('input[name="startDate"]');
	      this.onChange = typeof options.onChange === "function" ? options.onChange : null;
	      // 允许“可选日期”：输入框可为空（例如：结束日期可不填）
	      this.allowEmpty = options?.allowEmpty === true;

	      const wheelsWrap = this.root.querySelector(".date-wheel__wheels");
	      this.itemHeight = Number(options.itemHeight) || numberFromCssVar(wheelsWrap, "--wheel-item-height", 36);

      // 支持的日期范围：默认限制在 2024 ~ 2030（可通过 options 覆盖）
      const defaultMinYear = Number.isFinite(utils.MIN_SUPPORTED_YEAR) ? utils.MIN_SUPPORTED_YEAR : 2024;
      const defaultMaxYear = Number.isFinite(utils.MAX_SUPPORTED_YEAR) ? utils.MAX_SUPPORTED_YEAR : 2030;

	      this.minYear = Number.isFinite(options.minYear) ? options.minYear : defaultMinYear;
	      this.maxYear = Number.isFinite(options.maxYear) ? options.maxYear : defaultMaxYear;

	      this.wheels = {
	        year: this.root.querySelector('.wheel[data-part="year"]'),
	        month: this.root.querySelector('.wheel[data-part="month"]'),
	        day: this.root.querySelector('.wheel[data-part="day"]'),
	      };

      this.values = {
        year: [],
        month: [],
        day: [],
      };

	      const safeTodayDay =
	        typeof utils.clampDayNumberToSupportedRange === "function"
	          ? utils.clampDayNumberToSupportedRange(utils.getTodayDayNumber())
	          : utils.getTodayDayNumber();
	      const todayParts = utils.dayNumberToParts(safeTodayDay);

	      this.state = {
	        year: clampInt(todayParts.year, this.minYear, this.maxYear),
	        month: todayParts.monthIndex + 1, // 1-12
	        day: todayParts.day,
	      };

      this._selectedEls = { year: null, month: null, day: null };
      this._scrollRaf = { year: null, month: null, day: null };
      this._scrollEndTimers = { year: null, month: null, day: null };
      this._inputCommitTimer = null;
      // 用于“拖拽滚轴”后抑制一次 click（避免拖动结束误点某一项）
      this._suppressClickUntil = 0;

      this._buildStaticWheels();

      const rawInitial =
        options.initialISO || (this.input && typeof this.input.value === "string" ? this.input.value : "");
      const initialISO = String(rawInitial || "").trim();

      // allowEmpty：若初始值为空，则保持输入框为空，但滚轴仍停在“今天”（便于用户随时选取）
      if (this.allowEmpty && !initialISO) {
        if (this.input) this.input.value = "";
        this._scrollToValue("year", this.state.year, "auto");
        this._scrollToValue("month", this.state.month, "auto");
        this._scrollToValue("day", this.state.day, "auto");
        this._updateSelectedItem("year", this.state.year);
        this._updateSelectedItem("month", this.state.month);
        this._updateSelectedItem("day", this.state.day);
      } else {
        const fallbackISO = initialISO || utils.dayNumberToISODate(utils.getTodayDayNumber());
        this.setDateISO(fallbackISO, { behavior: "auto" });
      }
      this._bind();
    }

    getDateISO() {
      return this.input?.value || "";
    }

	    setDateISO(isoDate, options) {
	      const text = String(isoDate || "").trim();
	      if (!text) {
	        if (this.allowEmpty) {
	          if (this.input) this.input.value = "";
	          if (this.input) this.input.removeAttribute("aria-invalid");
	          if (this.onChange) this.onChange("", { ...this.state });
	        }
	        return;
	      }

	      const parsed = utils.parseISODateToDayNumber(text);
	      if (parsed == null) return;

	      const dayNumber =
	        typeof utils.clampDayNumberToSupportedRange === "function" ? utils.clampDayNumberToSupportedRange(parsed) : parsed;

	      const parts = utils.dayNumberToParts(dayNumber);
	      const year = parts.year;
	      const month = parts.monthIndex + 1;
	      const day = parts.day;

	      this.state.year = clampInt(year, this.minYear, this.maxYear);
	      this.state.month = clampInt(month, 1, 12);
	      this._syncDayWheelForCurrentMonth();
	      this.state.day = clampInt(day, 1, this.values.day.length || 31);

      const behavior = options?.behavior === "smooth" ? "smooth" : "auto";
      this._scrollToValue("year", this.state.year, behavior);
      this._scrollToValue("month", this.state.month, behavior);
      this._scrollToValue("day", this.state.day, behavior);

      this._updateInputAndUi();
    }

    _bind() {
      for (const part of PARTS) {
        const wheel = this.wheels[part];
        if (!wheel) continue;

        // 让滚轴可聚焦，便于键盘微调（按钮本身不参与 Tab 顺序）
        if (wheel.tabIndex < 0) wheel.tabIndex = 0;
        if (!wheel.hasAttribute("role")) wheel.setAttribute("role", "listbox");

        this._bindDragToScroll(part, wheel);

        wheel.addEventListener("scroll", () => {
          this._scheduleScrollUpdate(part);
          this._scheduleSnap(part);
        });

        // 键盘：上下键微调（更接近“滚轴”体验）
        wheel.addEventListener("keydown", (e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const delta = e.key === "ArrowUp" ? -1 : 1;
          this._step(part, delta);
        });
      }

      // 允许用户在日期显示框中直接输入日期（输入后滚轴同步跳转）
      if (this.input) {
        const scheduleCommit = () => {
          global.clearTimeout(this._inputCommitTimer);
          this._inputCommitTimer = global.setTimeout(() => {
            this._commitInputToWheels({ behavior: "auto", onlyIfComplete: true });
          }, INPUT_COMMIT_DELAY_MS);
        };

        this.input.addEventListener("input", scheduleCommit);
        this.input.addEventListener("change", () => this._commitInputToWheels({ behavior: "auto" }));
        this.input.addEventListener("blur", () => this._commitInputToWheels({ behavior: "auto", revertOnInvalid: true }));
        this.input.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          this._commitInputToWheels({ behavior: "auto", revertOnInvalid: true });
          try {
            this.input.blur();
          } catch {
            // ignore
          }
        });
      }
    }

    _commitInputToWheels(options) {
      if (!this.input) return;

      global.clearTimeout(this._inputCommitTimer);
      this._inputCommitTimer = null;

      const raw = String(this.input.value || "");
      if (this.allowEmpty && !raw.trim()) {
        this.input.value = "";
        this.input.removeAttribute("aria-invalid");
        if (this.onChange) this.onChange("", { ...this.state });
        return;
      }

      if (options?.onlyIfComplete && !isCompleteDateInput(raw)) return;

      const iso = parseUserDateInputToISO(raw);
      if (iso) {
        this.setDateISO(iso, { behavior: options?.behavior || "auto" });
        this.input.removeAttribute("aria-invalid");
        return;
      }

      if (options?.revertOnInvalid) {
        // allowEmpty：空值已在上方 return；此处只处理“非空但无效”的情况
        const dayNumber = utils.toDayNumberUTC(this.state.year, this.state.month - 1, this.state.day);
        this.input.value = utils.dayNumberToISODate(dayNumber);
        this.input.removeAttribute("aria-invalid");
      } else {
        this.input.setAttribute("aria-invalid", "true");
      }
    }

    _bindDragToScroll(part, wheel) {
      // 鼠标按住拖动滚轴即可滚动（更接近 iPhone 闹钟体验）
      let isPointerDown = false;
      let isDragging = false;
      let activePointerId = null;
      let startY = 0;
      let startScrollTop = 0;
      let restoreSnapRaf = null;

      const DRAG_THRESHOLD_PX = 3;

      const cancelRestoreSnap = () => {
        if (!restoreSnapRaf) return;
        global.cancelAnimationFrame(restoreSnapRaf);
        restoreSnapRaf = null;
      };

      const disableScrollSnapWhileDragging = () => {
        // 解决“鼠标拖动时像跳格子一样从上一项跳到下一项”的问题：
        // 滚动捕捉在部分浏览器下会对 programmatic scrollTop 生效得过于激进
        wheel.style.scrollSnapType = "none";
      };

      const restoreScrollSnapWhenSettled = (targetTop) => {
        cancelRestoreSnap();
        const start = global.performance?.now?.() || Date.now();
        const MAX_WAIT_MS = 900;

        const tick = () => {
          const now = global.performance?.now?.() || Date.now();
          const closeEnough = Math.abs(wheel.scrollTop - targetTop) < 0.5;
          const timedOut = now - start > MAX_WAIT_MS;
          if (closeEnough || timedOut) {
            wheel.style.scrollSnapType = "";
            restoreSnapRaf = null;
            return;
          }
          restoreSnapRaf = global.requestAnimationFrame(tick);
        };

        restoreSnapRaf = global.requestAnimationFrame(tick);
      };

      const endDrag = () => {
        if (!isPointerDown) return;
        const pointerIdToRelease = activePointerId;
        isPointerDown = false;
        activePointerId = null;
        wheel.classList.remove("is-dragging");

        if (isDragging) {
          this._suppressClickUntil = (global.performance?.now?.() || Date.now()) + 220;

          // 释放时做一次“平滑对齐”，让鼠标拖拽和滚轮滚动的体验一致
          const list = this.values[part];
          if (list && list.length) {
            const index = clampInt(Math.round(wheel.scrollTop / this.itemHeight), 0, list.length - 1);
            const targetTop = index * this.itemHeight;
            wheel.scrollTo({ top: targetTop, behavior: "smooth" });
            restoreScrollSnapWhenSettled(targetTop);
          } else {
            wheel.style.scrollSnapType = "";
          }
        }
        isDragging = false;

        try {
          if (pointerIdToRelease != null) wheel.releasePointerCapture(pointerIdToRelease);
        } catch {
          // ignore
        }
      };

      wheel.addEventListener("pointerdown", (e) => {
        // 仅处理鼠标左键拖动；触控设备默认原生滚动即可
        if (e.pointerType !== "mouse") return;
        if (e.button !== 0) return;

        cancelRestoreSnap();
        isPointerDown = true;
        isDragging = false;
        activePointerId = e.pointerId;
        startY = e.clientY;
        startScrollTop = wheel.scrollTop;
      });

      wheel.addEventListener(
        "pointermove",
        (e) => {
          if (!isPointerDown || activePointerId == null || e.pointerId !== activePointerId) return;
          const dy = e.clientY - startY;

          if (!isDragging) {
            if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
            isDragging = true;
            wheel.classList.add("is-dragging");
            disableScrollSnapWhileDragging();
            try {
              wheel.setPointerCapture(e.pointerId);
            } catch {
              // ignore
            }
          }

          wheel.scrollTop = startScrollTop - dy;
          e.preventDefault();
        },
        { passive: false }
      );

      wheel.addEventListener("pointerup", endDrag);
      wheel.addEventListener("pointercancel", endDrag);
      wheel.addEventListener("lostpointercapture", endDrag);
    }

    _shouldSuppressClick() {
      const now = global.performance?.now?.() || Date.now();
      return now < (this._suppressClickUntil || 0);
    }

    _scheduleScrollUpdate(part) {
      if (this._scrollRaf[part]) return;
      this._scrollRaf[part] = global.requestAnimationFrame(() => {
        this._scrollRaf[part] = null;
        this._applyFromScroll(part);
      });
    }

    _scheduleSnap(part) {
      const timer = this._scrollEndTimers[part];
      if (timer) global.clearTimeout(timer);
      this._scrollEndTimers[part] = global.setTimeout(() => {
        this._scrollEndTimers[part] = null;
        this._snap(part);
      }, SCROLL_END_DELAY_MS);
    }

    _applyFromScroll(part) {
      const wheel = this.wheels[part];
      const list = this.values[part];
      if (!wheel || !list || !list.length) return;

      const index = clampInt(Math.round(wheel.scrollTop / this.itemHeight), 0, list.length - 1);
      const value = list[index];
      this._setPartValue(part, value);
    }

    _snap(part) {
      const wheel = this.wheels[part];
      const list = this.values[part];
      if (!wheel || !list || !list.length) return;

      const index = clampInt(Math.round(wheel.scrollTop / this.itemHeight), 0, list.length - 1);
      const targetTop = index * this.itemHeight;
      if (Math.abs(wheel.scrollTop - targetTop) < 0.5) return;
      wheel.scrollTo({ top: targetTop, behavior: "smooth" });
    }

    _step(part, delta) {
      const list = this.values[part];
      if (!list || !list.length) return;
      const current = this.state[part];
      const idx = list.indexOf(current);
      const nextIndex = clampInt(idx + delta, 0, list.length - 1);
      const value = list[nextIndex];
      this._setPartValue(part, value);
      this._scrollToValue(part, value, "smooth");
    }

    _setPartValue(part, value) {
      const prev = this.state[part];
      if (prev === value) {
        this._updateSelectedItem(part, value);
        return;
      }

      this.state[part] = value;

      // 年/月改变时，需要同步“日”滚轴的天数范围
      if (part === "year" || part === "month") {
        const beforeDay = this.state.day;
        this._syncDayWheelForCurrentMonth();
        const maxDay = this.values.day.length || 31;
        this.state.day = clampInt(beforeDay, 1, maxDay);
        this._scrollToValue("day", this.state.day, "auto");
      }

      this._updateInputAndUi();
    }

    _updateInputAndUi() {
      this._updateSelectedItem("year", this.state.year);
      this._updateSelectedItem("month", this.state.month);
      this._updateSelectedItem("day", this.state.day);

      const dayNumber = utils.toDayNumberUTC(this.state.year, this.state.month - 1, this.state.day);
      const iso = utils.dayNumberToISODate(dayNumber);
      if (this.input) this.input.value = iso;

      if (this.onChange) this.onChange(iso, { ...this.state });
    }

    _updateSelectedItem(part, value) {
      const wheel = this.wheels[part];
      const list = this.values[part];
      if (!wheel || !list || !list.length) return;

      const idx = list.indexOf(value);
      if (idx < 0) return;
      const el = wheel.children[idx];
      const prevEl = this._selectedEls[part];

      if (prevEl && prevEl !== el) {
        prevEl.classList.remove("is-selected");
        prevEl.setAttribute("aria-selected", "false");
      }
      if (el) {
        el.classList.add("is-selected");
        el.setAttribute("aria-selected", "true");
      }
      this._selectedEls[part] = el;
    }

    _scrollToValue(part, value, behavior) {
      const wheel = this.wheels[part];
      const list = this.values[part];
      if (!wheel || !list || !list.length) return;

      const idx = list.indexOf(value);
      if (idx < 0) return;
      wheel.scrollTo({ top: idx * this.itemHeight, behavior: behavior === "smooth" ? "smooth" : "auto" });
    }

    _buildStaticWheels() {
      this._renderYearWheel();
      this._renderMonthWheel();
      this._syncDayWheelForCurrentMonth();
    }

    _renderYearWheel() {
      const years = [];
      const min = Math.min(this.minYear, this.maxYear);
      const max = Math.max(this.minYear, this.maxYear);
      for (let y = min; y <= max; y += 1) years.push(y);
      this.values.year = years;
      this._renderWheel("year", years, (y) => `${y}年`);
    }

    _renderMonthWheel() {
      const months = Array.from({ length: 12 }, (_, i) => i + 1);
      this.values.month = months;
      this._renderWheel("month", months, (m) => `${m}月`);
    }

    _syncDayWheelForCurrentMonth() {
      const daysInMonth = utils.daysInMonthUTC(this.state.year, this.state.month - 1);
      const needDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
      const current = this.values.day;

      if (current.length === needDays.length) {
        // 无需重建
        return;
      }

      this.values.day = needDays;
      this._renderWheel("day", needDays, (d) => `${d}日`);
    }

    _renderWheel(part, list, labelFn) {
      const wheel = this.wheels[part];
      if (!wheel) return;
      wheel.innerHTML = "";

      const frag = document.createDocumentFragment();
      for (const value of list) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "wheel-item";
        btn.tabIndex = -1;
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", "false");
        btn.dataset.value = String(value);
        btn.textContent = labelFn(value);
        btn.addEventListener("click", (e) => {
          if (this._shouldSuppressClick()) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          e.preventDefault();
          this._setPartValue(part, value);
          this._scrollToValue(part, value, "smooth");
        });
        frag.appendChild(btn);
      }
      wheel.appendChild(frag);
    }

	    _ensureYearRangeCovers(year) {
      // 固定年份范围：不允许自动扩展年份列表（避免突破 2024~2030 的限制）
	      const y = Number(year);
	      if (!Number.isFinite(y)) return;
	      if (y >= this.minYear && y <= this.maxYear) return;
	      // 超出范围：忽略
	    }
	  }

  global.SubTracker = global.SubTracker || {};
  global.SubTracker.DateWheelPicker = DateWheelPicker;
})(window);
