'use strict';

const topic = 'ixsuarez/flash-signal/v1';
const speedTopic = topic + '/speed';
const cycles = new Map([['slow', 900], ['standard', 600], ['fast', 450]]);
const shades = new Map([['soft', '#777777'], ['medium', '#bbbbbb'], ['bright', '#ffffff']]);
const relay = 'wss://broker.emqx.io:8084/mqtt';
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID();
const validCount = n => Number.isInteger(n) && n >= 1 && n <= 5;
const label = n => String.fromCharCode(64 + n);
const peers = new Map();
let role, client, session, previous, online, active, pending, wake;
let seen = new Set();

let speed = 'standard';
let previewRun, saving, saveTimer;
let syncNote = '';
try {
  const stored = localStorage.getItem('flash-intensity');
  if (shades.has(stored)) $('intensity').value = stored;
} catch { /* Storage may be unavailable in private browsing. */ }
function applyIntensity() {
  document.body.style.setProperty('--flash-color', shades.get($('intensity').value));
}
applyIntensity();
$('intensity').onchange = () => {
  applyIntensity();
  try { localStorage.setItem('flash-intensity', $('intensity').value); } catch {}
};

function renderSettings() {
  $('speed').disabled = !online || !!saving;
  $('speed').value = saving?.value || speed;
  $('sync').textContent = !online ? 'Relay unavailable · connecting…' :
    saving ? 'Updating shared speed…' : syncNote;
}
$('speed').onchange = () => {
  if (!online || !client?.connected) { renderSettings(); return; }
  saving = { value: $('speed').value, id: uid() };
  syncNote = '';
  renderSettings();
  // Confirm via the broker echo so a later writer always wins in delivery order.
  client.publish(speedTopic, JSON.stringify(saving), { retain:true, qos:0 });
  saveTimer = setTimeout(() => {
    saving = null;
    syncNote = 'Update unconfirmed. Check the speed and try again.';
    renderSettings();
  }, 5000);
};
function receiveSpeed(setting) {
  if (!cycles.has(setting?.value)) return;
  speed = setting.value;
  if (saving && saving.id === setting.id) {
    clearTimeout(saveTimer);
    saving = null;
  }
  syncNote = '';
  renderSettings();
}
async function pulses(surface, count, pace, current) {
  const cycle = cycles.get(pace) || cycles.get('standard');
  for (let i = 0; i < count; i++) {
    if (!current()) return;
    surface.classList.add('lit');
    await new Promise(resolve => setTimeout(resolve, cycle / 3));
    if (!current()) return;
    surface.classList.remove('lit');
    await new Promise(resolve => setTimeout(resolve, cycle * 2 / 3));
  }
}
function stopPreview() {
  if (!previewRun) return;
  previewRun = null;
  $('previewScreen').hidden = true;
  $('previewScreen').classList.remove('lit');
  document.querySelector('main').inert = false;
  $('preview').focus();
}
$('preview').onclick = async () => {
  const run = previewRun = uid();
  const surface = $('previewScreen');
  surface.hidden = false;
  document.querySelector('main').inert = true;
  surface.focus();
  await pulses(surface, 3, speed, () => previewRun === run);
  if (previewRun === run) stopPreview();
};
$('previewScreen').onclick = stopPreview;

for (let n = 1; n <= 5; n++) {
  const b = document.createElement('button');
  b.innerHTML = '<b>' + label(n) + '</b><small>' + n + (n === 1 ? ' flash' : ' flashes') + '</small>';
  b.onclick = () => send(n);
  $('keys').append(b);
}

function publish(type, fields = {}) {
  if (client?.connected && online) client.publish(topic, JSON.stringify({ type, ...fields }));
}

function presence() {
  publish('presence', { id: session, previous, count: active?.count || 0 });
}

function stopPlayback() {
  active = null;
  document.body.classList.remove('lit');
}

function endRequest(message) {
  pending = null;
  $('result').textContent = message;
}

function render() {
  renderSettings();
  const busy = [...peers.values()].find(p => p.count)?.count;
  const playing = busy || (pending?.started && pending.count);
  const ready = online && peers.size && !busy && !pending;
  for (const b of $('keys').children) b.disabled = !ready;
  $('status').textContent = !online ? 'Connecting to relay…' : playing ? 'Playing ' + label(playing) + '…' :
    pending ? 'Sending ' + label(pending.count) + '…' : peers.size ? 'Receiver ready' : 'Waiting for receiver…';
  $('listen').textContent = online ? 'Listening' : 'Connecting to relay…';
  const armed = role === 'receive' && online && !document.hidden;
  document.body.classList.toggle('armed', armed);
  $('receive').inert = armed;
}

function send(count) {
  if (!online || !peers.size || pending || [...peers.values()].some(p => p.count)) return;
  const targets = [...peers.keys()].sort();
  pending = { id: uid(), count, targets, remaining: new Set(targets), since: performance.now() };
  $('result').textContent = '';
  publish('request', { id: pending.id, count, targets, speed });
  render();
}

async function play(message) {
  if (active || seen.has(message.id) || document.hidden) return;
  seen.add(message.id);
  if (seen.size > 512) seen.delete(seen.values().next().value);
  active = message;
  presence();
  publish('started', { id: message.id, receiver: session });
  await pulses(document.body, message.count, message.speed || speed, () => active === message);
  if (active !== message) return;
  stopPlayback();
  publish('done', { id: message.id, receiver: session });
  presence();
}

