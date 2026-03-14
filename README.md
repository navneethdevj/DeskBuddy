# 👀 DeskBuddy

**A cute animated desktop companion that lives on your screen while you study or work.**

DeskBuddy is an Electron desktop-pet application featuring a pair of **glowing watchful eyes** — a tiny animated creature that drifts gently on your screen, blinks, and reacts to your cursor.

![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 👀 **Glowing Eyes** | Large warm-white gradient eyes — no separate pupil; gaze direction shifts the gradient center |
| 🧠 **Creature Brain** | Attention-based state machine — observe, curious, idle, followCursor, sleepy |
| 🎬 **Sprite Animation** | Frame-based idle breathing animation at 4 FPS |
| 🖱️ **Cursor Interaction** | Eyes follow your cursor and the companion retreats when you get too close |
| ✨ **Micro Animations** | Blinking, breathing, glow pulsing — the companion is never frozen |
| 🎯 **Smooth Movement** | Home-area drift with velocity-based curved paths at 60 FPS |
| 😊 **Emotion System** | Six expressions — idle, curious, focused, sleepy, suspicious, happy |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or newer

### Install & Run

```bash
# Install dependencies
npm install

# Launch the companion
npm start
```

The glowing eyes will appear on a dark background window on your screen.

---

## 🏗️ Architecture

```
deskbuddy/
├── main.js                 # Electron main process (frameless transparent window)
├── preload.js              # Secure IPC bridge
├── renderer.js             # Frontend entry point — boots all modules
├── index.html              # App shell
├── styles.css              # All styles, expressions, and sprite-frame CSS
├── components/
│   ├── brain.js            # Creature Brain — attention-based behavior state machine
│   ├── companion.js        # Companion DOM, position, gradient-based gaze, idle behaviors
│   ├── spriteAnimator.js   # Frame-based sprite animation engine
│   ├── movement.js         # Home-area drift with velocity-based curved paths
│   └── emotion.js          # Expression / emotion state system
└── ui/
    └── status.js           # Status bar text display
```

### How It Works

1. **Brain** (`brain.js`) runs the main `requestAnimationFrame` loop and manages the attention-based state machine. It cycles through states — `observe`, `curious`, `idle`, `sleepy` — each lasting 2–5 seconds. When the mouse cursor moves nearby, the brain switches to `followCursor`.

2. **Movement** (`movement.js`) handles physics. It drifts the companion within a small range (±40 px) of the origin using smooth velocity interpolation with perpendicular curve offsets. Mouse proximity creates a push force.

3. **SpriteAnimator** (`spriteAnimator.js`) cycles CSS frame classes at 4 FPS to create subtle idle breathing animation through small translate and scale transforms.

4. **Companion** (`companion.js`) builds the eye DOM tree, manages position/rotation transforms, provides `lookAt()` / `resetLook()` for gradient-based gaze via CSS custom properties (`--gaze-x`, `--gaze-y`), and runs independent micro-animations like blinking.

5. **Emotion** (`emotion.js`) swaps CSS expression classes on the companion element to change eye shape and style.

---

## 🧠 Behavior States

| State | Expression | What Happens |
|-------|-----------|--------------|
| `observe` | focused | Drifts gently while eyes slowly scan the environment |
| `curious` | curious | Eyes widen dramatically; gaze shifts left → right → up → center |
| `idle` | idle | Relaxed eyes with occasional happy flash |
| `followCursor` | focused / suspicious | Eyes track the cursor; retreats if cursor is very close |
| `sleepy` | sleepy | Eyes half-close; no movement |

---

## 🎨 Sprite Animation

The sprite system uses CSS class–based placeholder frames (no image assets required).

| Animation | Frames | FPS | Loop | Visual Effect |
|-----------|--------|-----|------|---------------|
| `idle` | 3 unique (4 total) | 4 | ✅ | Subtle vertical translate and scale (breathing) |

When real sprite PNGs are added to `assets/`, the animator can be extended to swap `<img>` sources instead of CSS classes.

---

## ⚡ Performance

- **Movement loop**: `requestAnimationFrame` at 60 FPS
- **Sprite frames**: `setInterval` at 4 FPS
- **DOM updates**: minimal — only `transform`, `classList`, and CSS custom property changes
- **Rendering**: GPU-accelerated via `will-change: transform, filter`

---

## 🗺️ Roadmap

- [ ] Real sprite image assets for the companion
- [ ] Multiple companion characters
- [ ] Webcam-based focus detection
- [ ] AI study session tracking
- [ ] Theme customization
- [ ] Sound effects

---

## 📄 License

MIT
