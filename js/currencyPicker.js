(function (global) {
  "use strict";

  // 自定义“货币单位”下拉（替代原生 <select>），并提供 A-Z 字母索引拖拽快速跳转
  // 设计目标：
  // 1) 跟页面整体风格一致（浅色、轻边框、阴影）
  // 2) 列表较长时，支持“投字母索引”（类似通讯录索引条）
  // 3) 与表单值同步：实际值写入 hidden input[name="currency"]

  const currencies = global.SubTracker?.currencies;

  const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  const EXCLUDED_CODES = new Set(["XAU", "XAG", "XDR", "XPD", "XPT", "XTS"]);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeCode(code) {
    if (currencies?.normalizeCode) return currencies.normalizeCode(code);
    return String(code || "")
      .trim()
      .toUpperCase();
  }

  function isIso4217Like(code) {
    return /^[A-Z]{3}$/.test(code);
  }

  function isExcluded(code) {
    const c = normalizeCode(code);
    return EXCLUDED_CODES.has(c);
  }

  function uniqSortedCodes(list) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
      const code = normalizeCode(item);
      if (!code) continue;
      if (!isIso4217Like(code)) continue;
      if (isExcluded(code)) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }

  function labelFor(code) {
    const c = normalizeCode(code);
    const labels = currencies?.DEFAULT_LABELS || {};
    return labels[c] || c || "-";
  }

  class CurrencyPicker {
    constructor(options) {
      this.root = options?.root;
      this.input = options?.input;
      this.onChange = typeof options?.onChange === "function" ? options.onChange : null;

      if (!this.root) throw new Error("CurrencyPicker: missing root");
      if (!this.input) throw new Error("CurrencyPicker: missing input");

      this.button = this.root.querySelector('[data-role="button"]');
      this.valueEl = this.root.querySelector('[data-role="value"]');
      this.menu = this.root.querySelector('[data-role="menu"]');
      this.list = this.root.querySelector('[data-role="list"]');
      this.index = this.root.querySelector('[data-role="index"]');
      this.hint = this.root.querySelector('[data-role="hint"]');

      this.codes = [];
      this._codeToItem = new Map();
      this._letterHeaders = [];
      this._letterToHeader = new Map();
      this._indexLetters = new Map();

      this._isOpen = false;
      this._isIndexDragging = false;
      this._activeLetter = null;
      this._hintTimer = null;

      this._bindEvents();

      // 初始显示与输入值同步
      this._syncButtonLabelFromInput();
    }

    getValue() {
      return normalizeCode(this.input.value);
    }

    setCodes(codes) {
      this.codes = uniqSortedCodes(codes);
      this._renderList();
      this._renderIndex();
      this._syncSelectionFromInput({ ensure: true });
    }

    setValue(code, options) {
      const normalized = normalizeCode(code);
      if (!normalized) return;

      const ensure = options?.ensure !== false;
      const silent = options?.silent === true;

      if (ensure && isIso4217Like(normalized) && !isExcluded(normalized) && !this.codes.includes(normalized)) {
        this.codes = uniqSortedCodes(this.codes.concat([normalized]));
        this._renderList();
        this._renderIndex();
      }

      this.input.value = normalized;
      this._syncButtonLabelFromInput();
      this._updateSelectedStyles(normalized);

      if (!silent) {
        try {
          this.input.dispatchEvent(new Event("input", { bubbles: true }));
          this.input.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {
          // ignore
        }
        if (this.onChange) this.onChange(normalized);
      }
    }

    open() {
      if (this._isOpen) return;
      this._isOpen = true;
      if (this.menu) this.menu.hidden = false;
      if (this.button) this.button.setAttribute("aria-expanded", "true");

      // 打开后，把当前选中项滚动到可视范围内
      global.requestAnimationFrame(() => {
        this._scrollSelectedIntoView();
        this._syncActiveLetterFromScroll();
      });
    }

    close() {
      if (!this._isOpen) return;
      this._isOpen = false;
      if (this.menu) this.menu.hidden = true;
      if (this.button) this.button.setAttribute("aria-expanded", "false");
      this._hideHint();
    }

    toggle() {
      if (this._isOpen) this.close();
      else this.open();
    }

    _bindEvents() {
      if (this.button) {
        this.button.addEventListener("click", () => {
          this.toggle();
        });

        this.button.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            this.close();
            return;
          }
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.open();
            if (this.list) this.list.focus?.();
          }
        });
      }

      // 点击外部关闭
      document.addEventListener("pointerdown", (e) => {
        if (!this._isOpen) return;
        if (this.root.contains(e.target)) return;
        this.close();
      });

      // 监听列表滚动：同步高亮索引字母
      if (this.list) {
        // 让 list 可聚焦（便于键盘关闭菜单）
        if (!this.list.hasAttribute("tabindex")) this.list.tabIndex = -1;

        this.list.addEventListener("scroll", () => {
          if (!this._isOpen) return;
          if (this._isIndexDragging) return;
          this._syncActiveLetterFromScroll();
        });

        this.list.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            this.close();
            this.button?.focus?.();
          }
        });
      }

      // 列表点击选择
      if (this.list) {
        this.list.addEventListener("click", (e) => {
          const btn = e.target?.closest?.("[data-code]");
          if (!btn) return;
          e.preventDefault();
          const code = btn.getAttribute("data-code");
          if (!code) return;
          this.setValue(code);
          this.close();
        });
      }

      // 字母索引（支持点击与拖拽）
      if (this.index) {
        this.index.addEventListener("pointerdown", (e) => {
          if (!this._isOpen) return;
          e.preventDefault();
          this._isIndexDragging = true;
          try {
            this.index.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          this._handleIndexPointer(e);
        });

        this.index.addEventListener("pointermove", (e) => {
          if (!this._isOpen) return;
          if (!this._isIndexDragging) return;
          e.preventDefault();
          this._handleIndexPointer(e);
        });

        const endDrag = (e) => {
          if (!this._isIndexDragging) return;
          e.preventDefault();
          this._isIndexDragging = false;
          try {
            this.index.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          this._hideHint({ delayMs: 220 });
        };

        this.index.addEventListener("pointerup", endDrag);
        this.index.addEventListener("pointercancel", endDrag);
      }
    }

    _syncButtonLabelFromInput() {
      if (!this.valueEl) return;
      const code = this.getValue() || "CNY";
      this.valueEl.textContent = labelFor(code);
    }

    _syncSelectionFromInput(options) {
      const code = this.getValue() || "CNY";
      if (options?.ensure) this.setValue(code, { ensure: true, silent: true });
      else this._updateSelectedStyles(code);
    }

    _updateSelectedStyles(selectedCode) {
      const normalized = normalizeCode(selectedCode);
      for (const [code, el] of this._codeToItem.entries()) {
        el.classList.toggle("is-selected", code === normalized);
        el.setAttribute("aria-selected", code === normalized ? "true" : "false");
      }
    }

    _renderList() {
      if (!this.list) return;
      this.list.innerHTML = "";
      this._codeToItem.clear();
      this._letterHeaders = [];
      this._letterToHeader.clear();

      const frag = document.createDocumentFragment();
      let currentLetter = null;
      let currentGroup = null;

      for (const code of this.codes) {
        const letter = code[0];
        if (letter !== currentLetter) {
          currentLetter = letter;
          // 用“分组容器 + 内部 sticky header”的结构，避免 position: sticky 影响 offsetTop，
          // 否则会出现“点了后面的字母后，再点前面的字母无反应”的跳转问题。
          const group = document.createElement("div");
          group.className = "currency-group";
          group.dataset.letter = letter;

          const header = document.createElement("div");
          header.className = "currency-group__header";
          header.textContent = letter;
          header.dataset.letter = letter;

          group.appendChild(header);
          frag.appendChild(group);

          currentGroup = group;
          this._letterHeaders.push({ letter, el: group });
          this._letterToHeader.set(letter, group);
        }

        const item = document.createElement("button");
        item.type = "button";
        item.className = "currency-item";
        item.dataset.code = code;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");

        const codeEl = document.createElement("span");
        codeEl.className = "currency-item__code";
        codeEl.textContent = code;

        const nameEl = document.createElement("span");
        nameEl.className = "currency-item__name";
        // 仅对少量常用货币给出中文名，其它只显示 code
        const fullLabel = labelFor(code);
        const nameMatch = new RegExp(`^${code}（(.+)）$`).exec(fullLabel);
        nameEl.textContent = nameMatch ? nameMatch[1] : "";

        item.appendChild(codeEl);
        item.appendChild(nameEl);
        if (currentGroup) currentGroup.appendChild(item);
        else frag.appendChild(item);
        this._codeToItem.set(code, item);
      }

      this.list.appendChild(frag);
    }

    _renderIndex() {
      if (!this.index) return;
      this.index.innerHTML = "";
      this._indexLetters.clear();

      const frag = document.createDocumentFragment();
      for (const letter of LETTERS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "alpha-letter";
        btn.textContent = letter;
        btn.dataset.letter = letter;
        btn.tabIndex = -1;
        btn.addEventListener("click", (e) => {
          if (!this._isOpen) return;
          e.preventDefault();
          this._scrollToLetter(letter);
          this._setActiveLetter(letter);
          this._showHint(letter);
          this._hideHint({ delayMs: 220 });
        });
        frag.appendChild(btn);
        this._indexLetters.set(letter, btn);
      }
      this.index.appendChild(frag);
    }

    _handleIndexPointer(e) {
      if (!this.index) return;
      const rect = this.index.getBoundingClientRect();
      const ratio = clamp((e.clientY - rect.top) / rect.height, 0, 0.999999);
      const idx = Math.floor(ratio * LETTERS.length);
      const letter = LETTERS[idx];
      this._scrollToLetter(letter);
      this._setActiveLetter(letter);
      this._showHint(letter);
    }

    _scrollToLetter(letter) {
      if (!this.list) return;
      const target = this._findNearestExistingLetter(letter);
      const headerEl = target ? this._letterToHeader.get(target) : null;
      if (!headerEl) return;
      this.list.scrollTop = headerEl.offsetTop;
    }

    _findNearestExistingLetter(letter) {
      const normalized = String(letter || "").toUpperCase();
      if (this._letterToHeader.has(normalized)) return normalized;

      const startIdx = LETTERS.indexOf(normalized);
      if (startIdx < 0) return null;

      // 找不到该字母，则向后找最近的组；若仍找不到，再向前找
      for (let i = startIdx + 1; i < LETTERS.length; i += 1) {
        const l = LETTERS[i];
        if (this._letterToHeader.has(l)) return l;
      }
      for (let i = startIdx - 1; i >= 0; i -= 1) {
        const l = LETTERS[i];
        if (this._letterToHeader.has(l)) return l;
      }
      return null;
    }

    _setActiveLetter(letter) {
      const normalized = String(letter || "").toUpperCase();
      if (this._activeLetter === normalized) return;

      if (this._activeLetter && this._indexLetters.has(this._activeLetter)) {
        this._indexLetters.get(this._activeLetter).classList.remove("is-active");
      }
      this._activeLetter = normalized;
      if (this._indexLetters.has(normalized)) this._indexLetters.get(normalized).classList.add("is-active");
    }

    _syncActiveLetterFromScroll() {
      if (!this.list) return;
      const scrollTop = this.list.scrollTop;
      let active = null;
      for (const { letter, el } of this._letterHeaders) {
        if (el.offsetTop <= scrollTop + 1) active = letter;
        else break;
      }
      if (active) this._setActiveLetter(active);
    }

    _scrollSelectedIntoView() {
      if (!this.list) return;
      const selected = this.getValue();
      const el = selected ? this._codeToItem.get(selected) : null;
      if (!el) return;
      try {
        el.scrollIntoView({ block: "nearest" });
      } catch {
        // ignore
      }
    }

    _showHint(letter) {
      if (!this.hint) return;
      global.clearTimeout(this._hintTimer);
      this.hint.textContent = String(letter || "").toUpperCase();
      this.hint.hidden = false;
    }

    _hideHint(options) {
      if (!this.hint) return;
      global.clearTimeout(this._hintTimer);
      const delayMs = Number(options?.delayMs || 0);
      if (!delayMs) {
        this.hint.hidden = true;
        return;
      }
      this._hintTimer = global.setTimeout(() => {
        this.hint.hidden = true;
      }, delayMs);
    }
  }

  global.SubTracker = global.SubTracker || {};
  global.SubTracker.CurrencyPicker = CurrencyPicker;
})(window);
