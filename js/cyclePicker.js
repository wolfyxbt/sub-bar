(function (global) {
  "use strict";

  // 自定义“订阅周期”下拉（替代原生 <select>），视觉风格与“货币单位”一致
  // 设计目标：
  // 1) 纯前端静态站可直接运行（无依赖）
  // 2) 与表单值同步：实际值写入 hidden input[name="cycle"]
  // 3) 适配编辑态“输入即生效”：会派发 input/change 事件

  const DEFAULT_OPTIONS = [
    { value: "monthly", label: "月度" },
    { value: "yearly", label: "年度" },
  ];

  function normalizeValue(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function isSeparator(opt) {
    return Boolean(opt && (opt.separator === true || opt.type === "separator"));
  }

  class CyclePicker {
    constructor(options) {
      this.root = options?.root;
      this.input = options?.input;
      this.onChange = typeof options?.onChange === "function" ? options.onChange : null;

      if (!this.root) throw new Error("CyclePicker: missing root");
      if (!this.input) throw new Error("CyclePicker: missing input");

      this.button = this.root.querySelector('[data-role="button"]');
      this.valueEl = this.root.querySelector('[data-role="value"]');
      this.menu = this.root.querySelector('[data-role="menu"]');
      this.list = this.root.querySelector('[data-role="list"]');

      const providedOptions = Array.isArray(options?.options) ? options.options : null;
      this.options = providedOptions && providedOptions.length ? providedOptions : DEFAULT_OPTIONS;

      this._valueToItem = new Map();
      this._isOpen = false;

      // 防止“页面一打开菜单就展开且关不掉”：强制初始关闭
      if (this.menu) this.menu.hidden = true;
      if (this.button) this.button.setAttribute("aria-expanded", "false");

      this._renderList();
      this._bindEvents();
      this._syncFromInput({ ensure: true });
    }

    getValue() {
      return normalizeValue(this.input.value);
    }

    setValue(value, options) {
      const normalized = normalizeValue(value);
      const ensure = options?.ensure !== false;
      const silent = options?.silent === true;

      const exists = this.options.some((opt) => !isSeparator(opt) && normalizeValue(opt.value) === normalized);
      const firstOption = this.options.find((opt) => !isSeparator(opt) && normalizeValue(opt.value));
      const fallback = normalizeValue(firstOption?.value);
      const next = exists ? normalized : fallback;
      if (!next) return;

      // 若不允许 ensure（严格模式），且传入值不合法，则直接忽略
      if (!ensure && !exists) return;

      this.input.value = next;
      this._syncButtonLabel(next);
      this._updateSelectedStyles(next);

      if (!silent) {
        try {
          this.input.dispatchEvent(new Event("input", { bubbles: true }));
          this.input.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {
          // ignore
        }
        if (this.onChange) this.onChange(next);
      }
    }

    open() {
      if (this._isOpen) return;
      this._isOpen = true;
      if (this.menu) this.menu.hidden = false;
      if (this.button) this.button.setAttribute("aria-expanded", "true");

      global.requestAnimationFrame(() => {
        this._focusSelectedItem();
      });
    }

    close() {
      if (!this._isOpen) return;
      this._isOpen = false;
      if (this.menu) this.menu.hidden = true;
      if (this.button) this.button.setAttribute("aria-expanded", "false");
    }

    toggle() {
      if (this._isOpen) this.close();
      else this.open();
    }

    _syncFromInput(options) {
      const firstOption = this.options.find((opt) => !isSeparator(opt) && normalizeValue(opt.value));
      const current = this.getValue() || normalizeValue(firstOption?.value);
      if (options?.ensure) this.setValue(current, { ensure: true, silent: true });
      else {
        this._syncButtonLabel(current);
        this._updateSelectedStyles(current);
      }
    }

    _labelFor(value) {
      const normalized = normalizeValue(value);
      for (const opt of this.options) {
        if (isSeparator(opt)) continue;
        if (normalizeValue(opt.value) === normalized) return opt.label || normalized || "-";
      }
      return normalized || "-";
    }

    _syncButtonLabel(value) {
      if (!this.valueEl) return;
      this.valueEl.textContent = this._labelFor(value);
    }

    _updateSelectedStyles(selectedValue) {
      const normalized = normalizeValue(selectedValue);
      for (const [value, el] of this._valueToItem.entries()) {
        const hit = value === normalized;
        el.classList.toggle("is-selected", hit);
        el.setAttribute("aria-selected", hit ? "true" : "false");
      }
    }

    _renderList() {
      if (!this.list) return;
      this.list.innerHTML = "";
      this._valueToItem.clear();

      const frag = document.createDocumentFragment();
      for (const opt of this.options) {
        if (isSeparator(opt)) {
          const divider = document.createElement("div");
          divider.className = "cycle-item cycle-item--divider";
          divider.setAttribute("role", "separator");
          frag.appendChild(divider);
          continue;
        }
        const value = normalizeValue(opt.value);
        if (!value) continue;

        const item = document.createElement("button");
        item.type = "button";
        item.className = "cycle-item";
        item.dataset.value = value;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        item.textContent = opt.label || value;
        frag.appendChild(item);
        this._valueToItem.set(value, item);
      }

      this.list.appendChild(frag);
    }

    _focusSelectedItem() {
      const current = this.getValue();
      const selected = current ? this._valueToItem.get(current) : null;
      const fallback = this._valueToItem.get(normalizeValue(this.options[0]?.value));
      const target = selected || fallback;
      if (!target) return;
      try {
        target.focus?.();
      } catch {
        // ignore
      }
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
          }
        });
      }

      // 点击外部关闭
      document.addEventListener("pointerdown", (e) => {
        if (!this._isOpen) return;
        if (this.root.contains(e.target)) return;
        this.close();
      });

      if (this.list) {
        this.list.addEventListener("click", (e) => {
          const btn = e.target?.closest?.("[data-value]");
          if (!btn) return;
          e.preventDefault();
          const value = btn.getAttribute("data-value");
          if (!value) return;
          this.setValue(value);
          this.close();
          this.button?.focus?.();
        });

        this.list.addEventListener("keydown", (e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          this.close();
          this.button?.focus?.();
        });
      }
    }
  }

  global.SubTracker = global.SubTracker || {};
  global.SubTracker.CyclePicker = CyclePicker;
})(window);
