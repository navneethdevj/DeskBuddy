# 🐱 DeskBuddy

**A cute animated desktop companion that lives on your screen while you study or work.**

DeskBuddy is an Electron desktop-pet application featuring **Mochi Kitty** — a tiny animated creature that wanders around your screen, hops, blinks, and reacts to your cursor.

![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🐾 **Mochi Kitty** | Adorable CSS-drawn companion with expressive face, ears, and cheeks |
| 🧠 **Creature Brain** | Behavior state machine — wander, idle, hop, look around, inspect cursor |
| 🎬 **Sprite Animation** | Frame-based walk, idle, and jump animations at 6–12 FPS |
| 🖱️ **Cursor Interaction** | Kitty looks at your cursor and reacts when you move close |
| ✨ **Micro Animations** | Blinking, breathing, head tilts — the kitty is never frozen |
| 🎯 **Smooth Movement** | Velocity-based curved paths with edge avoidance at 60 FPS |
| 😊 **Emotion System** | Five expressions — happy, focused, suspicious, sleepy, confused |

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

The Mochi Kitty will appear as a transparent overlay on your screen.

---

## 🏗️ Architecture

```
deskbuddy/
├── main.js                 # Electron main process (frameless transparent window)
├── preload.js              # Secure IPC bridge
├── renderer.js             # Frontend entry point — boots all modules
├── index.html              # App shell
├── styles.css              # All styles, expressions, and sprite-frame CSS
├── assets/kitty/           # Sprite image assets (placeholder)
├── components/
│   ├── brain.js            # Creature Brain — behavior state machine
│   ├── companion.js        # Companion DOM, position, rotation, idle behaviors
│   ├── spriteAnimator.js   # Frame-based sprite animation engine
│   ├── movement.js         # Velocity-based movement with curved paths
│   └── emotion.js          # Expression / emotion state system
└── ui/
    └── status.js           # Status bar text display
```

### How It Works

1. **Brain** (`brain.js`) runs the main `requestAnimationFrame` loop and manages the behavior state machine. It cycles through states — `wander`, `idle`, `hop`, `lookAround` — each lasting 2–5 seconds. When the mouse cursor moves nearby, the brain switches to `inspectCursor`.

2. **Movement** (`movement.js`) handles physics. It steers the kitty toward random screen targets using smooth velocity interpolation with perpendicular curve offsets. Mouse proximity creates a push force.

3. **SpriteAnimator** (`spriteAnimator.js`) cycles CSS frame classes at 6–12 FPS to create body animation — walk waddle, idle breathing, and jump squash-and-stretch.

4. **Companion** (`companion.js`) builds the kitty's DOM tree, manages position/rotation transforms, and runs independent micro-animations like blinking.

5. **Emotion** (`emotion.js`) swaps CSS expression classes on the companion element to change eyes, mouth, and eyebrow styles.

---

## 🧠 Behavior States

| State | Animation | What Happens |
|-------|-----------|--------------|
| `wander` | walk | Moves toward random screen targets along curved paths |
| `idle` | idle | Stands still with gentle breathing motion |
| `hop` | jump | Squash → jump → stretch → land bounce |
| `lookAround` | idle | Pauses and moves eyes left then right |
| `inspectCursor` | idle | Looks toward your cursor; may approach or retreat |

---

## 🎨 Sprite Animation

The sprite system uses CSS class–based placeholder frames (no image assets required).

| Animation | Frames | FPS | Loop | Visual Effect |
|-----------|--------|-----|------|---------------|
| `idle` | 4 | 6 | ✅ | Gentle vertical scale (breathing) |
| `walk` | 4 | 8 | ✅ | Alternating rotation (waddle) |
| `jump` | 3 | 10 | ❌ | Squash → stretch up → land squash |

When real sprite PNGs are added to `assets/kitty/`, the animator can be extended to swap `<img>` sources instead of CSS classes.

---

## ⚡ Performance

- **Movement loop**: `requestAnimationFrame` at 60 FPS
- **Sprite frames**: `setInterval` at 6–12 FPS
- **DOM updates**: minimal — only `transform` and `classList` changes
- **Rendering**: GPU-accelerated via `will-change: transform`

---

## 🗺️ Roadmap

- [ ] Real sprite image assets for Mochi Kitty
- [ ] Multiple companion characters
- [ ] Webcam-based focus detection
- [ ] AI study session tracking
- [ ] Theme customization
- [ ] Sound effects

---

## 📄 License

MIT
