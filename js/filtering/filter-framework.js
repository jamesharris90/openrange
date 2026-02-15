/*
 * Unified Filter Framework
 * - Centralized filter state with URL + localStorage persistence
 * - Reusable UI renderer with collapsible sections, sticky header, preset support
 * - Debounced updates for sliders/inputs
 * - Lightweight scoring engine with configurable weights per page
 */
(function (global) {
  const STORAGE_PREFIX = 'openrange:filters:';
  const DEBOUNCE_MS = 200;

  function deepMerge(target, source) {
    const output = { ...target };
    Object.entries(source || {}).forEach(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        output[k] = deepMerge(output[k] || {}, v);
      } else if (Array.isArray(v)) {
        output[k] = [...v];
      } else {
        output[k] = v;
      }
    });
    return output;
  }

  function debounce(fn, wait) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function readFromStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (e) {
      return null;
    }
  }

  function writeToStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Filter storage failed', e);
    }
  }

  function syncQueryParams(pageKey, values) {
    const params = new URLSearchParams(window.location.search);
    Object.entries(values).forEach(([key, val]) => {
      const qp = `${pageKey}_${key}`;
      if (val === null || val === undefined || val === '' || (Array.isArray(val) && !val.length)) {
        params.delete(qp);
      } else if (Array.isArray(val)) {
        params.set(qp, val.join(','));
      } else {
        params.set(qp, String(val));
      }
    });
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }

  function flattenSchemaFields(schema) {
    const map = {};
    if (!schema || !schema.sections) return map;
    Object.values(schema.sections).forEach((section) => {
      (section.fields || []).forEach((f) => {
        map[f.id] = f;
      });
    });
    return map;
  }

  function loadFromQueryParams(pageKey, schema) {
    const fieldMap = flattenSchemaFields(schema);
    const params = new URLSearchParams(window.location.search);
    const values = {};
    Object.keys(fieldMap).forEach((key) => {
      const qp = `${pageKey}_${key}`;
      if (!params.has(qp)) return;
      const type = fieldMap[key]?.type;
      const raw = params.get(qp);
      if (!raw) return;
      if (fieldMap[key]?.multiple) {
        values[key] = raw.split(',').map((v) => v.trim()).filter(Boolean);
      } else if (type === 'number' || type === 'range' || type === 'slider') {
        values[key] = Number(raw);
      } else if (type === 'boolean' || type === 'toggle') {
        values[key] = raw === 'true' || raw === '1';
      } else {
        values[key] = raw;
      }
    });
    return values;
  }

  class FilterState {
    constructor({ pageKey, schema, defaults = {}, weights = {}, onChange }) {
      this.pageKey = pageKey;
      this.schema = schema;
      this.subscribers = new Set();
      this.weights = { ...weights };

      const stored = readFromStorage(STORAGE_PREFIX + pageKey) || {};
      const fromQuery = loadFromQueryParams(pageKey, schema) || {};
      this.values = deepMerge(defaults, deepMerge(stored.values || {}, fromQuery));
      this.presets = stored.presets || {};
      this.activePreset = stored.activePreset || null;
      this.onChange = onChange;
      this.persist();
    }

    get(key) {
      return this.values[key];
    }

    set(key, value) {
      this.values[key] = value;
      this.activePreset = null; // custom state
      this.persist();
      this.notify();
    }

    bulkSet(obj = {}) {
      Object.entries(obj).forEach(([k, v]) => {
        this.values[k] = v;
      });
      this.activePreset = null;
      this.persist();
      this.notify();
    }

    reset(defaults) {
      this.values = deepMerge(defaults || {}, {});
      this.activePreset = null;
      this.persist();
      this.notify();
    }

    savePreset(name) {
      if (!name) return;
      this.presets[name] = { values: deepMerge(this.values, {}), weights: { ...this.weights } };
      this.activePreset = name;
      this.persist();
      this.notify();
    }

    loadPreset(name) {
      if (!name || !this.presets[name]) return;
      const preset = this.presets[name];
      this.values = deepMerge(this.values, preset.values || {});
      this.weights = deepMerge(this.weights, preset.weights || {});
      this.activePreset = name;
      this.persist();
      this.notify();
    }

    deletePreset(name) {
        if (!name || !this.presets[name]) return;
        delete this.presets[name];
        if (this.activePreset === name) {
          this.activePreset = null;
        }
        this.persist();
        this.notify();
    }

    setWeights(newWeights) {
      this.weights = deepMerge(this.weights, newWeights || {});
      this.persist();
      this.notify();
    }

    persist() {
      writeToStorage(STORAGE_PREFIX + this.pageKey, {
        values: this.values,
        presets: this.presets,
        activePreset: this.activePreset,
      });
      syncQueryParams(this.pageKey, this.values);
    }

    subscribe(fn) {
      this.subscribers.add(fn);
      return () => this.subscribers.delete(fn);
    }

    notify() {
      const snapshot = {
        values: { ...this.values },
        weights: { ...this.weights },
        activePreset: this.activePreset,
      };
      this.subscribers.forEach((fn) => fn(snapshot));
      if (typeof this.onChange === 'function') this.onChange(snapshot);
    }
  }

  class ScoringEngine {
    constructor(weightConfig = {}) {
      this.defaultWeights = {
        liquidity: 1,
        volatility: 1,
        structure: 1,
        catalyst: 1,
        squeeze: 1,
        ...weightConfig,
      };
    }

    compute(values, weights = {}) {
      const w = { ...this.defaultWeights, ...weights };
      const clamp = (v) => Math.max(0, Math.min(100, v));

      // Heuristic scoring based on filter strictness
      const liquidityScore = clamp(this.scoreRange(values, ['priceMin', 'priceMax', 'volumeMin', 'avgVolume', 'relVolMin', 'floatMax', 'marketCapMin'], 14));
      const volatilityScore = clamp(this.scoreRange(values, ['changeMin', 'premarketChangeMin', 'gapMin', 'atrPct', 'rangePct'], 12));
      const structureScore = clamp(this.scoreBooleans(values, ['aboveSMA20', 'aboveSMA50', 'aboveSMA200', 'insideDay', 'outsideDay', 'higherHigh', 'higherLow'], 6));
      const catalystScore = clamp(this.scoreMulti(values, ['newsFreshness', 'newsType', 'earningsTiming', 'guidance', 'sentimentScore'], 10));
      const squeezeScore = clamp(this.scoreRange(values, ['shortFloatPct', 'daysToCover', 'floatRotation', 'unusualOptions'], 8));

      const weighted = (name, score) => score * (w[name] ?? 1);
      const totalWeight = Object.values(w).reduce((a, b) => a + b, 0) || 1;
      const overall = clamp(
        (
          weighted('liquidity', liquidityScore) +
          weighted('volatility', volatilityScore) +
          weighted('structure', structureScore) +
          weighted('catalyst', catalystScore) +
          weighted('squeeze', squeezeScore)
        ) / totalWeight
      );

      return {
        liquidityScore,
        volatilityScore,
        structureScore,
        catalystScore,
        squeezeScore,
        overall,
      };
    }

    scoreRange(values, keys, base) {
      let score = 0;
      keys.forEach((k) => {
        const v = values[k];
        if (v !== null && v !== undefined && v !== '') score += base;
      });
      return score;
    }

    scoreBooleans(values, keys, base) {
      let score = 0;
      keys.forEach((k) => {
        if (values[k]) score += base;
      });
      return score;
    }

    scoreMulti(values, keys, base) {
      let score = 0;
      keys.forEach((k) => {
        const v = values[k];
        if (Array.isArray(v)) score += base * Math.min(v.length, 2);
        else if (v) score += base;
      });
      return score;
    }
  }

  function createElement(tag, className, children) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (Array.isArray(children)) {
      children.forEach((c) => c && el.appendChild(c));
    } else if (children) {
      el.appendChild(children);
    }
    return el;
  }

  function createLabel(text) {
    const label = document.createElement('div');
    label.className = 'filter-field-label';
    label.textContent = text;
    return label;
  }

  function createNumberInput(config, onChange) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = config.min ?? '';
    input.max = config.max ?? '';
    input.step = config.step ?? 'any';
    input.placeholder = config.placeholder || '';
    input.value = config.value ?? '';
    input.className = 'filter-input';
    input.addEventListener('input', debounce(() => {
      const val = input.value === '' ? null : Number(input.value);
      onChange(val);
    }, DEBOUNCE_MS));
    return input;
  }

  function createSlider(config, onChange) {
    const wrapper = createElement('div', 'filter-slider');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = config.min ?? 0;
    slider.max = config.max ?? 100;
    slider.step = config.step ?? 1;
    slider.value = config.value ?? slider.min;
    const valueLabel = createElement('div', 'filter-slider-value');
    const updateLabel = (v) => {
      valueLabel.textContent = config.format ? config.format(v) : v;
    };
    updateLabel(slider.value);
    slider.addEventListener('input', (e) => {
      updateLabel(e.target.value);
    });
    slider.addEventListener('change', debounce((e) => {
      const val = Number(e.target.value);
      updateLabel(val);
      onChange(val);
    }, DEBOUNCE_MS));
    wrapper.appendChild(slider);
    wrapper.appendChild(valueLabel);
    return wrapper;
  }

  function createSelect(config, onChange) {
    const select = document.createElement('select');
    select.className = 'filter-select';
    (config.options || []).forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      select.appendChild(o);
    });
    select.value = config.value ?? '';
    select.addEventListener('change', () => onChange(select.value || null));
    return select;
  }

  function createMultiSelect(config, onChange) {
    const wrapper = createElement('div', 'filter-multi');
    (config.options || []).forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      btn.dataset.value = opt.value;
      btn.className = 'filter-pill';
      const setState = () => {
        const active = (config.value || []).includes(opt.value);
        btn.classList.toggle('active', active);
      };
      btn.addEventListener('click', () => {
        const curr = new Set(config.value || []);
        if (curr.has(opt.value)) curr.delete(opt.value); else curr.add(opt.value);
        const next = Array.from(curr);
        config.value = next;
        setState();
        onChange(next);
      });
      setState();
      wrapper.appendChild(btn);
    });
    return wrapper;
  }

  function createToggle(config, onChange) {
    const wrapper = createElement('label', 'filter-toggle');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!config.value;
    input.addEventListener('change', () => onChange(input.checked));
    const span = createElement('span', 'toggle-slider');
    const text = createElement('span', 'toggle-label');
    text.textContent = config.label || '';
    wrapper.appendChild(input);
    wrapper.appendChild(span);
    wrapper.appendChild(text);
    return wrapper;
  }

  function buildField(field, state) {
    const currentVal = state.values[field.id];
    const container = createElement('div', 'filter-field');
    container.dataset.field = field.id;
    if (field.label) container.appendChild(createLabel(field.label));

    const onChange = (val) => state.set(field.id, val);

    switch (field.type) {
      case 'slider':
        container.appendChild(createSlider({ ...field, value: currentVal }, onChange));
        break;
      case 'number':
        container.appendChild(createNumberInput({ ...field, value: currentVal }, onChange));
        break;
      case 'select':
        container.appendChild(createSelect({ ...field, value: currentVal }, onChange));
        break;
      case 'multi':
        container.appendChild(createMultiSelect({ ...field, value: currentVal }, onChange));
        break;
      case 'toggle':
        container.appendChild(createToggle({ ...field, value: currentVal }, onChange));
        break;
      case 'text':
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = field.placeholder || '';
        input.value = currentVal || '';
        input.className = 'filter-input';
        input.addEventListener('input', debounce(() => onChange(input.value || null), DEBOUNCE_MS));
        container.appendChild(input);
        break;
      case 'date':
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.value = currentVal || '';
        dateInput.className = 'filter-input';
        dateInput.addEventListener('change', () => onChange(dateInput.value || null));
        container.appendChild(dateInput);
        break;
      default:
        break;
    }

    return container;
  }

  // buildSection no longer used in flattened layout

  function collectSectionFieldIds(sectionIds, schema) {
    const ids = [];
    (sectionIds || []).forEach((sid) => {
      const section = schema.sections?.[sid];
      if (!section) return;
      (section.fields || []).forEach((f) => ids.push(f.id));
    });
    return ids;
  }

  function buildScoringPanel(state, engine, container) {
    const panel = createElement('div', 'scoring-panel');
    const title = createElement('div', 'scoring-title');
    title.textContent = 'Scoring Engine';
    const scoreRows = createElement('div', 'scoring-rows');
    panel.appendChild(title);
    panel.appendChild(scoreRows);

    const weightControls = createElement('div', 'scoring-weights');
    const weightKeys = ['liquidity', 'volatility', 'structure', 'catalyst', 'squeeze'];
    weightKeys.forEach((key) => {
      const row = createElement('div', 'weight-row');
      const label = createElement('div', 'weight-label');
      label.textContent = `${key.charAt(0).toUpperCase() + key.slice(1)} weight`;
      const slider = createSlider({ min: 0, max: 3, step: 0.25, value: state.weights[key] ?? 1, format: (v) => `${v}x` }, (val) => {
        state.setWeights({ [key]: val });
      });
      row.appendChild(label);
      row.appendChild(slider);
      weightControls.appendChild(row);
    });
    panel.appendChild(weightControls);

    const renderScores = () => {
      const scores = engine.compute(state.values, state.weights);
      scoreRows.innerHTML = '';
      const renderRow = (label, value) => {
        const row = createElement('div', 'score-row');
        row.innerHTML = `<span>${label}</span><span>${Math.round(value)}%</span>`;
        scoreRows.appendChild(row);
      };
      renderRow('Overall Expansion Score', scores.overall);
      renderRow('Liquidity Quality', scores.liquidityScore);
      renderRow('Volatility Quality', scores.volatilityScore);
      renderRow('Structure Quality', scores.structureScore);
      renderRow('Catalyst Strength', scores.catalystScore);
      renderRow('Squeeze Potential', scores.squeezeScore);
    };

    state.subscribe(renderScores);
    renderScores();
    container.appendChild(panel);
  }

  function buildHeaderControls(options, state) {
    const header = createElement('div', 'filter-header');
    const left = createElement('div', 'filter-header-left');
    const right = createElement('div', 'filter-header-right');

    const title = createElement('div', 'filter-title');
    title.textContent = options.title || 'Filters';
    left.appendChild(title);

    const presetWrapper = createElement('div', 'preset-controls');
    const presetSelect = createSelect({
      options: [{ value: '', label: 'Load Preset' }].concat(Object.keys(state.presets || {}).map((p) => ({ value: p, label: p }))),
      value: state.activePreset || '',
    }, (val) => {
      if (val) state.loadPreset(val);
    });
    presetWrapper.appendChild(presetSelect);

    const refreshPresetOptions = () => {
      presetSelect.innerHTML = '';
      const opts = [{ value: '', label: 'Load Preset' }].concat(Object.keys(state.presets || {}).map((p) => ({ value: p, label: p })));
      opts.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        presetSelect.appendChild(o);
      });
      presetSelect.value = state.activePreset || '';
      updatePresetButtons();
    };

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn ghost';
    saveBtn.textContent = 'Save As';
    saveBtn.onclick = () => {
      const name = prompt('Preset name');
      if (name) state.savePreset(name.trim());
    };

    const updateBtn = document.createElement('button');
    updateBtn.className = 'btn ghost';
    updateBtn.textContent = 'Update';
    updateBtn.onclick = () => {
      if (!state.activePreset) {
        const name = prompt('Preset name');
        if (name) state.savePreset(name.trim());
      } else {
        state.savePreset(state.activePreset);
      }
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn ghost';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      if (!state.activePreset) return;
      const ok = confirm(`Delete preset "${state.activePreset}"?`);
      if (ok) state.deletePreset(state.activePreset);
    };

    const updatePresetButtons = () => {
      const hasActive = !!state.activePreset;
      updateBtn.disabled = false; // allow overwrite or save new
      deleteBtn.disabled = !hasActive;
    };

    state.subscribe(refreshPresetOptions);
    refreshPresetOptions();
    updatePresetButtons();

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn ghost';
    clearBtn.textContent = 'Clear';
    clearBtn.onclick = () => state.reset(options.defaults || {});

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn primary';
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = () => {
      if (typeof options.onApply === 'function') options.onApply({ ...state.values });
    };

    [presetWrapper, saveBtn, updateBtn, deleteBtn, clearBtn, applyBtn].forEach((a) => right.appendChild(a));

    header.appendChild(left);
    header.appendChild(right);
    return header;
  }

  function createFilterPanel(container, { pageKey, title, schema, defaults, weights, onApply, onChange, layout = 'vertical', scoringPlacement = 'panel' }) {
    const state = new FilterState({ pageKey, schema, defaults, weights, onChange });
    const engine = new ScoringEngine(weights);

    const panel = createElement('div', 'filter-panel');
    panel.appendChild(buildHeaderControls({ title, onApply, defaults }, state));

    const sectionsContainer = createElement('div', `filter-sections layout-${layout}`);
    Object.values(schema.sections || []).forEach((section) => {
      sectionsContainer.appendChild(buildSection(section, state));
    });

    if (scoringPlacement === 'inline') {
      const scoringShell = createElement('div', 'filter-section scoring-section');
      const scoringHeader = createElement('div', 'filter-section-header');
      scoringHeader.textContent = 'Scoring Engine';
      const scoringBody = createElement('div', 'filter-section-body scoring-body');
      scoringShell.appendChild(scoringHeader);
      scoringShell.appendChild(scoringBody);
      sectionsContainer.appendChild(scoringShell);
      buildScoringPanel(state, engine, scoringBody);
    } else {
      panel.appendChild(sectionsContainer);
      buildScoringPanel(state, engine, panel);
    }

    if (scoringPlacement === 'inline') {
      panel.appendChild(sectionsContainer);
    }

    container.innerHTML = '';
    container.appendChild(panel);

    // Initial apply to hydrate consumers
    if (typeof onApply === 'function') onApply({ ...state.values });

    return state;
  }

  function createTabbedFilterPanel(container, options) {
    const {
      pageKey,
      title,
      schema,
      defaults,
      weights,
      onApply,
      onChange,
      tabOrder = Object.keys(schema.sections || {}),
      tabSections = {},
      scoringPlacement = 'none',
      layoutConfig = {},
    } = options;

    const state = new FilterState({ pageKey, schema, defaults, weights, onChange });
    const engine = new ScoringEngine(weights);
    let activeTab = tabOrder[0];

    const panel = createElement('div', 'filter-panel filter-layout-shell');
    if (layoutConfig.maxWidth) {
      panel.style.maxWidth = `${layoutConfig.maxWidth}px`;
    }
    if (layoutConfig.columnsDesktop) {
      panel.style.setProperty('--filter-grid-columns', layoutConfig.columnsDesktop);
    }

    const header = createElement('div', 'filter-layout-header');
    const titleEl = createElement('div', 'filter-title');
    titleEl.textContent = title || 'Filters';
    header.appendChild(titleEl);
    panel.appendChild(header);

    const tabsBar = createElement('div', 'filter-tab-bar');
    const renderTabs = () => {
      tabsBar.innerHTML = '';
      tabOrder.forEach((tabId) => {
        const tabConfig = options.tabLabels?.[tabId] || { label: tabId };
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `filter-tab ${activeTab === tabId ? 'active' : ''}`;
        tab.textContent = tabConfig.label || tabId;
        tab.onclick = () => {
          if (activeTab === tabId) return;
          activeTab = tabId;
          renderTabs();
          renderSections();
        };
        tabsBar.appendChild(tab);
      });
    };
    renderTabs();
    panel.appendChild(tabsBar);

    const actionsRow = createElement('div', 'filter-action-row');

    const presetSelect = createSelect({
      options: [{ value: '', label: 'Load Preset' }].concat(Object.keys(state.presets || {}).map((p) => ({ value: p, label: p }))),
      value: state.activePreset || '',
    }, (val) => {
      if (val) state.loadPreset(val);
    });

    const refreshPresetOptions = () => {
      presetSelect.innerHTML = '';
      const opts = [{ value: '', label: 'Load Preset' }].concat(Object.keys(state.presets || {}).map((p) => ({ value: p, label: p })));
      opts.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        presetSelect.appendChild(o);
      });
      presetSelect.value = state.activePreset || '';
    };

    state.subscribe(refreshPresetOptions);

    const savePresetBtn = document.createElement('button');
    savePresetBtn.className = 'btn ghost';
    savePresetBtn.textContent = 'Save Preset';
    savePresetBtn.style.padding = '6px 10px';
    savePresetBtn.onclick = () => {
      const name = prompt('Preset name');
      if (name) state.savePreset(name.trim());
    };

    const clearTabBtn = document.createElement('button');
    clearTabBtn.className = 'btn ghost';
    clearTabBtn.textContent = 'Clear Tab';
    clearTabBtn.style.padding = '6px 10px';
    clearTabBtn.onclick = () => {
      const fields = collectSectionFieldIds(tabSections[activeTab] || [], schema);
      const resetVals = {};
      fields.forEach((fid) => {
        resetVals[fid] = defaults && Object.prototype.hasOwnProperty.call(defaults, fid) ? defaults[fid] : null;
      });
      state.bulkSet(resetVals);
    };

    const resetAllBtn = document.createElement('button');
    resetAllBtn.className = 'btn ghost';
    resetAllBtn.textContent = 'Reset All';
    resetAllBtn.style.padding = '6px 10px';
    resetAllBtn.onclick = () => state.reset(defaults || {});

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn primary';
    applyBtn.textContent = 'Apply Filters';
    applyBtn.style.padding = '7px 12px';
    applyBtn.onclick = () => {
      if (typeof onApply === 'function') onApply({ ...state.values });
    };

    [presetSelect, savePresetBtn, clearTabBtn, resetAllBtn, applyBtn].forEach((el) => actionsRow.appendChild(el));
    panel.appendChild(actionsRow);

    const sectionsContainer = createElement('div', 'filter-tab-sections');
    const scoringContainer = createElement('div', 'filter-scoring-shell');
    let scoringBuilt = false;

    const renderSections = () => {
      sectionsContainer.innerHTML = '';
      const sectionsForTab = tabSections[activeTab] || [];

      // Flatten sections into a single list of items (headers + fields)
      const flatItems = [];
      sectionsForTab.forEach((sectionId) => {
        const section = schema.sections?.[sectionId];
        if (!section) return;
        if (section.title) {
          const titleEl = document.createElement('div');
          titleEl.className = 'section-title';
          titleEl.textContent = section.title;
          flatItems.push(titleEl);
        }
        (section.fields || []).forEach((f) => {
          const fieldNode = buildField(f, state);
          flatItems.push(fieldNode);
        });
      });

      flatItems.forEach((node) => sectionsContainer.appendChild(node));

      if (scoringPlacement === 'inline') {
        if (!scoringBuilt) {
          scoringContainer.innerHTML = '';
          buildScoringPanel(state, engine, scoringContainer);
          scoringBuilt = true;
        }
        sectionsContainer.appendChild(scoringContainer);
      }
    };
    renderSections();

    panel.appendChild(sectionsContainer);

    if (scoringPlacement === 'panel') {
      buildScoringPanel(state, engine, panel);
    }

    container.innerHTML = '';
    container.appendChild(panel);

    if (typeof onApply === 'function') onApply({ ...state.values });

    return state;
  }

  global.FilterFramework = {
    createFilterPanel,
    createTabbedFilterPanel,
    FilterState,
    ScoringEngine,
  };
})(window);
