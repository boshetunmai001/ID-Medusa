export const demoHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Encvoy × Medusa</title>
<style>[hidden]{display:none!important}body{margin:0;background:#f4f5f7;color:#16213a;font:17px/1.6 system-ui}main{max-width:720px;margin:8vh auto;padding:32px}small{letter-spacing:.15em;text-transform:uppercase;color:#526176}h1{font-size:42px;line-height:1.1}section{background:white;padding:28px;border:1px solid #dce1e9;border-radius:16px;margin:24px 0}button,a.button{display:inline-block;border:0;border-radius:8px;background:#173ec4;color:white;padding:12px 18px;font:inherit;cursor:pointer;text-decoration:none}a{color:#173ec4}button:disabled{opacity:.5}#status{white-space:pre-line}.muted{color:#526176}dl{overflow-wrap:anywhere}dt{font-weight:600}dd{margin:0 0 12px}</style></head>
<body><main><small>Identity integration demo</small><h1>Encvoy ID × Medusa</h1><p class="muted">Sign in to your customer account using Encvoy ID.</p>
<section><h2 id="heading">Your account</h2><p id="status" role="status">Checking session…</p><p id="load-error" role="alert" hidden>The demo could not load. Check your connection and <a href="/demo">reload the page</a>.</p><dl id="profile" hidden></dl><button id="login" hidden>Continue with Encvoy ID</button> <button id="logout" hidden>Sign out of Medusa</button></section>
<noscript><p role="alert">JavaScript is required to sign in and view your account. Enable JavaScript and reload this page.</p></noscript>
<p><a href="/demo/profile">Protected profile</a> · <a href="/app/login">Staff sign-in</a></p><p class="muted">Signing out here ends the Medusa session. Your Encvoy session may remain active.</p></main>
<script src="/demo/script" onerror="document.getElementById('status').textContent='';document.getElementById('load-error').hidden=false"></script></body></html>`;

export const demoScript = `"use strict";
const status = document.getElementById('status');
const login = document.getElementById('login');
const logout = document.getElementById('logout');
const profile = document.getElementById('profile');
const callback = new URLSearchParams(location.search);
const wasCallback = location.pathname === '/demo/callback';
if (wasCallback) history.replaceState(null, '', '/demo/callback');
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000), ...options, headers: { 'content-type':'application/json', ...options.headers } });
  const body = await response.text();
  const data = body ? JSON.parse(body) : {};
  if (!response.ok) { const error = new Error(data.message || 'Request failed'); error.status = response.status; throw error; }
  return data;
}
function showError(error) {
  const value = error instanceof Error ? error.message : 'Authentication failed';
  status.textContent = value.includes('account_conflict') ? 'An account already uses this email. Contact the store administrator to verify ownership. No accounts were linked.' : value.includes('cancel') || value.includes('access_denied') ? 'Sign-in was cancelled. You can try again.' : value.includes('provider_unavailable') ? 'Encvoy ID is unavailable. Please try again later.' : 'Sign-in failed or expired. Please start again.';
  login.hidden = false; logout.hidden = true; profile.hidden = true;
}
async function showProfile() {
  try {
    const { customer } = await api('/encvoy/profile');
    status.textContent = 'You are signed in as a customer.';
    profile.replaceChildren();
    for (const [label, value] of [['Customer ID', customer.id], ['Email', customer.email], ['Name', [customer.first_name, customer.last_name].filter(Boolean).join(' ')]]) {
      const term = document.createElement('dt'); term.textContent = label;
      const definition = document.createElement('dd'); definition.textContent = value || '—';
      profile.append(term, definition);
    }
    profile.hidden = false; login.hidden = true; logout.hidden = false;
    return 'signed-in';
  } catch (error) {
    const signedOut = error && error.status === 401;
    status.textContent = signedOut
      ? 'You are signed out. Sign in to view your account.'
      : 'We could not load your account. Check your connection and try again.';
    login.hidden = false; logout.hidden = true; profile.hidden = true;
    return signedOut ? 'signed-out' : 'unavailable';
  }
}
login.onclick = async () => {
  login.disabled = true;
  try { const result = await api('/auth/customer/encvoy-customer', { method:'POST', body:'{}' }); location.assign(result.location); }
  catch (error) { showError(error); login.disabled = false; }
};
logout.onclick = async () => {
  logout.disabled = true;
  try { await api('/auth/session', { method:'DELETE' }); await showProfile(); }
  catch {
    const sessionState = await showProfile();
    if (sessionState === 'signed-in') status.textContent = 'Could not end the session. Please retry.';
    if (sessionState === 'unavailable') status.textContent = 'We could not confirm whether you are signed out. Check your connection and reload the page.';
  }
  finally { logout.disabled = false; }
};
(async () => {
  if (!wasCallback) return showProfile();
  try {
    const payload = {};
    for (const key of ['code','state','iss','error']) {
      if (callback.getAll(key).length > 1) throw new Error('Invalid callback');
      if (callback.has(key)) payload[key] = callback.get(key);
    }
    const result = await api('/auth/customer/encvoy-customer/callback', { method:'POST', body:JSON.stringify(payload) });
    if (typeof result.token !== 'string' || result.mfa_required || result.verification_required) throw new Error('Additional authentication required');
    await api('/encvoy/customer/complete', { method:'POST', body:'{}', headers:{ authorization:'Bearer ' + result.token } });
    await api('/auth/session', { method:'POST', body:'{}', headers:{ authorization:'Bearer ' + result.token } });
    location.replace('/demo/profile');
  } catch (error) { showError(error); }
})();`;
