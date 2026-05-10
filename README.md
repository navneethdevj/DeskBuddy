<div align="center">

# 🐾 DeskBuddy

**The desktop companion that turns focus sessions into a game you actually want to win.**

DeskBuddy is an Electron-powered animated buddy that lives on your screen, reads your focus signals from your webcam, reacts with personality, tracks your progress, and celebrates your wins like they matter.

[![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-22c55e)](LICENSE)

</div>

---

## 🚀 Why DeskBuddy is different

Most timers just count down. DeskBuddy **pays attention**.

It notices when you lock in, when you drift, when you disappear, when you smile, and when you come back. It responds with expressive animations, adaptive audio, live focus feedback, milestone hype, and deep stats that make consistency feel rewarding.

---

## ✨ Feature Atlas (everything cool, in one place)

### 🎭 1) Emotion engine with 23 expressive states
DeskBuddy can switch across:

- `idle`, `curious`, `focused`, `sleepy`, `suspicious`, `happy`
- `scared`, `sad`, `crying`, `pouty`, `grumpy`, `overjoyed`, `sulking`, `embarrassed`, `forgiven`
- `excited`, `shy`, `love`, `startled`, `cozy`, `being_patted`, `ecstatic`, `dazed`

That list is the full set of **23** emotion states currently implemented.

Includes interaction-driven reactions (petting, long-hold affection states), focus-state reactions, and preview mode in settings.

---

### 📸 2) Real-time webcam perception
Powered by MediaPipe FaceLandmarker with live behavior signals:

- Face detection + gaze estimation
- Smile detection
- Surprise detection
- Eye-contact detection
- Sleepy/low-alertness cues
- Phone suspicion detection (head/gaze posture)
- Continuous attention score (0–100) feeding focus logic

---

### ⏱️ 3) Focus session system with real consequences

- Full session lifecycle: **IDLE → ACTIVE → PAUSED → COMPLETED / FAILED / ABANDONED**
- Focus-state escalation: **FOCUSED → DRIFTING → DISTRACTED → CRITICAL → FAILED**
- Unlimited break flexibility with explicit pause/resume flow
- Session duration controls, step controls, and category tagging (`study`, `work`, `creative`, `reading`, `other`)
- Goal text per session + post-session goal check
- Distraction budget warnings per session
- Daily focus goal progress arc (Screen Time style)
- Live focus % stat bar + 90-second focus heatmap strip
- Celebration overlay, banners, confetti, and comeback sequences

---

### 📊 4) Rich analytics + history experience

- Focus stats views: **Daily / Weekly / Monthly / Lifetime**
- Sessions today, focused minutes, longest session, best day/week/month, streaks
- GitHub-style streak calendar (16-week mode) + month calendar mode
- Recent sessions panel with context actions:
  - View details
  - Copy summary
  - Star session
  - Export single session
  - Multi-select + bulk delete
- Weekly report modal support
- Anti-cheat/stats-protection option to prevent session deletion
- Local storage history retention up to **365 sessions** (oldest entries roll off)

---

### 🎨 5) Deep visual customization

#### Appearance
- Companion size
- Full-screen themes: `galaxy`, `classic`, `forest`, `sakura/cherry`, `ocean`, `midnight`, `snow`, `aurora`
- Theme particle effects toggle (theme-specific ambient visuals)
- Screen brightness

#### Eyes
- Iris preset colors + custom base color
- Independent layer overrides: center, mid, edge, ring, highlight sparkle, pupil core
- Iris reset and layer reset controls
- Eye glow preset colors + custom glow
- Emotion glow sync toggle
- Eye shape variants (`round`, `squish`, `almond`, `droopy`, `tall`)
- Eye size, eye distance, iris size
- Iris border toggle + border thickness slider
- Blink rate control (`off`, `slow`, `normal`, `fast`)

#### Face
- Eyebrow toggle
- Whisker toggle (including cat-mouth whisker styling support)
- Nose style (`triangle`, `dot`, `hidden`) + nose size
- Mouth shape (`arc`, `wide`, `cat`, `flat`, `hidden`) + mouth thickness + mouth size

