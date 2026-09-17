var CFG = __CONFIG__;
var HA = CFG.ha || {};
var form = document.getElementById('form');
var badgeList = document.getElementById('badges');

// --- Main settings controls ----------------------------------------
var themeSelect = form.querySelector('select[name=theme]');
if (themeSelect) themeSelect.value = CFG.theme || 'auto';
['weather', 'steps', 'date', 'battery', 'home'].forEach(function (key) {
  var el = form.querySelector('input[name=' + key + ']');
  if (el) el.checked = !!CFG[key];
});
// The home-temperature badge only exists when HA is connected AND a sensor
// is chosen (draft state). Its <li> is hidden until updateHomeBadge() shows
// it, and badgeItems() ignores hidden badges so a hidden home badge never
// leaks into the saved order.
var homeLi = badgeList.querySelector('li.badge[data-badge="home"]');
function badgeItems() {
  return Array.prototype.slice.call(badgeList.querySelectorAll('li.badge'))
    .filter(function (li) { return li.style.display !== 'none'; });
}
function refreshArrows() {
  var items = badgeItems();
  items.forEach(function (li, i) {
    li.querySelector('.up').disabled = i === 0;
    li.querySelector('.down').disabled = i === items.length - 1;
  });
}
(CFG.order || []).forEach(function (name) {
  var li = badgeList.querySelector('li.badge[data-badge="' + name + '"]');
  if (li) badgeList.appendChild(li);
});
refreshArrows();
badgeList.addEventListener('click', function (e) {
  var button = e.target;
  if (!button || button.tagName !== 'BUTTON') return;
  var li = button.parentNode.parentNode;
  if (button.className === 'up' && li.previousElementSibling) {
    badgeList.insertBefore(li, li.previousElementSibling);
  } else if (button.className === 'down' && li.nextElementSibling) {
    badgeList.insertBefore(li.nextElementSibling, li);
  }
  refreshArrows();
});

// Reveal/hide the home-temperature badge based on the current draft HA
// connection + sensor selection. Called on init and whenever either
// changes. Uses connectedDraft/selectedSensor which are declared (var,
// hoisted) in the HA section below and assigned before this ever runs.
function updateHomeBadge() {
  if (!homeLi) return;
  var avail = connectedDraft && selectedSensor && selectedSensor.length > 0;
  homeLi.style.display = avail ? '' : 'none';
  refreshArrows();
}

// --- View navigation (client-side; does NOT close the page) ---------
var viewMain = document.getElementById('view-main');
var viewHa = document.getElementById('view-ha');
function showView(name) {
  var ha = name === 'ha';
  viewHa.style.display = ha ? 'block' : 'none';
  viewMain.style.display = ha ? 'none' : 'block';
  window.scrollTo(0, 0);
}

// HA entry button; its label/dot are set by applyConnected() below to
// reflect the in-page draft connection state.
var entry = document.getElementById('ha-open');
var entryLabel = document.getElementById('ha-entry-label');
entry.addEventListener('click', function () { showView('ha'); });
document.getElementById('ha-back').addEventListener('click', function () { showView('main'); });
document.getElementById('ha-back-bottom').addEventListener('click', function () { showView('main'); });

// --- Home Assistant view -------------------------------------------
var connectedBox = document.getElementById('ha-connected');
var disconnectedBox = document.getElementById('ha-disconnected');
var selectedSensor = HA.selected || '';

// Entity picker: search box + selectable list showing name + area, like
// the Home Assistant frontend entity picker.
var pickerEl = document.getElementById('ha-picker');
var allSensors = [];
function matches(sensor, q) {
  q = (q || '').trim().toLowerCase();
  if (q === '') return true;
  return (sensor.name || '').toLowerCase().indexOf(q) >= 0 ||
         (sensor.area || '').toLowerCase().indexOf(q) >= 0 ||
         (sensor.entity_id || '').toLowerCase().indexOf(q) >= 0;
}
function renderPicker(query) {
  pickerEl.innerHTML = '';
  var rows = [];
  allSensors.forEach(function (s) { if (matches(s, query)) rows.push(s); });
  if (rows.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = (query || '').trim() !== ''
      ? 'No sensors match "' + query + '".'
      : 'No temperature sensors available.';
    pickerEl.appendChild(empty);
    return;
  }
  rows.forEach(function (s) {
    var item = document.createElement('div');
    item.className = 'picker-item' + (s.entity_id === selectedSensor ? ' selected' : '');
    item.setAttribute('data-id', s.entity_id);
    var meta = document.createElement('div');
    meta.className = 'meta';
    var name = document.createElement('div');
    name.className = 'name';
    name.textContent = s.name || s.entity_id;
    meta.appendChild(name);
    if (s.area) {
      var area = document.createElement('div');
      area.className = 'area';
      area.textContent = s.area;
      meta.appendChild(area);
    }
    var check = document.createElement('div');
    check.className = 'check';
    check.innerHTML = '&#10003;';
    item.appendChild(meta);
    item.appendChild(check);
    pickerEl.appendChild(item);
  });
}
function buildPicker(list) {
  allSensors = list || [];
  renderPicker('');
}

