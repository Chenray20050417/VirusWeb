const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
let now = 100000;
class Clock extends Date { static now() { return now; } }
const subscriptions = {}, timers = [], writes = [], clicks = {};
const elements = { gameStatus: {}, message: {}, participantCount: {} };
for (const id of ['virusButton', 'acidButton']) {
    const label = { innerText: id };
    elements[id] = { disabled: true, querySelector: () => label,
        addEventListener: (_, callback) => clicks[id] = callback };
}
let onUpdate = null;
const context = {
    Date: Clock, console: { log() {}, error() {} },
    initializeApp: () => ({}), getDatabase: () => ({}), ref: (_, path) => path,
    push: () => 'command', set: async (path, value) => writes.push({ path, value }),
    update: async () => { if (onUpdate) onUpdate(); }, remove: async () => {},
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    onDisconnect: () => ({ remove: async () => {} }),
    onValue: (path, callback, error) => subscriptions[path] = { callback, error },
    localStorage: { getItem: () => 'visitor-test' },
    document: { getElementById: id => elements[id] || null },
    setInterval: (callback, period) => { timers.push({ callback, period }); return timers.length; },
    clearInterval() {}
};
function emit(path, value) { subscriptions[path].callback({ val: () => value }); }
const commands = () => writes.filter(w => w.path === 'command');
async function main() {
    const source = fs.readFileSync('public/app.js', 'utf8')
        .replace(/import\s+[\s\S]*?from\s+"[^"]+";/g, '');
    await vm.runInNewContext('(async()=>{' + source + '\n})()', context);
    assert(elements.virusButton.disabled && elements.acidButton.disabled);
    await clicks.virusButton();
    assert.equal(commands().length, 0, 'Offline clicks must not write');
    emit('.info/serverTimeOffset', 1000);
    emit('.info/connected', true);
    emit('rooms/ab123/gameStatus', { sessionId: 'session-A', lastSeen: now + 1000 });
    assert(!elements.virusButton.disabled && !elements.acidButton.disabled);
    await clicks.acidButton();
    assert.equal(commands()[0].value.type, 'OBSCURE_VISION');
    assert.equal(commands()[0].value.sessionId, 'session-A');
    assert.equal(commands()[0].value.time['.sv'], 'timestamp');
    await clicks.acidButton();
    assert.equal(commands().length, 1, 'Cooldown must block double click');
    emit('rooms/ab123/gameStatus', null);
    now += 5100;
    timers.findLast(t => t.period === 100).callback();
    assert(elements.acidButton.disabled, 'Cooldown end must not enable offline controls');
    emit('rooms/ab123/gameStatus', { sessionId: 'session-B', lastSeen: now + 1000 });
    assert(!elements.acidButton.disabled);
    await clicks.virusButton();
    assert.equal(commands()[1].value.type, 'ADD_VIRUS');
    assert.equal(commands()[1].value.sessionId, 'session-B');
    now += 1600;
    timers.findLast(t => t.period === 100).callback();
    now += 15000;
    timers.find(t => t.period === 1000).callback();
    assert(elements.virusButton.disabled && elements.acidButton.disabled, 'Heartbeat must expire');
    await clicks.acidButton();
    assert.equal(commands().length, 2);
    emit('rooms/ab123/gameStatus', { sessionId: 'session-C', lastSeen: now + 1000 });
    emit('.info/connected', false);
    assert(elements.virusButton.disabled && elements.acidButton.disabled);
    emit('.info/connected', true);
    onUpdate = () => emit('rooms/ab123/gameStatus', { sessionId: 'session-D', lastSeen: now + 1000 });
    await clicks.acidButton();
    assert.equal(commands().length, 2, 'Restart during activity update must cancel command');
    subscriptions['rooms/ab123/gameStatus'].error(new Error('permission denied'));
    assert(elements.virusButton.disabled && elements.acidButton.disabled);
    console.log('PASS: offline blocking, online commands, session binding, timestamps, heartbeat expiry, connection loss, cooldown, restart race and permission errors. No live writes.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
