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
| 👀 **Curious** | Sustained focused attention or a surprise expression |
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
| 😳 **Shy** | You've been making sustained eye contact |
| 💕 **Love** | You pet it |
| 😱 **Startled** | Sudden fast mouse movement |

### 📸 Webcam-Powered Perception
- Real-time **face detection** and **gaze tracking** via MediaPipe FaceLandmarker
- **Smile recognition** — the companion reacts when you smile at it
- **Surprise detection** — a raised-eyebrow expression triggers a curious reaction
- **Phone detection** — downward head tilt + dropped gaze marks you as suspicious
- **Eye contact detection** — stare at it long enough and it goes shy
- **Attention score** — continuous 0–100 score drives focus timer state

### ⏱️ Focus Timer & Sessions
- Built-in **Pomodoro-style timer** (25 min default)
- Timer states: `FOCUSED` → `DRIFTING` → `DISTRACTED` → `CRITICAL` → `FAILED`
- Sessions are tracked and saved to `localStorage` (up to 50 history entries)
- Break budget: **5 minutes** of look-away time; auto-fail after **10 minutes** away
- Three **sensitivity modes**: Gentle / Normal / Strict
- Session states: `IDLE` → `ACTIVE` → `PAUSED` → `COMPLETED` | `FAILED` | `ABANDONED`

### 🌗 Time-of-Day Awareness
The companion adapts its entire personality to the time of day:

| Period | Hours | Effect |
|--------|-------|--------|
| 🌅 **Morning** | 06:00–11:59 | Livelier movement, morning-themed whispers |
| ☀️ **Afternoon** | 12:00–17:59 | Neutral baseline |
| 🌆 **Evening** | 18:00–21:59 | Slightly slower, warmer glow |
| 🌙 **Night** | 22:00–05:59 | Slowest movement, dim glow, auto-gentle sensitivity, night-specific messages |

### 🎉 Milestones & Encouragement
- Every **5 minutes of sustained focus** triggers a celebration
- Milestone messages escalate all the way to **60 minutes** (`1 HOUR!! 🎉🎉🎉`)
- **Whisper messages** — rare, soft text overlays appear when you're deep in focus
- Spontaneous encouragement and study tips pop up to keep you motivated

### 🐾 Idle Life
- The companion is never static — it **stretches**, **winks**, **yawns**, and drifts around
- Spontaneous behaviors fire every few seconds to keep things alive
- Pet it with your cursor for a love reaction ♡

### 🪟 Two Window Modes
- **PiP overlay** — small frameless transparent window that floats over your work, always draggable and always interactive
- **Full-screen mode** — expands to fill the display for a more immersive session; toggle with **Ctrl+Shift+P** (⌘+Shift+P on macOS) or the on-screen button
- Window position persists across restarts

### 🔊 Procedural Audio
- All sound effects generated in real-time via the **Web Audio API** — no audio files
- Every emotion and interaction has a matching sound cue
- Master volume control with mute support
- Night mode reduces volume to 80% automatically

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or newer
- A webcam (required for face tracking and focus detection)

### Install & Run

```bash
# Install dependencies
npm install

# Launch the companion
npm start
```

DeskBuddy will open as a frameless transparent window. Grant camera permission when prompted and your companion will come to life.

---

## 🏗️ Architecture

```
deskbuddy/
├── main.js                 # Electron main process — window creation, IPC, size/position persistence
├── preload.js              # Secure contextBridge IPC surface
├── renderer.js             # Boot orchestrator — wires all modules together
├── index.html              # App shell
├── styles.css              # All styles, emotion expressions, and animation keyframes
├── components/
│   ├── brain.js            # 🧠 Core behavior engine — state machine, time-of-day, milestones
│   ├── companion.js        # 🐾 DOM, position, gaze tracking, idle micro-behaviors
│   ├── emotion.js          # 🎭 Expression state — swaps CSS classes on the companion
│   ├── perception.js       # 📸 MediaPipe face/gaze/smile/surprise detection
│   ├── timer.js            # ⏱️  Focus timer with distraction state machine
│   ├── session.js          # 📊 Session lifecycle — history, breaks, failure logic
│   ├── sounds.js           # 🔊 Web Audio procedural sound engine (15 emotion voices + ticks)
│   ├── soundscape.js       # 🎵 Ambient drone module (loaded for CSS hooks; drone disabled)
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
- **Face tracking**: MediaPipe FaceLandmarker at ~15 FPS via camera polling
- **DOM updates**: minimal — only `transform`, `classList`, and CSS custom properties
- **Rendering**: GPU-accelerated via `will-change: transform, filter`
- **Audio**: zero-cost when muted; Web Audio graph tears down cleanly

---

## 🗂️ Monorepo

The repository is a **pnpm workspace** with three packages alongside the Electron app:

| Package | Path | Description |
|---------|------|-------------|
| Electron app | `deskbuddy/` | The companion app (this README) |
| API | `apps/api/` | Express 5 + Prisma backend |
| Web | `apps/web/` | React 18 + Vite + Tailwind frontend |
| Shared | `packages/shared/` | Zod schemas, types, constants shared between API and web |

---

## 📄 License

MIT
