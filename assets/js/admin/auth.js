/* ============================================================================
   auth.js — the admin gate.

   HONEST LIMITATION: this is not access control. The SHA-256 hash below ships
   to the browser, admin.html is publicly fetchable, and anyone can set the
   localStorage flag in DevTools. It cannot be otherwise on a static site.

   What actually protects the site is that admin changes are LOCAL until the
   generated file is committed to the repo. A stranger who fakes admin can
   restyle their own browser and nothing else. Git is the access control.
============================================================================ */

// ---- ADMIN AUTH ----
    (function initAdmin() {
// Passphrase, not a word. The previous value was a single dictionary word and
// fell to a wordlist sweep in seconds — the hash ships to the browser, so the
// only thing standing between a stranger and a valid login is guessing cost.
const ADMIN_HASH = 'ae9ddf8fdf33be21af6b6d9a2d7f25f2ed27bb612dd5f7d074acc8a6e4aa5abf';
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