# 👀 DeskBuddy

> **A living desktop companion that watches over you while you study — and actually cares if you drift away.**

DeskBuddy is an Electron app featuring an expressive animated creature that lives on your screen. It watches you through your webcam, reacts to your emotions, cheers you on during focus sessions, and gets genuinely sad when you disappear for too long.

![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 🌟 What Makes It Special

DeskBuddy isn't just a cute widget — it's a **focus-aware study companion** powered by real-time webcam perception. It can tell when you're looking away, when you're on your phone, when you smile, and when you've been gone too long. The more you work, the more it celebrates with you.

---

## ✨ Features

### 🎭 Rich Emotion System
The companion has **15 distinct expressions** that respond dynamically to what you do:

| Emotion | Triggered by |
|---------|-------------|
| 😊 **Happy** | Smiling at the camera |
| 👀 **Curious** | Something catching its attention |
| 😴 **Sleepy** | Low activity, idle state |
| 😨 **Scared** | You suddenly disappeared |
| 😢 **Sad** | You've been gone a while |
| 😭 **Crying** | You've been away too long |
| 😤 **Grumpy** | You keep looking away |
| 😒 **Pouty** | You looked away for a bit |
| 🙄 **Sulking** | Silently protesting your inattention |
| 🤨 **Suspicious** | Phone detected, or something seems off |
| 🥰 **Overjoyed** | You came back! Milestone reached! |
| 🤩 **Excited** | Big moment energy |
| 😳 **Shy** | You've been staring directly at it |
| 💕 **Love** | You pet it |
| 😱 **Startled** | Sudden fast mouse movement |

### 📸 Webcam-Powered Perception
- Real-time **face detection** and **gaze tracking** via MediaPipe
- **Smile recognition** — the companion notices when you're happy
- **Phone detection** — if you tilt your head down and your gaze drops, it gets suspicious
- **Eye contact detection** — stare at it long enough and it goes shy

### ⏱️ Focus Timer & Sessions
- Built-in **Pomodoro-style timer** (25 min default)
- Timer states: `FOCUSED` → `DRIFTING` → `DISTRACTED` → `CRITICAL` → `FAILED`
- Sessions are tracked and saved to `localStorage` (up to 50 history entries)
- Break budget: **5 minutes** of look-away time before the session fails
- Three **sensitivity modes**: Gentle / Normal / Strict

### 🎉 Milestones & Encouragement
- Every **5 minutes of sustained focus** triggers a celebration
- Milestone messages escalate all the way to **60 minutes** (`1 HOUR!! 🎉🎉🎉`)
- Spontaneous encouragement whispers appear when you're deep in focus
- Study tips and cheers randomly pop up to keep you motivated

### 🐾 Idle Life
- The companion is never static — it **stretches**, **winks**, **yawns**, and drifts around
- Spontaneous behaviors fire every few seconds to keep things alive
- Pet it with your cursor for a love reaction ♡

### 🔊 Spatial Audio
- Procedurally generated sound effects using the **Web Audio API**
- Every emotion and interaction has a matching sound cue
- Master volume control with mute support

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or newer
- A webcam (required for face tracking and focus detection)

### Install & Run

```bash
# Install dependencies
npm install

# Launch the companion
npm start
```

DeskBuddy will open as a **frameless, always-on-top window**. Grant camera permission when prompted and your companion will come to life.

---

## 🏗️ Architecture

```
deskbuddy/
├── main.js                 # Electron main process — frameless transparent window
├── preload.js              # Secure IPC bridge
├── renderer.js             # Boot orchestrator — wires all modules together
├── index.html              # App shell
├── styles.css              # All styles, expressions, and animation keyframes
├── components/
│   ├── brain.js            # 🧠 Core behavior engine — state machine, perception routing
│   ├── companion.js        # 🐾 DOM, position, gaze, idle micro-behaviors
│   ├── emotion.js          # 🎭 Expression state — swaps CSS classes
│   ├── perception.js       # 📸 Webcam face/gaze/smile/surprise detection
│   ├── timer.js            # ⏱️  Focus timer with distraction state machine
│   ├── session.js          # 📊 Session tracking — history, breaks, failure logic
│   ├── sounds.js           # 🔊 Web Audio procedural sound engine
│   ├── particles.js        # ✨ Particle effects for celebrations
│   ├── camera.js           # 📷 Camera stream management
│   ├── movement.js         # 🎯 Smooth drift physics at 60 FPS
│   └── spriteAnimator.js   # 🎬 CSS frame-based sprite animation
└── ui/
    └── status.js           # Status bar display
```

### Boot Order

`Sounds → Session → Timer → Companion → SpriteAnimator → Particles → Status → Camera → Perception → Brain`

Each module is independent. `renderer.js` wires them together through dedicated wiring functions — no module calls another directly.

---

## 🧠 Behavior States

| State | Emotion | What the Companion Does |
|-------|---------|-------------------------|
| `observe` | focused | Drifts gently, eyes scan the environment |
| `curious` | curious | Eyes widen, gaze sweeps left → right → up |
| `idle` | idle | Relaxed, occasional happy flash |
| `followCursor` | focused / suspicious | Tracks your cursor, retreats if you get too close |
| `sleepy` | sleepy | Eyes droop, all movement slows |

---

## ⚡ Performance

- **Main loop**: `requestAnimationFrame` at 60 FPS
- **Face tracking**: MediaPipe at ~15 FPS via camera polling
- **DOM updates**: minimal — only `transform`, `classList`, and CSS custom properties
- **Rendering**: GPU-accelerated via `will-change: transform, filter`
- **Audio**: zero-cost when muted; Web Audio graph tears down cleanly

---

## 📄 License

MIT
