<div align="center">

# 🐾 DeskBuddy

**A living desktop companion that watches over you while you study — and actually cares.**

DeskBuddy is an Electron app featuring an expressive animated creature that lives on your screen. It watches you through your webcam, reacts to your emotions, cheers you on during focus sessions, and gets genuinely sad when you disappear for too long.

[![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-22c55e)](LICENSE)

</div>

---

## ✨ What Makes It Special

DeskBuddy isn't just a cute widget — it's a **focus-aware study companion** powered by real-time webcam perception. It can tell when you're looking away, when you're on your phone, when you smile, and when you've been gone too long. The more you work, the more it celebrates with you.

---

## 🎭 Emotion System

The companion has **19 distinct expressions** that respond dynamically to what you do:

| Expression | Triggered by |
|-----------|-------------|
| 😊 **Happy** | Smiling at the camera |
| 👀 **Curious** | Sustained focused attention or a surprise expression |
| 😴 **Sleepy** | Low activity, idle state |
| 😶 **Focused** | Active focus session in progress |
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
| 😊 **Embarrassed** | Caught slacking |
| 🤗 **Forgiven** | Back on track after being away |
| 😴 **Idle** | Relaxed, between sessions |

---

## 📸 Webcam-Powered Perception

- Real-time **face detection** and **gaze tracking** via [MediaPipe FaceLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
- **Smile recognition** — the companion reacts when you smile at it
- **Surprise detection** — raised eyebrows trigger a curious reaction
- **Phone detection** — downward head tilt + dropped gaze marks you as suspicious
- **Eye contact detection** — stare long enough and it goes shy
- **Sleepy detection** — prolonged drooped-eyelid state triggers a sleepy reaction
- **Attention score** — continuous 0–100 score drives the focus timer state machine

---

## ⏱️ Focus Timer & Sessions

DeskBuddy tracks your work sessions from start to finish.

### Timer States
```
FOCUSED → DRIFTING → DISTRACTED → CRITICAL → FAILED
```
Each step increases urgency — the companion reacts visually and with sound. Staying in `CRITICAL` for 45 seconds without recovering ends the session as a distraction failure.

### Session Lifecycle
```
IDLE → ACTIVE → PAUSED → COMPLETED
                       ↘ FAILED
                       ↘ ABANDONED
```

| State | Description |
|-------|-------------|
| `ACTIVE` | Session running; timer ticking down |
| `PAUSED` | On a break — timer frozen, no time limit on breaks |
| `COMPLETED` | Timer ran to zero |
| `FAILED` | Distraction held for too long in `CRITICAL` state |
| `ABANDONED` | User manually quit the session |

> **Breaks are unlimited.** Take a 5-minute breather or a 1-hour walk — it's your session. Resume whenever you're ready.

### Settings
- **Three sensitivity modes** — Gentle / Normal / Strict (affects attention score thresholds)
- **Custom session duration** — hours, minutes, seconds via the HH:MM:SS picker
- **Break reminder** — configurable advisory nudge after N minutes of continuous work (independent of session state)
- **Session history** — last 50 sessions saved to `localStorage`

---

## 🌗 Time-of-Day Awareness

The companion adapts to the time of day — personality, speed, volume, and sensitivity all shift automatically.

| Period | Hours | Effect |
|--------|-------|--------|
| 🌅 **Morning** | 06:00–11:59 | Lively movement, morning-themed whispers, greeting on session start |
| ☀️ **Afternoon** | 12:00–17:59 | Neutral baseline |
| 🌆 **Evening** | 18:00–21:59 | Slower movement, warmer glow |
| 🌙 **Night** | 22:00–05:59 | Slowest movement, dimmed glow, auto-gentle sensitivity, reduced volume, night-specific messages |

---

## 🎉 Milestones & Encouragement

- Every **5 minutes of sustained focus** triggers a celebration
- Milestone messages escalate through 5 → 10 → 15 → ... → **60 minutes** (`1 HOUR!! 🎉🎉🎉`)
- **Whisper messages** — rare, soft text overlays appear when you're deep in focus
- Spontaneous **encouragement** and study tips pop up to keep you going
- The companion reacts warmly when you come back after being absent (_"welcome back"_ sequence)

---

## 🐾 Idle Life

The companion is never static between sessions:
- It **stretches**, **winks**, **yawns**, and drifts around the screen
- Spontaneous behaviors fire regularly to keep things alive
- **Pet it** with your cursor for a love reaction ♡

---

## 🪟 Two Window Modes

| Mode | Description |
|------|-------------|
| **PiP overlay** | Small frameless transparent window floats over your work — always draggable, always interactive |
| **Full-screen** | Expands to fill the display for a more immersive session |

Toggle with **Ctrl+Shift+P** (⌘+Shift+P on macOS) or the on-screen button. Window position and size persist across restarts.

---

## 🔊 Procedural Audio

- All sound effects generated in real-time via the **Web Audio API** — zero audio files
- Every emotion and interaction has a matching synthesised sound cue
- Separate **soundscape drone** module for ambient background texture
- Master volume control, per-category mute, and mute presets
- Night mode reduces master volume to 80% automatically

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

DeskBuddy opens as a frameless transparent window. Grant camera permission when prompted and your companion will come to life.

---

## 🏗️ Architecture

```
deskbuddy/
├── main.js                  # Electron main process — window creation, IPC, size/position persistence
├── preload.js               # Secure contextBridge IPC surface
├── renderer.js              # Boot orchestrator — initialises and wires all modules together
├── index.html               # App shell
├── styles.css               # All styles, emotion expressions, and animation keyframes
├── components/
│   ├── brain.js             # 🧠 Core behaviour engine — state machine, time-of-day, milestones, phone detection
│   ├── companion.js         # 🐾 DOM, position, gaze tracking, idle micro-behaviours
│   ├── emotion.js           # 🎭 Expression state — swaps CSS classes on the companion
│   ├── perception.js        # 📸 MediaPipe face/gaze/smile/surprise/sleepy detection
│   ├── timer.js             # ⏱️  Focus timer with distraction state machine
│   ├── session.js           # 📊 Session lifecycle — history, breaks (no limit), outcome logging
│   ├── sounds.js            # 🔊 Web Audio procedural sound engine (19 voices + session + tick sounds)
│   ├── soundscape.js        # 🎵 Ambient drone module
│   ├── particles.js         # ✨ Particle effects for celebrations
│   ├── camera.js            # 📷 Camera stream management
│   ├── movement.js          # 🎯 Smooth drift physics at 60 FPS
│   ├── spriteAnimator.js    # 🎬 CSS frame-based sprite animation
│   ├── settings.js          # ⚙️  Persistent settings (localStorage)
│   ├── keybinds.js          # ⌨️  Centralised keyboard shortcut registry
│   └── break-reminder.js    # 🔔 Advisory break nudge (independent of session state)
└── ui/
    └── status.js            # Status bar display
```

### Boot Order

```
Settings → Sounds → Soundscape → Session → Timer → Companion → SpriteAnimator
        → Particles → Status → Camera → Perception → Brain → wire
```

Each module is independent. `renderer.js` wires them together through dedicated wiring functions — no module calls another directly.

---

## 🧠 Behaviour States

| State | Emotion | What the Companion Does |
|-------|---------|-------------------------|
| `observe` | focused | Drifts gently, eyes scan the environment |
| `curious` | curious | Eyes widen, gaze sweeps left → right → up |
| `idle` | idle | Relaxed, occasional happy flash |
| `followCursor` | focused / suspicious | Tracks your cursor, retreats if you get too close |
| `sleepy` | sleepy | Eyes droop, all movement slows |

---

## ⚡ Performance

| Concern | Approach |
|---------|----------|
| Main loop | `requestAnimationFrame` at 60 FPS |
| Face tracking | MediaPipe FaceLandmarker at ~15 FPS via camera polling |
| DOM updates | Minimal — only `transform`, `classList`, and CSS custom properties |
| Rendering | GPU-accelerated via `will-change: transform, filter` |
| Audio | Zero-cost when muted; Web Audio graph tears down cleanly |

---

## 🗂️ Monorepo

The repository is a **pnpm workspace** with three additional packages alongside the Electron app:

| Package | Path | Stack |
|---------|------|-------|
| **Electron app** | `deskbuddy/` | Electron 34, vanilla JS, MediaPipe |
| **API** | `apps/api/` | Express 5, Prisma, Node 20, Redis |
| **Web** | `apps/web/` | React 18, Vite, Tailwind, Zustand |
| **Shared** | `packages/shared/` | Zod schemas, types, and constants |

---

## 📄 License

MIT