function departed(id) {
  peers.delete(id);
  if (pending?.remaining.has(id)) endRequest('Delivery interrupted.');
}

function handle(m) {
  if (!m || typeof m !== 'object') return;
  if (role === 'receive') {
    if (m.type === 'hello') presence();
    if (!['request','play'].includes(m.type) || !Array.isArray(m.targets) ||
        !m.targets.includes(session) || !validCount(m.count) || typeof m.id !== 'string') return;
    if (m.type === 'request' && m.targets[0] === session) {
      if (active || seen.has(m.id)) { publish('busy', { id: m.id }); return; }
      if (!cycles.has(m.speed)) m.speed = speed;
      publish('play', { id: m.id, count: m.count, targets: m.targets, speed:m.speed });
      void play(m);
    } else if (m.type === 'play') void play(m);
    return;
  }
  if (m.type === 'presence' && typeof m.id === 'string' && (m.count === 0 || validCount(m.count))) {
    if (m.previous && m.previous !== m.id) departed(m.previous);
    peers.set(m.id, { count:m.count, at:performance.now() });
  } else if (m.type === 'bye') departed(m.id);
  else if (pending && m.id === pending.id) {
    if (m.type === 'busy') endRequest('Receiver busy. Tap again when ready.');
    else if (pending.remaining.has(m.receiver)) {
      if (m.type === 'started') pending.started = true;
      if (m.type === 'done') {
        pending.remaining.delete(m.receiver);
        if (!pending.remaining.size) endRequest(label(pending.count) + ' delivered');
      }
    }
  }
  render();
}

function resetConnection() {
  clearTimeout(saveTimer);
  saving = null;
  online = false;
  peers.clear();
  if (pending) endRequest('Delivery interrupted.');
  stopPlayback();
  render();
}

function disconnect() {
  if (role === 'receive') publish('bye', { id:session });
  const old = client;
  client = null;
  old?.end(false);
  resetConnection();
}

function connect() {
  if (!role || document.hidden || client) return;
  const c = mqtt.connect(relay, {
    clean:true, reconnectPeriod:2000, connectTimeout:10000, keepalive:12,
    queueQoSZero:false, resubscribe:false,
    transformWsUrl(url, options) {
      session = uid();
      if (role === 'receive') {
        try {
          previous = sessionStorage.getItem('last-receiver');
          sessionStorage.setItem('last-receiver', session);
        } catch { previous = null; }
        options.will = { topic, payload: JSON.stringify({ type:'bye', id:session }), qos:0, retain:false };
      }
      return url;
    }
  });
  client = c;
  c.on('connect', () => {
    const epoch = session;
    c.subscribe(role === 'settings' ? speedTopic : [speedTopic, topic], { qos:0 }, (error, grants) => {
      if (client !== c || session !== epoch || !c.connected || error || grants.some(grant => grant.qos === 128)) return;
      online = true;
      if (role === 'receive') presence(); else if (role === 'send') publish('hello');
      render();
    });
  });
  c.on('message', (channel, bytes, packet) => {
    if (client !== c || bytes.length > 16384) return;
    let payload;
    try { payload = JSON.parse(bytes.toString()); } catch { return; }
    if (channel === speedTopic) receiveSpeed(payload);
    else if (online && !packet.retain) handle(payload);
  });
  c.on('close', () => { if (client === c) resetConnection(); });
  c.on('error', () => { if (client === c) resetConnection(); });
}

async function keepAwake() {
  if (role !== 'receive' || wake || document.hidden) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (role !== 'receive' || document.hidden) { await lock.release(); return; }
    wake = lock;
    lock.addEventListener('release', () => { if (wake === lock) wake = null; });
  } catch { /* The receiver also works with the phone kept awake manually. */ }
}

function choose(next) {
  stopPreview();
  const leavingSettings = role === 'settings';
  disconnect();
  wake?.release();
  role = next;
  seen = new Set();
  for (const id of ['home','settings','send','receive']) $(id).hidden = id !== (role || 'home');
  if (leavingSettings && !next) $('gear').focus();
  if (next === 'settings') $('settings').querySelector('.back').focus();
  $('result').textContent = '';
  render();
  keepAwake();
  connect();
}
function select(next) {
  history.pushState(null, '', next ? '#' + next : location.pathname);
  choose(next);
}
$('gear').onclick = () => select('settings');
$('sender').onclick = () => select('send');
$('receiver').onclick = () => select('receive');
document.querySelectorAll('.back').forEach(b => b.onclick = () => select(null));
document.body.addEventListener('click', e => {
  if (role === 'receive' && online && !e.target.closest('button')) select(null);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (previewRun) stopPreview();
  else if (role) select(null);
});
const route = () => choose(['#settings','#send','#receive'].includes(location.hash) ? location.hash.slice(1) : null);
window.addEventListener('popstate', route);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopPreview(); disconnect(); } else { connect(); keepAwake(); }
});
window.addEventListener('pagehide', disconnect);
window.addEventListener('pageshow', connect);
setInterval(() => {
  if (!online || role === 'settings') return;
  if (role === 'receive') { presence(); return; }
  const now = performance.now();
  for (const [id,p] of peers) if (now - p.at > 5500) departed(id);
  if (pending && now - pending.since > 10000) endRequest('Delivery could not be confirmed.');
  render();
}, 1500);
route();