// Toggle between the "chosen sensor + Remove" view and the search/list.
// When a sensor is selected we hide the list entirely and just show it.
var selectedBox = document.getElementById('ha-selected');
var pickerWrap = document.getElementById('ha-picker-wrap');
function sensorById(id) {
  for (var i = 0; i < allSensors.length; i++) {
    if (allSensors[i].entity_id === id) return allSensors[i];
  }
  return null;
}
function applySensorSelection() {
  var chosen = selectedSensor && selectedSensor.length > 0;
  if (selectedBox) selectedBox.style.display = chosen ? 'block' : 'none';
  if (pickerWrap) pickerWrap.style.display = chosen ? 'none' : 'block';
  if (chosen) {
    var s = sensorById(selectedSensor);
    document.getElementById('ha-selected-name').textContent =
      (s && s.name) ? s.name : selectedSensor;
    var areaEl = document.getElementById('ha-selected-area');
    areaEl.textContent = (s && s.area) ? s.area : '';
    areaEl.style.display = (s && s.area) ? 'block' : 'none';
    var valEl = document.getElementById('ha-selected-value');
    var hasVal = s && s.state != null && s.state !== '' && s.state !== 'unknown' && s.state !== 'unavailable';
    valEl.textContent = hasVal ? ('Now: ' + s.state + (s.unit ? ' ' + s.unit : '')) : '';
    valEl.style.display = hasVal ? 'block' : 'none';
  }
  updateHomeBadge();
}

// One-time population of the connected view's URL, sensor count and
// picker. Visibility is handled by applyConnected() below.
if (HA.connected) {
  document.getElementById('ha-url-shown').textContent = HA.url || '';
  var n = (HA.list || []).length;
  document.getElementById('ha-sensors').textContent =
    n + (n === 1 ? ' temperature sensor available.' : ' temperature sensors available.');
  buildPicker(HA.list || []);
  applySensorSelection();
}

// connectedDraft is the in-page connection state. It only becomes the
// saved state when the user taps the main Save button — Disconnect (and a
// fresh login) just change this draft, exactly like the other settings
// are staged until Save.
var connectedDraft = !!HA.connected;
var pendingNote = document.getElementById('ha-pending-note');
var keepBtn = document.getElementById('ha-keep');
var unsavedNote = document.getElementById('ha-unsaved-note');
var urlInput = document.getElementById('ha-url');

function applyConnected(isConn, pendingDisconnect) {
  connectedBox.style.display = isConn ? 'block' : 'none';
  disconnectedBox.style.display = isConn ? 'none' : 'block';
  // "Not saved yet" hint in the connected view when the connection (e.g. a
  // just-completed login) hasn't been committed to the watch yet.
  if (unsavedNote) unsavedNote.style.display = (isConn && HA.unsaved) ? 'block' : 'none';
  // Pending-disconnect hint + undo in the disconnected view.
  if (pendingNote) pendingNote.style.display = pendingDisconnect ? 'block' : 'none';
  if (keepBtn) keepBtn.style.display = pendingDisconnect ? 'block' : 'none';
  // Keep the main-view entry button in sync with the draft state.
  entry.className = isConn ? 'ha-entry connected' : 'ha-entry';
  entryLabel.textContent = isConn ? 'Manage Home Assistant' : 'Connect Home Assistant';
  updateHomeBadge();
}
applyConnected(connectedDraft, false);

if (pickerEl) {
  pickerEl.addEventListener('click', function (e) {
    var item = e.target;
    while (item && item !== pickerEl && item.className.indexOf('picker-item') < 0) {
      item = item.parentNode;
    }
    if (!item || item === pickerEl) return;
    selectedSensor = item.getAttribute('data-id') || '';
    var items = pickerEl.querySelectorAll('.picker-item');
    for (var i = 0; i < items.length; i++) {
      items[i].className = 'picker-item' +
        (items[i].getAttribute('data-id') === selectedSensor ? ' selected' : '');
    }
    // Picking a real sensor collapses the list to the chosen-sensor view.
    applySensorSelection();
  });
  var search = document.getElementById('ha-search');
  if (search) {
    search.addEventListener('input', function () { renderPicker(search.value); });
  }
}

