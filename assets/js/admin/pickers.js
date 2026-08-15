/* ============================================================================
   pickers.js — colour and line-width controls. ADMIN ONLY.

   Changes here write a localStorage DRAFT and re-render immediately. They do
   not affect any visitor until publish.js emits data/theme.js and it is
   committed. That is the entire admin/viewer contract.
============================================================================ */

    // Background color pickers
    const BG_COLORS_LIGHT = [
      { n:1,  hex:'#fafafa' },
      { n:2,  hex:'#f5f5f5' },
      { n:3,  hex:'#f0f0f0' },
      { n:4,  hex:'#ebebeb' },
      { n:5,  hex:'#e5e7eb' },
      { n:6,  hex:'#dde1e7' },
      { n:7,  hex:'#d4d4d4' },
      { n:8,  hex:'#f4f3ef' }, // default
      { n:9,  hex:'#f2efe9' },
      { n:10, hex:'#ede8df' },
      { n:11, hex:'#e8e0d4' },
      { n:12, hex:'#eef0f2' },
      { n:13, hex:'#e8eaed' },
      { n:14, hex:'#eceff1' },
      { n:15, hex:'#e3e8f0' },
      { n:16, hex:'#eef2ff' },
      { n:17, hex:'#f0f4f0' },
      { n:18, hex:'#f0f4f8' },
      { n:19, hex:'#f5f0ff' },
      { n:20, hex:'#fff8f0' },
    ];

    const BG_COLORS_DARK = [
      { n:1,  hex:'#1a1a1a' }, // near black
      { n:2,  hex:'#212121' }, // dark charcoal
      { n:3,  hex:'#2c2c2c' }, // charcoal
      { n:4,  hex:'#333333' }, // soft black
      { n:5,  hex:'#3a3a3a' }, // dark gray-black
      { n:6,  hex:'#1e2a3a' }, // dark navy
      { n:7,  hex:'#0f1b2d' }, // deep navy
      { n:8,  hex:'#0a192f' }, // rich navy (VS Code dark)
      { n:9,  hex:'#0d1b2e' }, // midnight navy
      { n:10, hex:'#162032' }, // blue-black
      { n:11, hex:'#1a2744' }, // dark royal blue
      { n:12, hex:'#1e3a5f' }, // dark blue
      { n:13, hex:'#1b3a6b' }, // royal blue dark
      { n:14, hex:'#0d2b55' }, // deep royal blue
      { n:15, hex:'#0a2342' }, // navy blue
      { n:16, hex:'#172554' }, // Tailwind blue-950
      { n:17, hex:'#1e1b4b' }, // deep indigo
      { n:18, hex:'#2e1065' }, // deep violet
      { n:19, hex:'#1c1235' }, // very dark purple
      { n:20, hex:'#0f0a1e' }, // near-black purple
    ];

    const DEFAULT_HEX = '#f4f3ef';
    const DEFAULT_LINE_HEX = '#9575c4';
    const allSwatches = [];

    const LINE_COLORS = [
      { n:1,  hex:'#ff6b00' }, // vivid orange
      { n:2,  hex:'#ff8c00' }, // dark orange
      { n:3,  hex:'#ffa500' }, // classic orange
      { n:4,  hex:'#ffb347' }, // soft orange
      { n:5,  hex:'#ff4500' }, // orange-red
      { n:6,  hex:'#ff7f00' }, // pure orange
      { n:7,  hex:'#ffd700' }, // gold
      { n:8,  hex:'#ffcc00' }, // vivid yellow
      { n:9,  hex:'#ffe033' }, // soft gold
      { n:10, hex:'#f5e642' }, // bright yellow
      { n:11, hex:'#ffe066' }, // warm yellow
      { n:12, hex:'#ffaa00' }, // amber
      { n:13, hex:'#ff9500' }, // iOS orange
      { n:14, hex:'#ffba08' }, // golden amber
      { n:15, hex:'#f4a261' }, // sandy orange
      { n:16, hex:'#fb923c' }, // Tailwind orange-400
      { n:17, hex:'#f97316' }, // Tailwind orange-500
      { n:18, hex:'#ea580c' }, // Tailwind orange-600
      { n:19, hex:'#ffef00' }, // pure yellow glow
      { n:20, hex:'#fff176' }, // soft yellow glow
    ];

    function buildPicker(containerId, colors, defaultHex) {
      const picker = document.getElementById(containerId);
      colors.forEach(({ n, hex }) => {
        const sw = document.createElement('div');
        sw.className = 'bg-swatch' + (hex === defaultHex ? ' active' : '');
        sw.style.background = hex;
        sw.title = `#${n}: ${hex}`;
        sw.innerHTML = `<span class="bg-swatch-num" style="color:${hex === defaultHex || n > 5 && containerId === 'bg-picker-dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)'}">${n}</span>`;
        sw.addEventListener('click', () => {
          allSwatches.forEach(s => s.classList.remove('active'));
          sw.classList.add('active');
          document.documentElement.style.setProperty('--bg', hex);
          FTAdminDraft.set('bg', hex);
        });
        picker.appendChild(sw);
        allSwatches.push(sw);
      });
    }

    buildPicker('bg-picker', BG_COLORS_LIGHT, DEFAULT_HEX);
    buildPicker('bg-picker-dark', BG_COLORS_DARK, DEFAULT_HEX);

    // Line width slider
    const lwSlider = document.getElementById('line-width-slider');
    const lwVal    = document.getElementById('line-width-val');
    lwSlider.addEventListener('input', () => {
      const w = parseFloat(lwSlider.value);
      window.activeLineWidth = w; FTAdminDraft.set('lineWidth', w);
      lwVal.textContent = w % 1 === 0 ? w : w.toFixed(2);
      d3.select('#links-layer').selectAll('.link-line')
        .style('stroke-width', d => d.onPath ? `${w * 1.6}px` : `${w}px`);
    });

    const linePicker = document.getElementById('line-picker');
    LINE_COLORS.forEach(({ n, hex }) => {
      const sw = document.createElement('div');
      sw.className = 'bg-swatch' + (hex === DEFAULT_LINE_HEX ? ' active' : '');
      sw.style.background = hex;
      sw.title = `#${n}: ${hex}`;
      sw.innerHTML = `<span class="bg-swatch-num" style="color:rgba(0,0,0,0.4)">${n}</span>`;
      sw.addEventListener('click', () => {
        allSwatches.forEach(s => s.classList.remove('active'));
        linePicker.querySelectorAll('.bg-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        window.activeLineColor = hex; FTAdminDraft.set('lineColor', hex);
        // re-stroke current lines immediately
        d3.select('#links-layer').selectAll('.link-line')
          .filter(d => !d.onPath)
          .attr('stroke', hex);
      });
      linePicker.appendChild(sw);
      allSwatches.push(sw);
    });

    // Node fill colors
    const NODE_COLORS = [
      { hex:'#ede8ff' }, // default — light purple
      { hex:'#dbeafe' }, // light blue
      { hex:'#dcfce7' }, // light green
      { hex:'#fef3c7' }, // light amber
      { hex:'#fee2e2' }, // light red
      { hex:'#fce7f3' }, // light pink
      { hex:'#ecfdf5' }, // mint
      { hex:'#fff7ed' }, // light orange
      { hex:'#f0f9ff' }, // sky blue
      { hex:'#f5f3ff' }, // light violet
      { hex:'#fdf4ff' }, // light fuchsia
      { hex:'#fff1f2' }, // light rose
      { hex:'#fefce8' }, // light yellow
      { hex:'#f8fafc' }, // blue-gray white
      { hex:'#fffbeb' }, // warm cream
      { hex:'#e0f2fe' }, // light cyan
      { hex:'#ede9fe' }, // lavender
      { hex:'#f1f5f9' }, // slate white
      { hex:'#fafaf9' }, // stone white
      { hex:'#f0f4f0' }, // soft sage
    ];

    // Font colors
    const FONT_COLORS = [
      { hex:'#5b21b6' }, // default — deep purple
      { hex:'#1a1a1a' }, // near black
      { hex:'#1e3a5f' }, // dark navy
      { hex:'#1f2937' }, // dark gray
      { hex:'#0f172a' }, // slate black
      { hex:'#7c3aed' }, // purple
      { hex:'#1d4ed8' }, // blue
      { hex:'#0f766e' }, // dark teal
      { hex:'#065f46' }, // dark green
      { hex:'#92400e' }, // dark amber
      { hex:'#991b1b' }, // dark red
      { hex:'#831843' }, // dark pink
      { hex:'#44403c' }, // warm brown
      { hex:'#0c4a6e' }, // dark sky
      { hex:'#4a044e' }, // dark fuchsia
      { hex:'#134e4a' }, // dark cyan
      { hex:'#172554' }, // dark indigo
      { hex:'#422006' }, // dark brown-orange
      { hex:'#3f3f46' }, // zinc dark
      { hex:'#ffffff' }, // white (for dark node bg)
    ];

    const DEFAULT_NODE_HEX = '#ede8ff';
    const DEFAULT_FONT_HEX = '#5b21b6';

    function buildBottomPicker(containerId, colors, defaultHex, onPick) {
      const container = document.getElementById(containerId);
      const swatches = [];
      colors.forEach(({ hex }) => {
        const sw = document.createElement('div');
        sw.className = 'bottom-swatch' + (hex === defaultHex ? ' active' : '');
        sw.style.background = hex;
        sw.title = hex;
        sw.addEventListener('click', () => {
          swatches.forEach(s => s.classList.remove('active'));
          sw.classList.add('active');
          onPick(hex);
        });
        container.appendChild(sw);
        swatches.push(sw);
      });
    }

    buildBottomPicker('node-color-picker', NODE_COLORS, DEFAULT_NODE_HEX, (hex) => {
      window.activeNodeColor = hex; FTAdminDraft.set('nodeFill', hex);
      d3.select('#nodes-layer').selectAll('.node-rect').attr('fill', hex);
    });

    buildBottomPicker('font-color-picker', FONT_COLORS, DEFAULT_FONT_HEX, (hex) => {
      window.activeFontColor = hex; FTAdminDraft.set('fontColor', hex);
      d3.select('#nodes-layer').selectAll('.node-text').style('fill', hex);
    });

    

    // ---- ADMIN AUTH ----
    (function initAdmin() {
      const ADMIN_HASH = '6586e04df7f9f23b0a765f3a81cb29241a563a1ddb278bf3f6fb45f70a6b80d9';
      const ADMIN_KEY = 'familyTreeAdmin';

      function applyAdminVisibility() {
        const isAdmin = localStorage.getItem(ADMIN_KEY) === 'true';
        document.body.classList.toggle('admin-mode', isAdmin);
        const trigger = document.getElementById('admin-trigger');
        if (trigger) trigger.textContent = isAdmin ? '[ADMIN: ON]' : '[ADMIN]';
      }

      async function hashPassword(password) {
        const data = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      }

      function showAdminModal() {
        document.getElementById('admin-modal-overlay').classList.add('visible');
        document.getElementById('admin-password').value = '';
        document.getElementById('admin-error').textContent = '';
        setTimeout(() => document.getElementById('admin-password').focus(), 300);
      }

      function hideAdminModal() {
        document.getElementById('admin-modal-overlay').classList.remove('visible');
      }

      async function attemptLogin() {
        const pw = document.getElementById('admin-password').value;
        if (!pw) return;
        const hash = await hashPassword(pw);
        if (hash === ADMIN_HASH) {
          localStorage.setItem(ADMIN_KEY, 'true');
          hideAdminModal();
          applyAdminVisibility();
        } else {
          document.getElementById('admin-error').textContent = '> ACCESS DENIED';
          document.getElementById('admin-password').value = '';
          document.getElementById('admin-password').focus();
        }
      }

      document.getElementById('admin-trigger').addEventListener('click', () => {
        if (localStorage.getItem(ADMIN_KEY) === 'true') {
          localStorage.removeItem(ADMIN_KEY);
          applyAdminVisibility();
        } else {
          showAdminModal();
        }
      });

      document.getElementById('admin-submit').addEventListener('click', attemptLogin);
      document.getElementById('admin-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); attemptLogin(); }
        if (e.key === 'Escape') hideAdminModal();
      });
      document.getElementById('admin-modal-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('admin-modal-overlay')) hideAdminModal();
      });

      applyAdminVisibility();
    })();
