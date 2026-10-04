(function () {
  "use strict";
  var client = null, lastToken = null, inFlight = false, cached = null;
  var labels = { available: "Available", pending_checkout: "Awaiting key handover", checked_out: "Checked out", pending_return: "Awaiting return confirmation", returned: "Returned", cancelled: "Cancelled" };
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]; }); }
  function session() {
    var mode = document.body.dataset.vehicleSession || "operations";
    var keys = mode === "administration" ? ["amfcc_administration_session"] : mode === "school" ? ["amfcc_admin_control_session", "amfcc_administration_session"] : ["amfcc_ops_session"];
    for (var i = 0; i < keys.length; i++) {
      try { var item = JSON.parse(sessionStorage.getItem(keys[i]) || "null"); if (item && item.session_token) { if (item.expires_at && new Date(item.expires_at) <= new Date()) { sessionStorage.removeItem(keys[i]); continue; } return item; } } catch (_) { /* Ignore an invalid local session. The server verifies every token. */ }
    }
    return null;
  }
  function allowed(s) { return !!s && (s.role === "administrator" || s.role === "department" && s.department && ["transport", "administrators-office"].indexOf(s.department.slug) >= 0); }
  function getClient() {
    if (!client && window.APP_CONFIG && window.supabase) client = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!client) throw new Error("The vehicle service could not connect. Refresh the page.");
    return client;
  }
  async function rpc(name, args) {
    var result = await getClient().rpc(name, args || {});
    if (result.error) throw result.error;
    if (!result.data || result.data.status !== "success") throw new Error(result.data && result.data.message || "Vehicle records could not be loaded.");
    return result.data;
  }
  function dateTime(value) { if (!value) return "Not recorded"; var d = new Date(value); return isNaN(d) ? "Not recorded" : new Intl.DateTimeFormat("en-ZW", { timeZone: "Africa/Harare", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d); }
  function km(value) { return value == null ? "Not recorded" : Number(value).toLocaleString("en-ZW", { maximumFractionDigits: 1 }) + " km"; }
  function summaryHtml(s) { return [[s.available, "Available"], [s.checked_out, "Checked out"], [s.pending_checkout, "Awaiting key handover"], [s.pending_return, "Awaiting return confirmation"]].map(function (x) { return '<div class="vehicle-metric"><strong>' + esc(x[0] || 0) + '</strong><span>' + esc(x[1]) + '</span></div>'; }).join(""); }
  function actionHtml(action, text, vehicle, options) {
    var trip = vehicle.current_trip;
    if (options.page) return '<button type="button" class="vehicle-button' + (action === "details" ? " secondary" : "") + '" data-vehicle-action="' + action + '" data-vehicle-id="' + esc(vehicle.id) + '"' + (options.disabled ? " disabled" : "") + '>' + esc(text) + '</button>';
    var url = options.url || "vehicles.html";
    return '<a class="vehicle-button' + (action === "details" ? " secondary" : "") + '" href="' + esc(url + (trip ? "?trip=" + encodeURIComponent(trip.id) + "&action=" + encodeURIComponent(action) : "?vehicle=" + encodeURIComponent(vehicle.id))) + '">' + esc(text) + '</a>';
  }
  function cardHtml(vehicle, options) {
    var trip = vehicle.current_trip, actions = [], details;
    if (!trip) {
      details = '<p class="vehicle-muted">Last confirmed mileage: ' + esc(km(vehicle.last_mileage)) + '</p>';
      actions.push(actionHtml("checkout", "Check out", vehicle, options));
    } else {
      details = '<p><strong>' + esc(trip.borrower_name) + '</strong><br><span class="vehicle-muted">' + esc(trip.borrower_type === "staff" ? "Staff member" : "Student") + (trip.borrower_number ? " · " + esc(trip.borrower_number) : "") + '</span></p><p>' + esc(dateTime(trip.checkout_at)) + '</p><p>Mileage out: <strong>' + esc(km(trip.mileage_out)) + '</strong></p>';
      if (trip.status === "pending_return") details += '<p>Mileage in: <strong>' + esc(km(trip.mileage_in)) + '</strong></p>';
      if (trip.status === "pending_checkout" && options.canConfirm) actions.push(actionHtml("confirm_checkout", "Confirm key handover", vehicle, options));
      if (trip.status === "checked_out") actions.push(actionHtml("return", "Record return", vehicle, options));
      if (trip.status === "pending_return") {
        if (options.canConfirm) actions.push(actionHtml("confirm_return", "Confirm keys received", vehicle, options));
        else details += '<p class="vehicle-muted">Keys must be received and confirmed by an administrator.</p>';
      }
      actions.push(actionHtml("details", "View journey", vehicle, options));
    }
    return '<article class="vehicle-card ' + esc(vehicle.status) + '"><h3>' + esc(vehicle.name) + '</h3><span class="vehicle-status ' + esc(vehicle.status) + '">' + esc(labels[vehicle.status] || vehicle.status) + '</span>' + details + '<div class="vehicle-actions">' + actions.join("") + '</div></article>';
  }
  function render(node, data) {
    var url = node.dataset.vehicleUrl || "vehicles.html";
    node.innerHTML = '<div class="vehicle-heading"><div><h3>Vehicle checkout</h3><p>Vehicles available, out and waiting for key confirmation.</p></div><a class="vehicle-button secondary" href="' + esc(url) + '">Open vehicle checkout</a></div><div class="vehicle-metrics">' + summaryHtml(data.summary || {}) + '</div><div class="vehicle-grid">' + (data.vehicles || []).map(function (v) { return cardHtml(v, { url: url, canConfirm: !!data.permissions.can_confirm }); }).join("") + '</div><p class="vehicle-updated">Updated ' + esc(dateTime(data.server_time)) + ' · Harare time</p>';
  }
  function hosts() { return Array.from(document.querySelectorAll("[data-vehicle-dashboard]")); }
  function visibility(s) {
    var yes = allowed(s);
    document.querySelectorAll("[data-vehicle-link],[data-vehicle-dashboard]").forEach(function (n) { n.hidden = !yes; });
    return yes;
  }
  async function refresh() {
    var s = session(), nodes = hosts();
    if (!visibility(s) || !nodes.length || document.hidden) { if (!allowed(s)) { cached = null; lastToken = null; nodes.forEach(function (n) { n.replaceChildren(); }); } return; }
    var token = s.session_token;
    if (token !== lastToken) { cached = null; nodes.forEach(function (n) { n.innerHTML = '<p class="vehicle-muted">Loading vehicle availability...</p>'; }); }
    if (inFlight) return;
    inFlight = true; lastToken = token;
    try {
      var data = await rpc("ops_vehicle_bootstrap", { p_session_token: token });
      if (!session() || session().session_token !== token) return;
      cached = data; nodes.forEach(function (n) { render(n, data); });
    } catch (error) {
      cached = null;
      if (session() && session().session_token === token) nodes.forEach(function (n) { n.innerHTML = '<h3>Vehicle checkout</h3><p class="vehicle-error" role="alert">' + esc(error.message || "Could not refresh vehicle availability.") + '</p><button class="vehicle-button secondary" type="button" data-vehicle-retry>Try again</button>'; });
    } finally { inFlight = false; var current = session(); if (allowed(current) && current.session_token !== lastToken) refresh(); }
  }
  function sync() { var s = session(); if (!visibility(s)) { cached = null; lastToken = null; hosts().forEach(function (n) { n.replaceChildren(); }); } else if (s.session_token !== lastToken) refresh(); else if (cached) hosts().filter(function (n) { return !n.children.length; }).forEach(function (n) { render(n, cached); }); }
  function initialise() {
    if (!hosts().length) return;
    ["app-shell", "appShell", "login"].forEach(function (id) { var n = document.getElementById(id); if (n) new MutationObserver(sync).observe(n, { attributes: true, attributeFilter: ["hidden", "class"] }); });
    document.addEventListener("click", function (event) { if (event.target.closest("[data-vehicle-retry]")) refresh(); });
    window.addEventListener("amfcc-vehicle-session-changed", function () { lastToken = null; sync(); });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    setInterval(refresh, 30000); sync();
  }
  window.AMFCCVehicles = { session: session, allowed: allowed, rpc: rpc, esc: esc, dateTime: dateTime, km: km, labels: labels, summaryHtml: summaryHtml, cardHtml: cardHtml, refreshDashboard: refresh };
  document.addEventListener("DOMContentLoaded", initialise);
})();
