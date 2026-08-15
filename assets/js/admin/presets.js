/* ============================================================================
   presets.js — named local drafts, kept in localStorage.

   Presets are a scratchpad for the admin, NOT site state. Applying one changes
   the draft; publishing is still a separate, deliberate step.
============================================================================ */

// ---- PRESETS ----
    const PRESETS_KEY = 'familyTreePresets';
    const presetSelect = document.getElementById('preset-select');

    function getPresets() {
      try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || {}; }
      catch { return {}; }
    }

    function savePresetsToStorage(presets) {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    }

    function loadPresets() {
      const presets = getPresets();
      // Remove all options except the first default one
      while (presetSelect.options.length > 1) presetSelect.remove(1);
      Object.keys(presets).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        presetSelect.appendChild(opt);
      });
    }

    function captureCurrentState() {
      return {
        bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        nodeColor: window.activeNodeColor || DEFAULT_NODE_HEX,
        fontColor: window.activeFontColor || DEFAULT_FONT_HEX,
        lineColor: window.activeLineColor || DEFAULT_LINE_HEX,
        lineWidth: window.activeLineWidth || parseFloat(lwSlider.value),
      };
    }

    function applyPreset(preset) {
      // 1. Background
      document.documentElement.style.setProperty('--bg', preset.bg);
      allSwatches.forEach(s => s.classList.remove('active'));
      // Highlight matching bg swatch if any
      allSwatches.forEach(s => {
        if (s.style.background && s.closest('#bg-picker, #bg-picker-dark')) {
          const rgb = s.style.background;
          // Create a temp element to convert hex to compare
          const tmp = document.createElement('div');
          tmp.style.background = preset.bg;
          document.body.appendChild(tmp);
          const target = getComputedStyle(tmp).backgroundColor;
          document.body.removeChild(tmp);
          if (getComputedStyle(s).backgroundColor === target) {
            s.classList.add('active');
          }
        }
      });

      // 2. Node color
      window.activeNodeColor = preset.nodeColor;
      d3.select('#nodes-layer').selectAll('.node-rect').attr('fill', preset.nodeColor);
      document.querySelectorAll('#node-color-picker .bottom-swatch').forEach(s => {
        s.classList.toggle('active', s.style.background === preset.nodeColor ||
          getComputedStyle(s).backgroundColor === hexToRgb(preset.nodeColor));
      });

      // 3. Font color
      window.activeFontColor = preset.fontColor;
      d3.select('#nodes-layer').selectAll('.node-text').style('fill', preset.fontColor);
      document.querySelectorAll('#font-color-picker .bottom-swatch').forEach(s => {
        s.classList.toggle('active', s.style.background === preset.fontColor ||
          getComputedStyle(s).backgroundColor === hexToRgb(preset.fontColor));
      });

      // 4. Line color
      window.activeLineColor = preset.lineColor;
      d3.select('#links-layer').selectAll('.link-line')
        .filter(d => !d.onPath)
        .attr('stroke', preset.lineColor);
      linePicker.querySelectorAll('.bg-swatch').forEach(s => {
        s.classList.remove('active');
        const tmp = document.createElement('div');
        tmp.style.background = preset.lineColor;
        document.body.appendChild(tmp);
        const target = getComputedStyle(tmp).backgroundColor;
        document.body.removeChild(tmp);
        if (getComputedStyle(s).backgroundColor === target) {
          s.classList.add('active');
        }
      });

      // 5. Line width
      window.activeLineWidth = preset.lineWidth;
      lwSlider.value = preset.lineWidth;
      lwVal.textContent = preset.lineWidth % 1 === 0 ? preset.lineWidth : preset.lineWidth.toFixed(2);
      d3.select('#links-layer').selectAll('.link-line')
        .style('stroke-width', d => d.onPath ? `${preset.lineWidth * 1.6}px` : `${preset.lineWidth}px`);
    }

    // Helper to convert hex to rgb() string for comparison
    function hexToRgb(hex) {
      const tmp = document.createElement('div');
      tmp.style.background = hex;
      document.body.appendChild(tmp);
      const rgb = getComputedStyle(tmp).backgroundColor;
      document.body.removeChild(tmp);
      return rgb;
    }

    // Wire up events
    presetSelect.addEventListener('change', () => {
      const name = presetSelect.value;
      if (!name) return;
      const presets = getPresets();
      if (presets[name]) applyPreset(presets[name]);
    });

    document.getElementById('preset-save').addEventListener('click', () => {
      const name = prompt('Preset name:');
      if (!name || !name.trim()) return;
      const presets = getPresets();
      presets[name.trim()] = captureCurrentState();
      savePresetsToStorage(presets);
      loadPresets();
      presetSelect.value = name.trim();
    });

    document.getElementById('preset-del').addEventListener('click', () => {
      const name = presetSelect.value;
      if (!name) return;
      if (!confirm(`Delete preset "${name}"?`)) return;
      const presets = getPresets();
      delete presets[name];
      savePresetsToStorage(presets);
      loadPresets();
      presetSelect.value = '';
    });

    // Populate presets on load
    loadPresets();
