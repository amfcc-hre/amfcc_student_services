(function () {
  "use strict";
  var api = window.AMFCCVehicles, state = { data: null, history: [], page: 1, total: 0, person: null, people: [], personIndex: -1, lookupSequence: 0, historySequence: 0, requestId: null, trip: null, action: null, healthy: false, refreshing: false, busy: false, toastTimer: null };
  var lookupTimer, historyTimer;
  function el(id) { return document.getElementById(id); }
  function value(id) { return String(el(id).value || "").trim(); }
  function esc(x) { return api.esc(x); }
  function notice(id, message) { el(id).textContent = message || ""; el(id).hidden = !message; }
  function toast(message) { el("vehicle-toast").textContent = message; el("vehicle-toast").hidden = false; clearTimeout(state.toastTimer); state.toastTimer = setTimeout(function () { el("vehicle-toast").hidden = true; }, 6500); }
  function token() { var s = api.session(); if (!s || !api.allowed(s)) throw new Error("Sign in to Transport, School Administration or the Administrators Office."); return s.session_token; }
  function call(name, args) { return api.rpc(name, Object.assign({ p_session_token: token() }, args || {})); }
  function canConfirm() { return !!(state.data && state.data.permissions.can_confirm); }
  function vehicle(id) { return (state.data && state.data.vehicles || []).find(function (v) { return v.id === id; }); }
  function vehicleForTrip(trip) { return vehicle(trip.vehicle_id) || { name: trip.vehicle_name || "Vehicle" }; }
  function tripById(id) { return (state.data && state.data.vehicles || []).map(function (v) { return v.current_trip; }).filter(Boolean).concat(state.history).find(function (t) { return t.id === id; }); }
  function harareParts(input) {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(input ? new Date(input) : new Date());
    var p = {}; parts.forEach(function (x) { p[x.type] = x.value; }); return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute };
  }
  function setDate(prefix, at) { var p = harareParts(at); el(prefix + "-date").value = p.date; el(prefix + "-time").value = p.time; }
  function datePayload(prefix) { return value(prefix + "-date") + "T" + value(prefix + "-time") + ":00+02:00"; }
  function showDialog(id) { if (state.busy) return; document.querySelectorAll("dialog[open]").forEach(function (d) { d.close(); }); el(id).showModal(); }
  function restrict(message) {
    state.healthy = false; state.data = null; state.history = [];
    document.querySelectorAll("dialog[open]").forEach(function (d) { d.close(); });
    el("vehicle-app").hidden = true; el("vehicle-refresh").hidden = true; el("vehicle-access").hidden = false;
    el("vehicle-access").innerHTML = '<h2>Sign in required</h2><p>' + esc(message || "Sign in to an authorised workspace to use vehicle checkout.") + '</p><a class="vehicle-button" href="' + esc(document.body.dataset.vehicleLogin || "index.html?returnTo=vehicles.html") + '">Sign in to your workspace</a>';
    el("vehicle-workspace").textContent = "Vehicle records are protected";
  }
  function renderFleet() {
    if (!state.data) return;
    el("vehicle-summary").innerHTML = api.summaryHtml(state.data.summary || {});
    el("vehicle-cards").innerHTML = state.data.vehicles.map(function (v) { return api.cardHtml(v, { page: true, canConfirm: canConfirm(), disabled: !state.healthy }); }).join("");
    el("vehicle-new").disabled = !state.healthy || !state.data.vehicles.some(function (v) { return v.status === "available"; });
    el("vehicle-updated").textContent = "Updated " + api.dateTime(state.data.server_time) + " · Harare time";
  }
  function renderHistory() {
    el("vehicle-history-rows").innerHTML = state.history.length ? state.history.map(function (t) {
      return '<tr><td><strong>' + esc(t.vehicle_name) + '</strong></td><td>' + esc(t.borrower_name) + '<small>' + esc(t.borrower_type === "staff" ? "Staff member" : "Student") + (t.borrower_number ? " · " + esc(t.borrower_number) : "") + '</small></td><td>' + esc(api.dateTime(t.checkout_at)) + '</td><td><span class="vehicle-status ' + esc(t.status) + '">' + esc(api.labels[t.status]) + '</span></td><td>' + esc(api.km(t.mileage_out)) + '</td><td>' + esc(api.km(t.mileage_in)) + '</td><td>' + esc(t.status === "cancelled" ? "Not applicable" : t.mileage_in == null ? "Pending return" : api.km(Number(t.mileage_in) - Number(t.mileage_out))) + '</td><td><button class="vehicle-button secondary" type="button" data-trip-details="' + esc(t.id) + '">Details</button></td></tr>';
    }).join("") : '<tr><td colspan="8">No journeys match this search.</td></tr>';
    el("vehicle-history-count").textContent = state.total ? "Page " + state.page + " of " + Math.ceil(state.total / 20) + " · " + state.total + " journey" + (state.total === 1 ? "" : "s") : "No journeys recorded";
    el("vehicle-prev").disabled = state.page <= 1; el("vehicle-next").disabled = state.page * 20 >= state.total;
  }
  async function loadHistory() {
    var seq = ++state.historySequence;
    try { var r = await call("ops_vehicle_history", { p_query: value("vehicle-history-search"), p_status: value("vehicle-history-status"), p_page: state.page }); if (seq !== state.historySequence) return; state.history = r.trips || []; state.total = r.total; renderHistory(); }
    catch (error) { if (seq !== state.historySequence) return; el("vehicle-history-rows").innerHTML = '<tr><td colspan="8">' + esc(error.message || "Journey history could not be loaded.") + '</td></tr>'; el("vehicle-history-count").textContent = "History could not be refreshed"; el("vehicle-prev").disabled = true; el("vehicle-next").disabled = true; }
  }
  async function refresh() {
    if (document.hidden) return;
    if (state.refreshing) { state.refreshRequested = true; return; }
    state.refreshing = true; el("vehicle-refresh").disabled = true;
    try {
      var currentToken = token();
      var r = await api.rpc("ops_vehicle_bootstrap", { p_session_token: currentToken });
      if (token() !== currentToken) return;
      state.data = r; state.healthy = true; el("vehicle-access").hidden = true; el("vehicle-app").hidden = false; el("vehicle-refresh").hidden = false;
      el("vehicle-workspace").textContent = r.permissions.display_name + (r.permissions.can_confirm ? " · Key confirmations enabled" : " · Administrator key confirmation required");
      notice("vehicle-page-error", ""); renderFleet(); await loadHistory();
    } catch (error) {
      state.healthy = false;
      if (error.code === "28000" || error.code === "42501" || !api.allowed(api.session())) restrict(error.message);
      else if (!state.data) { el("vehicle-access").hidden = false; el("vehicle-access").innerHTML = '<h2>Vehicle service unavailable</h2><p class="vehicle-error" role="alert">' + esc(error.message || "Could not connect to vehicle records.") + '</p><p>Check your connection and use Refresh to try again.</p>'; el("vehicle-refresh").hidden = false; }
      else { notice("vehicle-page-error", "Could not refresh availability. " + error.message + " Use Refresh before recording another action."); renderFleet(); }
    } finally { state.refreshing = false; el("vehicle-refresh").disabled = false; if (state.refreshRequested) { state.refreshRequested = false; refresh(); } }
  }
  function requireHealthy() { if (!state.healthy) throw new Error("Refresh the vehicle dashboard before recording an action."); }
  function updateMileage() {
    var v = vehicle(value("vehicle-select"));
    el("vehicle-mileage-out").min = v && v.last_mileage != null ? v.last_mileage : 0;
    el("vehicle-last-mileage").textContent = v && v.last_mileage != null ? "Last confirmed return mileage: " + api.km(v.last_mileage) : "No previous mileage has been recorded for this vehicle. Enter the current odometer reading.";
  }
  function closeResults() { el("vehicle-person-results").hidden = true; el("vehicle-person-search").setAttribute("aria-expanded", "false"); el("vehicle-person-search").removeAttribute("aria-activedescendant"); }
  function clearPerson() { state.person = null; state.people = []; state.personIndex = -1; state.lookupSequence++; clearTimeout(lookupTimer); el("vehicle-person-selected").hidden = true; closeResults(); }
  async function searchPeople() {
    var seq = ++state.lookupSequence;
    el("vehicle-person-results").hidden = false; el("vehicle-person-search").setAttribute("aria-expanded", "true"); el("vehicle-person-results").innerHTML = '<p class="vehicle-muted">Searching students and staff...</p>';
    try {
      var r = await call("ops_vehicle_people", { p_query: value("vehicle-person-search"), p_type: value("vehicle-person-type") });
      if (seq !== state.lookupSequence || !el("vehicle-checkout-dialog").open) return;
      state.people = r.people || []; state.personIndex = -1;
      el("vehicle-person-results").innerHTML = state.people.length ? state.people.map(function (p, i) { return '<button class="vehicle-option" type="button" id="vehicle-option-' + i + '" role="option" aria-selected="false" data-person-index="' + i + '">' + esc(p.full_name) + '<small>' + esc(p.person_type === "staff" ? "Staff member" : "Student") + (p.number ? " · " + esc(p.number) : "") + (p.person_type === "staff" && p.title ? " · " + esc(p.title) : "") + '</small></button>'; }).join("") : '<p class="vehicle-muted">No matching students or staff. Try a different name or number.</p>';
    } catch (error) { if (seq === state.lookupSequence) el("vehicle-person-results").innerHTML = '<p class="vehicle-error">' + esc(error.message) + '</p>'; }
  }
  function selectPerson(index) { var p = state.people[index]; if (!p) return; state.person = p; state.lookupSequence++; el("vehicle-person-search").value = p.full_name; el("vehicle-person-selected").textContent = p.full_name + " · " + (p.person_type === "staff" ? "Staff member" : "Student") + (p.number ? " · " + p.number : ""); el("vehicle-person-selected").hidden = false; closeResults(); el("vehicle-mileage-out").focus(); }
  function openCheckout(id) {
    requireHealthy(); var available = state.data.vehicles.filter(function (v) { return v.status === "available"; });
    if (!available.length) return toast("All vehicles are checked out or waiting for key confirmation.");
    el("vehicle-checkout-form").reset(); clearPerson(); state.requestId = crypto.randomUUID();
    el("vehicle-select").innerHTML = available.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>'; }).join("");
    if (available.some(function (v) { return v.id === id; })) el("vehicle-select").value = id;
    setDate("vehicle-out"); updateMileage(); notice("vehicle-checkout-error", ""); showDialog("vehicle-checkout-dialog");
  }
  function openReturn(trip) {
    requireHealthy(); if (!trip || ["checked_out", "pending_return"].indexOf(trip.status) < 0) return;
    state.trip = trip; el("vehicle-return-form").reset(); setDate("vehicle-in", trip.status === "pending_return" ? trip.returned_at : null);
    el("vehicle-mileage-in").min = trip.mileage_out; el("vehicle-mileage-in").value = trip.mileage_in == null ? "" : trip.mileage_in;
    el("vehicle-in-signature").placeholder = trip.borrower_name;
    el("vehicle-return-summary").textContent = vehicleForTrip(trip).name + " · " + trip.borrower_name + " · Outgoing mileage: " + api.km(trip.mileage_out);
    updateDistance(); notice("vehicle-return-error", ""); showDialog("vehicle-return-dialog");
  }
  function updateDistance() { var v = value("vehicle-mileage-in"); el("vehicle-distance").textContent = v && state.trip ? "Distance travelled: " + api.km(Number(v) - Number(state.trip.mileage_out)) : "Enter the return odometer reading."; }
  function detailItem(label, content, wide) { return '<div' + (wide ? ' class="wide"' : "") + '><dt>' + esc(label) + '</dt><dd>' + esc(content == null || content === "" ? "Not recorded" : content) + '</dd></div>'; }
  function confirmationName(name, role) { return name ? name + " · " + (role === "administrator" ? "School Administration" : "Administrators Office") : "Awaiting confirmation"; }
  function detailsHtml(t) {
    return '<span class="vehicle-status ' + esc(t.status) + '">' + esc(api.labels[t.status]) + '</span><dl class="vehicle-details">' +
      detailItem("Vehicle", vehicleForTrip(t).name) + detailItem("Person taking it out", t.borrower_name) +
      detailItem("Student or staff", t.borrower_type === "staff" ? "Staff member" : "Student") + detailItem("Registration / staff number", t.borrower_number) +
      detailItem("Checkout date and time", api.dateTime(t.checkout_at)) + detailItem("Mileage going out", api.km(t.mileage_out)) +
      detailItem("Description of journey", t.journey_description, true) + detailItem("Checkout signature", t.checkout_signature) + detailItem("Checkout signature recorded", api.dateTime(t.checkout_signed_at)) +
      detailItem("Key handover confirmed by", confirmationName(t.checkout_confirmed_by, t.checkout_confirmed_role)) + detailItem("Key handover confirmed at", api.dateTime(t.checkout_confirmed_at)) +
      detailItem("Return date and time", api.dateTime(t.returned_at)) + detailItem("Mileage coming back in", api.km(t.mileage_in)) +
      detailItem("Distance travelled", t.status === "cancelled" ? "No journey started" : t.mileage_in == null ? "Awaiting return" : api.km(Number(t.mileage_in) - Number(t.mileage_out))) + detailItem("Return signature", t.return_signature) +
      detailItem("Return signature recorded", api.dateTime(t.return_signed_at)) + detailItem("Keys received by", confirmationName(t.return_confirmed_by, t.return_confirmed_role)) + detailItem("Keys received and confirmed at", api.dateTime(t.return_confirmed_at)) +
      (t.status === "cancelled" ? detailItem("Cancelled by", t.cancelled_by) + detailItem("Cancelled at", api.dateTime(t.cancelled_at)) + detailItem("Cancellation reason", t.cancellation_reason, true) : "") + '</dl>';
  }
  function detailAction(action, text, danger) { return '<button class="vehicle-button' + (danger ? " danger" : "") + '" type="button" data-detail-action="' + action + '">' + esc(text) + '</button>'; }
  function openDetails(trip) {
    if (!trip) return toast("Refresh to load the latest journey record."); state.trip = trip;
    el("vehicle-details-content").innerHTML = detailsHtml(trip); var a = [];
    if (trip.status === "pending_checkout") { if (canConfirm()) a.push(detailAction("confirm_checkout", "Confirm key handover")); a.push(detailAction("cancel", "Cancel pending checkout", true)); }
    if (trip.status === "checked_out") a.push(detailAction("return", "Record return"));
    if (trip.status === "pending_return") { if (canConfirm()) a.push(detailAction("confirm_return", "Confirm keys received")); a.push(detailAction("return", "Correct return details")); }
    el("vehicle-details-actions").innerHTML = state.healthy ? a.join("") : ""; showDialog("vehicle-details-dialog");
  }
  function openConfirm(trip, action) {
    requireHealthy(); if (!canConfirm()) return toast("An administrator must confirm the keys from their own workspace."); if (!trip) return;
    state.trip = trip; state.action = action; el("vehicle-confirm-form").reset();
    var returning = action === "confirm_return";
    el("vehicle-confirm-heading").textContent = returning ? "Confirm keys received" : "Confirm key handover";
    el("vehicle-confirm-summary").innerHTML = '<p><strong>' + esc(vehicleForTrip(trip).name) + '</strong> · ' + esc(trip.borrower_name) + '</p><p>' + esc(trip.journey_description) + '</p><p>Mileage out: ' + esc(api.km(trip.mileage_out)) + (returning ? '<br>Mileage in: ' + esc(api.km(trip.mileage_in)) + '<br>Return time: ' + esc(api.dateTime(trip.returned_at)) : '<br>Checkout time: ' + esc(api.dateTime(trip.checkout_at))) + '</p>';
    el("vehicle-confirm-text").textContent = returning ? "I have received the keys from this borrower and checked the return details. This confirmation makes the vehicle available again." : "I have checked the journey details and handed the keys to this borrower. This confirmation marks the vehicle as checked out.";
    el("vehicle-confirm-submit").textContent = returning ? "Confirm keys received and make available" : "Confirm key handover and check out";
    try { el("vehicle-confirm-name").value = localStorage.getItem("amfcc_vehicle_confirming_name") || ""; } catch (_) {}
    notice("vehicle-confirm-error", ""); showDialog("vehicle-confirm-dialog");
  }
  function openCancel(trip) { requireHealthy(); if (!trip || trip.status !== "pending_checkout") return; state.trip = trip; el("vehicle-cancel-form").reset(); el("vehicle-cancel-summary").textContent = vehicleForTrip(trip).name + " · " + trip.borrower_name + ". This releases the vehicle without recording a departure."; notice("vehicle-cancel-error", ""); showDialog("vehicle-cancel-dialog"); }
  function routeAction(action, trip, vehicleId) { if (action === "checkout") openCheckout(vehicleId); else if (action === "return") openReturn(trip); else if (action === "confirm_checkout" || action === "confirm_return") openConfirm(trip, action); else if (action === "cancel") openCancel(trip); else openDetails(trip); }
  async function save(action, payload, dialogId, errorId) {
    if (state.busy) return; var d = el(dialogId), button = d.querySelector('button[type="submit"]'), label = button.textContent;
    state.busy = true; d.querySelectorAll("button,input,select,textarea").forEach(function (n) { n.disabled = true; }); button.textContent = "Saving..."; notice(errorId, "");
    try { var r = await call("ops_vehicle_command", { p_action: action, p_payload: payload }); d.close(); toast(r.message); await refresh(); }
    catch (error) { notice(errorId, error.message || "The vehicle record could not be saved. Try again."); if (error.code === "28000" || error.code === "42501") await refresh(); }
    finally { state.busy = false; d.querySelectorAll("button,input,select,textarea").forEach(function (n) { n.disabled = false; }); button.textContent = label; }
  }
  function existingPayload() { return { trip_id: state.trip.id, expected_revision: state.trip.revision }; }
  function bind() {
    document.querySelectorAll("[data-close-dialog]").forEach(function (b) { b.addEventListener("click", function () { if (!state.busy) b.closest("dialog").close(); }); });
    document.querySelectorAll("dialog").forEach(function (d) { d.addEventListener("cancel", function (e) { if (state.busy) e.preventDefault(); }); });
    el("vehicle-refresh").onclick = refresh;
    el("vehicle-new").onclick = function () { try { openCheckout(); } catch (e) { toast(e.message); } };
    el("vehicle-select").onchange = updateMileage;
    el("vehicle-cards").onclick = function (e) { var b = e.target.closest("[data-vehicle-action]"); if (!b) return; var v = vehicle(b.dataset.vehicleId); try { routeAction(b.dataset.vehicleAction, v && v.current_trip, v && v.id); } catch (error) { toast(error.message); } };
    el("vehicle-details-actions").onclick = function (e) { var b = e.target.closest("[data-detail-action]"); if (b) { try { routeAction(b.dataset.detailAction, state.trip); } catch (error) { toast(error.message); } } };
    el("vehicle-history-rows").onclick = function (e) { var b = e.target.closest("[data-trip-details]"); if (b) openDetails(tripById(b.dataset.tripDetails)); };
    el("vehicle-person-search").oninput = function () { clearPerson(); lookupTimer = setTimeout(searchPeople, 250); };
    el("vehicle-person-search").onfocus = function () { if (!state.person) searchPeople(); };
    el("vehicle-person-type").onchange = function () { el("vehicle-person-search").value = ""; clearPerson(); searchPeople(); };
    el("vehicle-person-results").onclick = function (e) { var b = e.target.closest("[data-person-index]"); if (b) selectPerson(Number(b.dataset.personIndex)); };
    el("vehicle-person-search").onkeydown = function (e) {
      if (e.key === "Escape") { closeResults(); return; }
      if (!state.people.length || el("vehicle-person-results").hidden) return;
      if (e.key === "Enter" && state.personIndex >= 0) { e.preventDefault(); selectPerson(state.personIndex); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault(); state.personIndex = (state.personIndex + (e.key === "ArrowDown" ? 1 : -1) + state.people.length) % state.people.length;
      el("vehicle-person-results").querySelectorAll("[role=option]").forEach(function (n, i) { n.classList.toggle("active", i === state.personIndex); n.setAttribute("aria-selected", i === state.personIndex ? "true" : "false"); });
      el("vehicle-person-search").setAttribute("aria-activedescendant", "vehicle-option-" + state.personIndex); el("vehicle-option-" + state.personIndex).scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("click", function (e) { if (!e.target.closest(".vehicle-picker")) closeResults(); });
    el("vehicle-mileage-in").oninput = updateDistance;
    el("vehicle-checkout-form").onsubmit = function (e) {
      e.preventDefault(); if (!state.person) return notice("vehicle-checkout-error", "Choose the borrower from the student or staff search results.");
      save("checkout", { request_id: state.requestId, vehicle_id: value("vehicle-select"), borrower_type: state.person.person_type, borrower_id: state.person.id, checkout_at: datePayload("vehicle-out"), mileage_out: value("vehicle-mileage-out"), journey_description: value("vehicle-journey"), signature: value("vehicle-out-signature"), signature_confirmed: el("vehicle-out-confirmation").checked }, "vehicle-checkout-dialog", "vehicle-checkout-error");
    };
    el("vehicle-return-form").onsubmit = function (e) { e.preventDefault(); save("submit_return", Object.assign(existingPayload(), { returned_at: datePayload("vehicle-in"), mileage_in: value("vehicle-mileage-in"), signature: value("vehicle-in-signature"), signature_confirmed: el("vehicle-in-confirmation").checked }), "vehicle-return-dialog", "vehicle-return-error"); };
    el("vehicle-confirm-form").onsubmit = function (e) { e.preventDefault(); var name = value("vehicle-confirm-name"); try { localStorage.setItem("amfcc_vehicle_confirming_name", name); } catch (_) {} save(state.action, Object.assign(existingPayload(), { actor_name: name, keys_confirmed: el("vehicle-confirm-check").checked }), "vehicle-confirm-dialog", "vehicle-confirm-error"); };
    el("vehicle-cancel-form").onsubmit = function (e) { e.preventDefault(); save("cancel_checkout", Object.assign(existingPayload(), { actor_name: value("vehicle-cancel-name"), reason: value("vehicle-cancel-reason") }), "vehicle-cancel-dialog", "vehicle-cancel-error"); };
    el("vehicle-history-search").oninput = function () { clearTimeout(historyTimer); state.page = 1; historyTimer = setTimeout(loadHistory, 250); };
    el("vehicle-history-status").onchange = function () { state.page = 1; loadHistory(); };
    el("vehicle-prev").onclick = function () { if (state.page > 1) { state.page--; loadHistory(); } };
    el("vehicle-next").onclick = function () { if (state.page * 20 < state.total) { state.page++; loadHistory(); } };
  }
  async function initialise() {
    if (!api) return restrict("The vehicle page could not load. Refresh and try again.");
    el("vehicle-back").href = document.body.dataset.vehicleBack || "index.html"; bind();
    if (!api.allowed(api.session())) return restrict();
    await refresh();
    if (state.healthy) { var params = new URLSearchParams(location.search), trip = tripById(params.get("trip")), id = params.get("vehicle"); if (trip) routeAction(params.get("action") || "details", trip); else if (id && vehicle(id) && vehicle(id).status === "available") openCheckout(id); }
    setInterval(function () { if (!document.hidden && !state.busy) refresh(); }, 30000);
    window.addEventListener("focus", function () { if (!state.busy) refresh(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && !state.busy) refresh(); });
  }
  document.addEventListener("DOMContentLoaded", initialise);
})();