#### Glow
- Buddy glow intensity (`off`, `subtle`, `normal`, `vivid`)

---

### 🔊 6) Procedural audio (no audio files required)

- Real-time Web Audio generated cues for emotions and interactions
- Ambient drone/soundscape module
- Master volume control
- Mute presets: `ALL_ON`, `ESSENTIAL`, `REMINDERS_ONLY`, `ALL_OFF`
- Timer tick toggle
- Night auto-volume reduction

---

### 🧠 7) Adaptive behavior & personality controls

- Focus sensitivity presets: `GENTLE`, `NORMAL`, `STRICT`
- Phone detection toggle
- Idle speed profile (`calm`, `default`, `hyper`)
- Expressiveness profile (`subtle`, `default`, `drama`)
- Petting response profile (`gentle`, `default`, `eager`)
- Expression preview duration control

---

### 🪟 8) Overlay/PiP window intelligence

- Full mode + compact PiP overlay mode
- Toggle mode via shortcut or on-screen controls
- Adjustable PiP opacity
- Overlay shape options: `square`, `rounded`, `circle`
- Snap-to-corner behavior
- Always-on-top toggle
- Auto-collapse on app switch + configurable delay
- Auto-restore on return
- Optional “stay full during active sessions”

---

### 🔕 9) Do Not Disturb (Focus lock)

- One-click DND mode to silence and calm the companion
- Configurable duration (including “until I turn it off”)
- Live visual indicator with progress ring
- Instant cancel via indicator or shortcut

---

### 💾 10) Backups, presets, and recovery tools

- Copy/paste appearance presets via clipboard
- Export/import session history
- Export/import all settings
- Clear session history
- Clear full cache/data
- Reset to factory defaults

---

### ⌨️ 11) Shortcut system (customizable)

Built-in defaults include:

- `Ctrl+Shift+P` → toggle compact/full mode
- `Ctrl+Shift+,` → open/close settings
- `Ctrl+Shift+M` → cycle mute presets
- `Ctrl+Shift+B` → dismiss break reminder
- `Ctrl+Shift+H` → open history/session panel
- `Ctrl+Shift+D` → toggle Do Not Disturb

(Keyboard mappings are user-configurable in Settings.)

---

### 🌗 12) Time-of-day mood adaptation

DeskBuddy adapts movement, feel, and messaging by time period (morning/afternoon/evening/night), including calmer nighttime behavior and lower volume defaults.

---

## 🧪 How to run

### Prerequisites

- Node.js 18+
- Webcam access (required for perception/focus features)
- pnpm (recommended for workspace commands)

### Install dependencies

```bash
pnpm install
```

### Start DeskBuddy (Electron app)

```bash
pnpm start
```

### Useful workspace commands

```bash
pnpm lint
pnpm build
pnpm test
pnpm type-check
```

---

## 🗂️ Monorepo layout

| Package | Path | Purpose |
|---|---|---|
| Electron companion app | `deskbuddy/` | Animated desktop buddy + focus/timer/perception system |
| API | `apps/api/` | Express + Prisma backend services |
| Web | `apps/web/` | React + Vite frontend |
| Shared | `packages/shared/` | Shared schemas, types, constants |

Workspace config is managed via `pnpm-workspace.yaml`.

---

## 🏗️ Core app architecture (`deskbuddy/`)

- `main.js` — Electron main process (windows, IPC, persistence)
- `preload.js` — secure bridge between renderer and main
- `renderer.js` — orchestration/wiring for UI + modules
- `components/brain.js` — high-level behavior logic
- `components/perception.js` — camera-derived signal processing
- `components/timer.js` — focus/distraction state machine
- `components/session.js` — session lifecycle + history store
- `components/sounds.js` + `components/soundscape.js` — procedural audio
- `components/dnd.js` — do-not-disturb flow
- `components/keybinds.js` — shortcut registry and overrides
- `components/settings.js` — settings persistence/export/import

---

## 📄 License

MIT
