// Keyboard and touch input.
// move(): { x, y } with x right and y toward the net, length at most 1.
// consume(action): true once per press of 'drive' | 'slice' | 'lob' | 'challenge'.

const MOVE_KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
};
const ACTION_KEYS = { Space: 'drive', KeyK: 'slice', KeyL: 'lob', KeyC: 'challenge' };
const STICK_DEADZONE = 0.18;

export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function createInput(target = window, doc = document) {
  const held = { left: false, right: false, up: false, down: false };
  const pressed = { drive: false, slice: false, lob: false, challenge: false };
  const holding = { drive: false, slice: false, lob: false }; // shot keys held down (power)
  const stick = { active: false, id: -1, x: 0, y: 0 };
  const out = { x: 0, y: 0 };

  target.addEventListener('keydown', (e) => {
    if (e.target && /^(BUTTON|INPUT|SELECT)$/.test(e.target.tagName)) return; // let the menu use keys
    if (MOVE_KEYS[e.code]) { held[MOVE_KEYS[e.code]] = true; e.preventDefault(); }
    const a = ACTION_KEYS[e.code];
    if (a) { if (!e.repeat) pressed[a] = true; if (a in holding) holding[a] = true; e.preventDefault(); }
  });
  target.addEventListener('keyup', (e) => {
    if (MOVE_KEYS[e.code]) held[MOVE_KEYS[e.code]] = false;
    const a = ACTION_KEYS[e.code];
    if (a && a in holding) holding[a] = false;
  });
  target.addEventListener('blur', () => {
    held.left = held.right = held.up = held.down = false;
    holding.drive = holding.slice = holding.lob = false;
    stick.active = false;
    stick.x = stick.y = 0;
  });

  // Touch: a virtual stick and three buttons, shown only on touch devices.
  if (isTouchDevice()) {
    doc.body.classList.add('touch');
    const base = doc.getElementById('stick');
    const knob = doc.getElementById('stick-knob');
    const setStick = (e) => {
      const r = base.getBoundingClientRect();
      const radius = r.width / 2;
      let dx = (e.clientX - (r.left + radius)) / radius;
      let dy = (e.clientY - (r.top + radius)) / radius;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      stick.x = dx;
      stick.y = -dy;
      knob.style.transform = `translate(${dx * radius * 0.55}px, ${dy * radius * 0.55}px)`;
    };
    const release = (e) => {
      if (e.pointerId !== stick.id) return;
      stick.active = false;
      stick.x = stick.y = 0;
      knob.style.transform = 'translate(0, 0)';
    };
    base.addEventListener('pointerdown', (e) => {
      stick.active = true;
      stick.id = e.pointerId;
      base.setPointerCapture(e.pointerId);
      setStick(e);
      e.preventDefault();
    });
    base.addEventListener('pointermove', (e) => { if (stick.active && e.pointerId === stick.id) setStick(e); });
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);
    for (const btn of doc.querySelectorAll('#buttons [data-action]')) {
      btn.addEventListener('pointerdown', (e) => {
        pressed[btn.dataset.action] = true;
        if (btn.dataset.action in holding) holding[btn.dataset.action] = true;
        btn.classList.add('down');
        e.preventDefault();
      });
      const up = () => { btn.classList.remove('down'); if (btn.dataset.action in holding) holding[btn.dataset.action] = false; };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }

  return {
    move() {
      let x = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      let y = (held.up ? 1 : 0) - (held.down ? 1 : 0);
      if (stick.active) {
        const len = Math.hypot(stick.x, stick.y);
        if (len > STICK_DEADZONE) {
          const k = Math.min(1, (len - STICK_DEADZONE) / (0.85 - STICK_DEADZONE)) / len;
          x = stick.x * k;
          y = stick.y * k;
        }
      }
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      out.x = x; out.y = y;
      return out;
    },
    // shot keys currently held down
    held() { return holding; },
    consume(action) {
      const v = pressed[action];
      pressed[action] = false;
      return v;
    },
    clear() { pressed.drive = pressed.slice = pressed.lob = pressed.challenge = false; },
    // the on-screen challenge button
    press(action) { pressed[action] = true; },
  };
}
