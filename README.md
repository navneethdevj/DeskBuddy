# 👀 DeskBuddy

**A cute animated desktop companion that lives on your screen while you study or work.**

DeskBuddy is an Electron desktop-pet application featuring a pair of **glowing watchful eyes** — a tiny animated creature that drifts gently on your screen, blinks, reacts to your cursor, watches you through your webcam, and responds with 15 distinct emotions.

![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 👀 **Expressive Eyes** | Gradient eyes with dark-center pupils, expressive eyebrows, and emotion-specific shapes |
| 🧠 **Creature Brain** | Attention-based state machine — observe, curious, idle, followCursor, sleepy — with emotion escalation chains |
| 📷 **Webcam Perception** | MediaPipe face detection with iris gaze tracking, blink detection (blendshape + geometric EAR), and adaptive gaze calibration |
| 🎵 **Synthesized Voice** | Web Audio API sound system with FM synthesis, ring modulation, and formant-based vocalizations for each emotion |
| 🤖 **AI Companion** | Behavioral profiling with session tracking and mood-aware suggestions |
| 😊 **15 Emotions** | idle, curious, focused, sleepy, suspicious, happy, scared, sad, crying, pouty, grumpy, overjoyed, sulking, embarrassed, forgiven |
| ✨ **Particle Effects** | Emotion-specific ambient particles with drift animations |
| 🖱️ **User Interactions** | Pet (click), rapid-click scare, hover curiosity, and spontaneous idle behaviors (look, blink, wink, stretch, coo) |
| 🎬 **Sprite Animation** | Frame-based idle breathing animation at 4 FPS |
| 🎯 **Smooth Movement** | Frame-rate independent delta-time lerp, GPU-composited transforms, home-area drift at 60 FPS |

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
├── styles.css              # All styles, expressions, particles, and sprite-frame CSS
├── components/
│   ├── brain.js            # Creature Brain — state machine, emotion escalation, idle life, interactions
│   ├── companion.js        # Companion DOM, pupil tracking, gradient gaze, blinking
│   ├── emotion.js          # Emotion state management (15 states)
│   ├── audio.js            # Web Audio synthesis — FM, ring mod, formant voices
│   ├── camera.js           # MediaPipe face landmark detection
│   ├── perception.js       # Face state interpretation — gaze, blink, attention scoring
│   ├── ai.js               # AI behavioral companion — session profiling, mood bias
│   ├── particles.js        # Emotion-driven ambient particle system
│   ├── movement.js         # Physics — drift, velocity, frame-rate independent decay
│   └── spriteAnimator.js   # Frame-based sprite animation engine
└── ui/
    └── status.js           # Status bar — emotion label + attention display
```

### How It Works

1. **Brain** (`brain.js`) runs the main `requestAnimationFrame` loop and manages the attention-based state machine. It cycles through states — `observe`, `curious`, `idle`, `sleepy` — each lasting 4–8 seconds. When camera perception is available, states are driven by the user's focus, gaze, and blink patterns. The brain also manages emotion escalation chains (e.g. idle → suspicious → pouty → grumpy when the user looks away), spontaneous idle behaviors, and user interaction responses.

2. **Camera & Perception** (`camera.js`, `perception.js`) use MediaPipe face landmarks to detect the user's face, track iris-based gaze direction with head-pose compensation, detect blinks via fused blendshape + geometric EAR, and compute an attention score that drives emotion selection.

3. **Audio** (`audio.js`) provides synthesized vocalizations for each emotion transition using Web Audio API. Techniques include FM synthesis, ring modulation, formant shaping, and chiptune beeps.

4. **AI Companion** (`ai.js`) tracks behavioral patterns (focus duration, smile frequency, breaks, look-aways) across sessions and provides mood-aware suggestions.

5. **Movement** (`movement.js`) handles physics with frame-rate independent delta-time scaling. It drifts the companion within a small range of the origin using smooth velocity interpolation with perpendicular curve offsets.

6. **Companion** (`companion.js`) builds the eye DOM tree with eyebrows, manages pupil tracking with delta-time lerp smoothing, provides `lookAt()` / `resetLook()` for gradient-based gaze, and runs blink scheduling with recovery transitions.

7. **Emotion** (`emotion.js`) manages 15 emotion states by swapping CSS classes that control eye shape, eyebrow position, glow animations, and particle styles.

8. **Particles** (`particles.js`) spawns ambient DOM particles near the companion, styled per emotion with drift-and-fade animations.

---

## 🧠 Behavior States

| State | Expression | What Happens |
|-------|-----------|--------------|
| `observe` | focused | Drifts gently while eyes slowly scan the environment |
| `curious` | curious | Eyes widen dramatically; gaze shifts left → right → up → center |
| `idle` | idle | Relaxed eyes with spontaneous idle behaviors and occasional happy flash |
| `followCursor` | focused / suspicious | Eyes track the cursor; retreats if cursor is very close |
| `sleepy` | sleepy | Eyes half-close; no movement |

### Emotion Escalation

When camera perception is active, emotions escalate over time:

| Trigger | Escalation Chain |
|---------|-----------------|
| User looks away | idle → suspicious → pouty → grumpy |
| No face detected | idle → scared → sad → crying |
| Sustained attention | focused → overjoyed (with happy flashes) |

### Idle Life Behaviors

Spontaneous weighted behaviors fire every 12–35 seconds:

| Weight | Behavior |
|--------|----------|
| 40 | Idle look (eyes glance around) |
| 25 | Slow blink |
| 15 | Wink (random eye) |
| 12 | Stretch (brief curious expression) |
| 8 | Spontaneous coo (audio) |

---

## 🎨 Sprite Animation

The sprite system uses CSS class–based placeholder frames (no image assets required).

| Animation | Frames | FPS | Loop | Visual Effect |
|-----------|--------|-----|------|---------------|
| `idle` | 3 unique (4 total) | 4 | ✅ | Subtle vertical translate and scale (breathing) |

When real sprite PNGs are added to `assets/`, the animator can be extended to swap `<img>` sources instead of CSS classes.

---

## ⚡ Performance

- **Movement loop**: `requestAnimationFrame` at 60 FPS with delta-time compensation
- **Sprite frames**: `setInterval` at 4 FPS
- **DOM updates**: minimal — only `transform`, `classList`, and CSS custom property changes
- **Rendering**: GPU-accelerated via `will-change`, `translate3d`, and `backface-visibility: hidden`
- **Pupil interpolation**: frame-rate independent `dtLerp` with 90ms half-life
- **Particle system**: capped at 15 simultaneous particles

---

## 🗺️ Roadmap

- [ ] Real sprite image assets for the companion
- [ ] Multiple companion characters
- [ ] Theme customization

---

## 📄 License

MIT
