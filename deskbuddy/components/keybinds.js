/**
 * Keybinds — centralised keyboard shortcut registry.
 *
 * Usage:
 *   Keybinds.register({ id, label, defaultKey, fn })  — declare a shortcut
 *   Keybinds.init()                                    — install keydown listener
 *   Keybinds.getAll()                                  — read all entries (for settings UI)
 *   Keybinds.setOverride(id, combo)                    — persist a custom binding
 *   Keybinds.clearOverride(id)                         — revert to default
 *   Keybinds.prettyKey(combo)                          — human-readable label
 *
 * Key strings use the canonical form "Ctrl+Shift+P".
 * Modifiers are ordered Ctrl → Alt → Shift → key.
 */
const Keybinds = (() => {

  const _registry = {};  // { id: { id, label, defaultKey, fn } }

  // ── Registration ───────────────────────────────────────────────────────────

  function register({ id, label, defaultKey, fn }) {
    _registry[id] = { id, label, defaultKey, fn };
  }

  // ── Listener ───────────────────────────────────────────────────────────────

  function init() {
    document.addEventListener('keydown', _onKeyDown, { capture: true });
  }

  function _onKeyDown(e) {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (document.activeElement?.isContentEditable) return;

    const combo    = _eventToCombo(e);
    const overrides = (typeof Settings !== 'undefined') ? Settings.get('keybinds') : {};

    for (const [id, entry] of Object.entries(_registry)) {
      const activeKey = overrides[id] || entry.defaultKey;
      if (combo === _normalise(activeKey)) {
        e.preventDefault();
        try { entry.fn(); } catch (_) {}
        return;
      }
    }
  }

  function _eventToCombo(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey)               parts.push('Alt');
    if (e.shiftKey)             parts.push('Shift');
    const key = e.code
      .replace('Key', '')
      .replace('Digit', '')
      .replace('Numpad', 'Num');
    parts.push(key);
    return parts.join('+');
  }

  function _normalise(str) {
    return str
      .replace(/cmd|meta|⌘/gi, 'Ctrl')
      .replace(/opt|option|⌥/gi, 'Alt')
      .replace(/⇧/gi, 'Shift')
      .replace(/\s+/g, '')
      .split('+')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
      .sort((a, b) => {
        const ORDER = { 'Ctrl': 0, 'Alt': 1, 'Shift': 2 };
        return (ORDER[a] ?? 3) - (ORDER[b] ?? 3);
      })
      .join('+');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function getAll() {
    const overrides = (typeof Settings !== 'undefined') ? Settings.get('keybinds') : {};
    return Object.values(_registry).map(e => ({
      id:         e.id,
      label:      e.label,
      defaultKey: e.defaultKey,
      currentKey: overrides[e.id] || e.defaultKey,
    }));
  }

  function setOverride(id, combo) {
    const overrides = { ...(typeof Settings !== 'undefined' ? Settings.get('keybinds') : {}) };
    if (combo === null || combo === _registry[id]?.defaultKey) {
      delete overrides[id];
    } else {
      overrides[id] = combo;
    }
    if (typeof Settings !== 'undefined') Settings.set('keybinds', overrides);
  }

  function clearOverride(id) { setOverride(id, null); }

  /**
   * Convert a canonical combo string to a display-friendly label.
   * e.g. "Ctrl+Shift+Comma" → "Ctrl+Shift+,"
   */
  function prettyKey(str) {
    const KEY_NAMES = {
      'Comma':       ',',  'Period':      '.',  'Slash':    '/',
      'Semicolon':   ';',  'Quote':       "'",  'Backquote':'`',
      'BracketLeft': '[',  'BracketRight':']',  'Backslash':'\\',
      'Minus':       '-',  'Equal':       '=',  'Space':    'Space',
      'Enter':       '↵',  'Backspace':   '⌫',  'Delete':   '⌦',
      'Escape':      'Esc','Tab':         'Tab','ArrowUp':  '↑',
      'ArrowDown':   '↓',  'ArrowLeft':   '←',  'ArrowRight':'→',
    };
    return str.split('+').map(k => KEY_NAMES[k] || k).join('+');
  }

  return { register, init, getAll, setOverride, clearOverride, prettyKey };
})();
