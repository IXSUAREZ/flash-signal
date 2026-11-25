'use strict';

const topic = 'ixsuarez/flash-signal/v1';
const relay = 'wss://broker.emqx.io:8084/mqtt';
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID();
const validCount = n => Number.isInteger(n) && n >= 1 && n <= 5;
const label = n => String.fromCharCode(64 + n);
const peers = new Map();
let role, client, session, online, active, pending, wake;
let seen = new Set();

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
  publish('presence', { id: session, count: active?.count || 0 });
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
  publish('request', { id: pending.id, count, targets });
  render();
}

async function play(message) {
  if (active || seen.has(message.id) || document.hidden) return;
  seen.add(message.id);
  if (seen.size > 512) seen.delete(seen.values().next().value);
  active = message;
  presence();
  publish('started', { id: message.id, receiver: session });
  for (let i = 0; i < message.count; i++) {
    if (active !== message) return;
    document.body.classList.add('lit');
    await new Promise(resolve => setTimeout(resolve, 250));
    if (active !== message) return;
    document.body.classList.remove('lit');
    // Keep a dark interval even between consecutive one-flash signals.
    await new Promise(resolve => setTimeout(resolve, 500));
  }
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
      publish('play', { id: m.id, count: m.count, targets: m.targets });
      void play(m);
    } else if (m.type === 'play') void play(m);
    return;
  }
  if (m.type === 'presence' && typeof m.id === 'string' && (m.count === 0 || validCount(m.count))) {
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
    queueQoSZero:false, resubscribe:false
  });
  client = c;
  c.on('connect', () => {
    session = uid();
    const epoch = session;
    c.subscribe(topic, { qos:0 }, error => {
      if (client !== c || session !== epoch || !c.connected || error) return;
      online = true;
      if (role === 'receive') presence(); else publish('hello');
      render();
    });
  });
  c.on('message', (_, bytes, packet) => {
    if (client !== c || !online || packet.retain || bytes.length > 16384) return;
    let payload;
    try { payload = JSON.parse(bytes.toString()); } catch { return; }
    handle(payload);
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
  disconnect();
  wake?.release();
  role = next;
  seen = new Set();
  for (const id of ['home','send','receive']) $(id).hidden = id !== (role || 'home');
  $('result').textContent = '';
  render();
  keepAwake();
  connect();
}
function select(next) {
  history.pushState(null, '', next ? '#' + next : location.pathname);
  choose(next);
}
$('sender').onclick = () => select('send');
$('receiver').onclick = () => select('receive');
document.querySelectorAll('.back').forEach(b => b.onclick = () => select(null));
document.body.addEventListener('click', e => {
  if (role === 'receive' && online && !e.target.closest('button')) select(null);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && role) select(null); });
const route = () => choose(['#send','#receive'].includes(location.hash) ? location.hash.slice(1) : null);
window.addEventListener('popstate', route);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) disconnect(); else { connect(); keepAwake(); }
});
window.addEventListener('pagehide', disconnect);
window.addEventListener('pageshow', connect);
setInterval(() => {
  if (!online) return;
  if (role === 'receive') { presence(); return; }
  const now = performance.now();
  for (const [id,p] of peers) if (now - p.at > 5500) departed(id);
  if (pending && now - pending.since > 10000) endRequest('Delivery could not be confirmed.');
  render();
}, 1500);
route();