// Remove clears the selection and brings the search/list back.
var removeBtn = document.getElementById('ha-remove');
if (removeBtn) {
  removeBtn.addEventListener('click', function () {
    selectedSensor = '';
    renderPicker('');
    var search = document.getElementById('ha-search');
    if (search) search.value = '';
    applySensorSelection();
  });
}

// --- OAuth login (navigates away to HA, then closes via the callback) --
// This webview is sandboxed and cannot import src/pkjs/ha.ts, so the
// base64url + state format below MUST stay in sync with that module.
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function base64UrlEncode(str) {
  var enc = encodeURIComponent(str);
  var bytes = [];
  for (var i = 0; i < enc.length; i++) {
    if (enc.charAt(i) === '%') { bytes.push(parseInt(enc.substr(i + 1, 2), 16)); i += 2; }
    else { bytes.push(enc.charCodeAt(i)); }
  }
  var out = '';
  for (var j = 0; j < bytes.length; j += 3) {
    var b0 = bytes[j];
    var b1 = j + 1 < bytes.length ? bytes[j + 1] : 0;
    var b2 = j + 2 < bytes.length ? bytes[j + 2] : 0;
    out += B64.charAt(b0 >> 2);
    out += B64.charAt(((b0 & 3) << 4) | (b1 >> 4));
    out += j + 1 < bytes.length ? B64.charAt(((b1 & 15) << 2) | (b2 >> 6)) : '';
    out += j + 2 < bytes.length ? B64.charAt(b2 & 63) : '';
  }
  return out;
}
function normalizeHaUrl(input) {
  var url = (input || '').trim();
  if (url === '') return '';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url.replace(/\/+$/, '');
}
var loginBtn = document.getElementById('ha-login');
if (loginBtn) {
  loginBtn.addEventListener('click', function () {
    var haUrl = normalizeHaUrl(document.getElementById('ha-url').value);
    if (!haUrl) { alert('Please enter your Home Assistant URL.'); return; }
    var nonce = String(Math.floor(Math.random() * 1e9)) + '-' + String(Date.now());
    var state = base64UrlEncode(JSON.stringify({ u: haUrl, n: nonce }));
    var authorizeUrl = haUrl + '/auth/authorize?client_id=' +
      encodeURIComponent(HA.clientId) + '&redirect_uri=' +
      encodeURIComponent(HA.redirectUri) + '&response_type=code&state=' +
      encodeURIComponent(state);
    window.location.href = authorizeUrl;
  });
}
// Disconnect is deferred and shows the disconnected state right away: the
// page flips to the connect view (as if disconnected), but nothing is
// actually cleared until the user taps the main Save. "Keep connected"
// undoes it. This mirrors how connecting works too — a fresh login isn't
// committed to the watch until Save either (see pkjs: unsaved logins are
// discarded on the next open).
var disconnectBtn = document.getElementById('ha-disconnect');
if (disconnectBtn) {
  disconnectBtn.addEventListener('click', function () {
    connectedDraft = false;
    if (urlInput && !urlInput.value) urlInput.value = HA.url || '';
    applyConnected(false, true);
    window.scrollTo(0, 0);
  });
}
if (keepBtn) {
  keepBtn.addEventListener('click', function () {
    connectedDraft = true;
    applyConnected(true, false);
    window.scrollTo(0, 0);
  });
}

// --- Save (closes the page; the platform's only channel back to pkjs) --
// Only the main-view Save button submits the form. The HA subview has no
// Save of its own — its draft (connect/disconnect + selected sensor) is
// carried into this one payload and applied when the user saves Settings.
// pkjs (index.ts) receives the payload in webviewclosed, stores it, and
// sends it to the watch. haConnected commits/clears the HA connection.
form.addEventListener('submit', function (e) {
  e.preventDefault();
  // Ignore implicit submits (e.g. Enter in the HA URL/search fields) while
  // the HA subview is open, so typing never closes Settings unexpectedly.
  if (viewHa.style.display !== 'none') return;
  var payload = {
    theme: form.querySelector('select[name=theme]').value,
    weather: form.querySelector('input[name=weather]').checked,
    steps: form.querySelector('input[name=steps]').checked,
    date: form.querySelector('input[name=date]').checked,
    battery: form.querySelector('input[name=battery]').checked,
    home: form.querySelector('input[name=home]').checked,
    order: badgeItems().map(function (li) { return li.getAttribute('data-badge'); }),
    haConnected: connectedDraft,
    haSensor: selectedSensor
  };
  location.href = 'pebblejs://close#' + encodeURIComponent(JSON.stringify(payload));
});

// Open straight into the HA view when pkjs asks (e.g. right after connecting).
showView(CFG.view === 'ha' ? 'ha' : 'main');
