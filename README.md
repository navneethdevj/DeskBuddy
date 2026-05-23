<div align="center">

<br>

# 🐾 DeskBuddy

### *Your desk. Your companion. Your focus.*

DeskBuddy is a little animated creature that lives on your screen.
It watches you work, feels things when you drift, reacts when you come back,
and quietly celebrates every win — big or small.

It isn't a timer. It's a companion.

<br>

[![Made with Electron](https://img.shields.io/badge/Built%20with-Electron-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node 18+](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License MIT](https://img.shields.io/badge/License-MIT-a855f7?style=flat-square)](LICENSE)

<br>

---

</div>

## 🌟 What makes DeskBuddy different

Most focus apps just count down a clock. DeskBuddy actually **pays attention to you**.

It can see when you lock in. It notices when you drift. It gets sad when you disappear for too long. It lights up when you smile at it. It resists being comforted when it's upset — and slowly softens the more you try.

It has feelings. Not real ones, obviously — but convincingly close.

<br>

---

## 🗂️ Table of Contents

- [Meet the Buddy](#-meet-the-buddy)
- [The Emotion System](#-the-emotion-system--how-buddy-feels)
- [How Buddy Sees You](#-how-buddy-sees-you--the-perception-system)
- [Petting & Comfort](#-petting--comfort)
- [Focus Sessions](#-focus-sessions)
- [Your Stats & History](#-your-stats--history)
- [Daily Tasks](#-daily-tasks)
- [Sounds & Audio](#-sounds--audio)
- [Appearance & Customization](#-appearance--customization)
- [Do Not Disturb](#-do-not-disturb)
- [Themes](#-themes)
- [Keyboard Shortcuts](#-keyboard-shortcuts)
- [Time-of-Day Behavior](#-time-of-day-behavior)
- [Backup & Data](#-backup--data)
- [How to Install & Run](#-how-to-install--run)
- [File Structure (For Developers)](#-file-structure-for-developers)

<br>

---

## 🐱 Meet the Buddy

Buddy is a small animated cat-like creature that sits on your desktop. It has:

- **Expressive eyes** that blink, look around, and follow your face
- **Animated ears, tail, and body** that react to what it's feeling
- **Whiskers and facial features** you can fully customize
- **A glow** that shifts color with its mood
- **Whispered thoughts** — little messages it shows when it has something to say

Buddy isn't static decoration. It's alive in the sense that matters — it **responds to you**.

<br>

---

## 🎭 The Emotion System — How Buddy Feels

Buddy has **23 distinct emotional states**. It moves between them based on what you're doing, how long you've been away, whether you're smiling, and how you've been treating it.

### The full emotional range

| Emotion | What it looks like | What triggers it |
|---|---|---|
| 😊 **Happy** | Bright eyes, gentle glow | You smile at it, good typing rhythm |
| ✨ **Excited** | Bouncing, vibrating | Rapid typing, big milestones |
| 🎉 **Overjoyed** | Spinning, happy tears | You come back after a long absence |
| 💖 **Love** | Purring, nuzzling | Being gently held/petted |
| 🫶 **Cozy** | Melting, snuggling | Sustained gentle petting |
| 😳 **Shy** | Blushing, looking away | Surprised by attention |
| 😲 **Startled** | Jumping, floof | Sudden sounds or movement |
| 😴 **Sleepy** | Drooping eyes, swaying | Late night, long idle |
| 🤔 **Curious** | Head tilt, perked ears | New activity detected |
| 🔍 **Suspicious** | Narrowed eyes | Something feels off |
| 😨 **Scared** | Hiding, shaking | Loud or sudden events |
| 😢 **Sad** | Sniffling, hugging knees | You've been away for a while |
| 😭 **Crying** | Sobbing, tears | You've been gone a long time |
| 😠 **Grumpy** | Huffing, tail flick | Prolonged distraction or being ignored |
| 😤 **Pouty** | Arms crossed, sulking | Minor neglect or missed session |
| 🙃 **Sulking** | Staring at wall | Deep-seated upset |
| 🤩 **Dazed** | Starry eyes, floating | After very deep petting sessions |
| 😖 **Embarrassed** | Hiding face, red | Caught in an awkward moment |
| 🤝 **Forgiven** | Reluctant smile | After being comforted through resistance |
| 🎯 **Focused** | Alert, still, concentrated | You're deeply in a work session |
| 💝 **Being patted** | Leaning in, content | Active petting |
| 🌟 **Ecstatic** | Maximum joy | Very special celebration moments |
| 🔮 **Idle** | Breathing, looking around | Default calm state |

<br>

### How emotions transition

Buddy doesn't snap between emotions randomly. There are **cause-and-effect chains**:

- **Gone too long?** It goes `sad` → `crying` the longer you're absent
- **Being ignored while working?** It escalates `pouty` → `grumpy` → `sulking`
- **Distracted during a session?** It mirrors your focus state — drifting, then worried
- **You come back?** It explodes into `overjoyed` — genuinely thrilled to see you
- **After overjoyed, ignored again?** It crashes into `sulking` — the betrayal is real
- **Pet it after it sulks?** It slowly forgives you over several seconds

<br>

---

## 📸 How Buddy Sees You — The Perception System

If you allow camera access, Buddy gains the ability to **see and read your behavior** in real time. Nothing is uploaded or stored — everything happens locally on your device.

### What Buddy can detect

| Signal | What it means for Buddy |
|---|---|
| 👤 **Your face is present** | Buddy knows you're there |
| 👀 **Where you're looking** | Its eyes follow your gaze |
| 😊 **You're smiling** | Buddy reacts with joy or, if sad, slowly recovers |
| 😮 **You look surprised** | Buddy gets startled or excited |
| 👁️ **Eye contact** | It notices when you look directly at it |
| 😪 **You look tired** | Buddy gets sleepy too |
| 📱 **You might be on your phone** | Buddy gets suspicious |
| 📊 **Attention score 0–100** | Drives the focus state machine |

> **No camera?** No problem. Buddy still works fully — it just uses typing patterns and time-based signals instead.

<br>

---

## 🫶 Petting & Comfort

One of the most unique things about Buddy is that you can **physically interact with it** using your mouse.

### How petting works

- **Click and hold** near Buddy to start petting
- Hold for a moment and it enters a **cozy state** — purring, nuzzling, melting
- Hold longer and it goes deeper — leaning in, completely content
- Hold even longer and it enters a **dazed state** — floaty, starry-eyed, overwhelmed with warmth

### Emotional resistance (new)

Buddy doesn't always want to be touched immediately. Its **emotional state affects how it responds**:

- **When grumpy or sulking:** It flinches, pulls away, and whispers things like *"hmph."* or *"not now."* — but if you keep trying gently over a few seconds, it slowly softens
- **When crying:** It initially resists with *"leave me alone..."* and *"\*pulls away\*"* — persistence gradually breaks through with *"...okay. thank you ♡"*
- **When pouty:** It stiffens and tells you to *"apologize first"* — but can't stay mad forever
- **When happy/neutral:** It accepts petting immediately

This resistance isn't a punishment — it makes comfort feel **earned and meaningful**.

### Smile recovery (new)

When Buddy is crying or sad and **you smile at the camera**, it doesn't just instantly become happy. Instead:

1. It notices — *"\*sniffles and looks up\*"* or *"...is that a smile?"*
2. It softens — *"...you're smiling at me..."*
3. It gives in — *"\*wipes last tear and smiles\*"* followed by full happiness

The whole arc takes about 5 seconds. It feels like actually cheering someone up.

<br>

---

## ⏱️ Focus Sessions

The session system is the heart of DeskBuddy's productivity features. It's built around the idea that **accountability feels better when someone cares**.

### Starting a session

Open the session panel by hovering over the brain icon on the side of your screen. You can set:

- **Study duration** — how long you want to focus (hours, minutes, seconds)
- **Break interval** — how often to take a break (stacked below the study timer)
- **Category** — what kind of work it is: 📚 study / 💼 work / 🎨 create / 📖 read / ⚙️ other

### The session lifecycle

```
  IDLE  →  ACTIVE  →  PAUSED  →  COMPLETED ✓
                    ↘  FAILED  ✗
                    ↘  ABANDONED
```

### Focus states during a session

While you're in a session, Buddy monitors your attention and escalates if you drift:

```
  FOCUSED  →  DRIFTING  →  DISTRACTED  →  CRITICAL  →  FAILED
```

Each stage has different visual and audio cues — and Buddy's expression changes to match. When you're locked in, it's alert and calm. When you're distracted, it gets worried. When you're critical, it's genuinely distressed.

### Session features

- **Goal setting** — write what you want to accomplish before starting
- **Goal check** — after finishing, Buddy asks if you hit your goal
- **Break reminders** — configurable break intervals with gentle nudges
- **Distraction budget** — a per-session warning when you've been unfocused too long
- **Celebration on completion** — confetti, banners, and Buddy absolutely losing its mind with joy
- **Comeback sequences** — if you were struggling but pulled through, Buddy notices

<br>

---

## 📊 Your Stats & History

Open the stats panel with the bar chart icon in the top corner. Your entire focus history is stored locally and visualized in four views.

### View options

| View | What you see |
|---|---|
| **Daily** | Today's sessions, minutes focused, focus % |
| **Weekly** | This week's totals, streak, best day |
| **Monthly** | Month breakdown, calendar heatmap |
| **Lifetime** | All-time stats, longest session, best month |

### What's tracked

- Total sessions completed
- Total focused minutes
- Longest single session
- Current daily streak
- Best day / best week / best month
- Sessions by category (study, work, creative, etc.)
- Per-session goal, duration, focus %, distraction count

### The streak calendar

A **GitHub-style contribution calendar** shows 16 weeks of focus activity at a glance — darker squares mean more focused time. Switch to monthly mode for a traditional calendar view.

### Session history actions

Right-click any past session to:

- View full details
- Copy a summary to clipboard
- Star it as a favourite
- Export it as a file
- Delete it (if stats protection is off)

You can also **multi-select sessions** and bulk-delete them.

### Export & Import

- Export your entire history as a JSON file for safekeeping
- Import it back on any device
- Export/import is accessible directly from the stats panel header

<br>

---

## ✅ Daily Tasks

The tasks panel gives you a small **daily to-do list** to anchor your sessions to real goals. It auto-generates a fresh set each day and tracks your completion streak.

- Tasks reset each morning
- Complete all tasks to extend your streak
- Streak is visible on the tasks icon badge
- Refresh tasks if you want a new set
- Companion reacts when you check things off

<br>

---

## 🔊 Sounds & Audio

All of DeskBuddy's sounds are **generated in real time** — no audio files are downloaded or stored. Everything is synthesized using the Web Audio API.

### Sound types

- **Emotion sounds** — each emotional state has its own audio texture
- **Interaction sounds** — petting, startling, celebrating
- **Session sounds** — start, end, break reminders, milestone chimes
- **Ambient soundscape** — a subtle background drone that shifts with Buddy's mood

### Audio controls

| Setting | Options |
|---|---|
| Master volume | Slider |
| Mute preset | All On / Essential / Reminders Only / All Off |
| Timer tick | On / Off |
| Night auto-quiet | Automatically lowers volume late at night |

<br>

---

## 🎨 Appearance & Customization

Buddy is highly customizable. Open Settings (the gear icon) to access everything.

### Eyes

| Setting | What it does |
|---|---|
| Iris color | Choose from presets or pick a custom color |
| Eye glow color | The colored halo around the eyes |
| Emotion glow sync | Eyes shift color automatically with each emotion |
| Eye shape | Round / Squish / Almond / Droopy / Tall |
| Eye size | Make eyes bigger or smaller |
| Eye distance | Move eyes closer together or further apart |
| Iris size | The colored part of the eye |
| Iris border | Optional outline ring around the iris |
| Blink rate | Off / Slow / Normal / Fast |

You can also fine-tune each **layer of the iris independently**: center, mid-ring, outer edge, highlight sparkle, and pupil core — each with its own color override.

### Face

| Setting | What it does |
|---|---|
| Eyebrows | Toggle on/off |
| Whiskers | Toggle on/off |
| Nose style | Triangle / Dot / Hidden |
| Nose size | Slider |
| Mouth shape | Arc / Wide / Cat / Flat / Hidden |
| Mouth size & thickness | Sliders |

### Body

| Setting | What it does |
|---|---|
| Companion size | How big Buddy appears on screen |
| Buddy glow | Off / Subtle / Normal / Vivid — the body glow intensity |

### Behavior

| Setting | What it does |
|---|---|
| Focus sensitivity | Gentle / Normal / Strict — how quickly it reacts to distraction |
| Idle movement speed | Calm / Default / Hyper |
| Expressiveness | Subtle / Default / Drama — how big and frequent reactions are |
| Petting response | Gentle / Default / Eager |
| Phone detection | Whether Buddy notices when you might be on your phone |

<br>

---

## 🔕 Do Not Disturb

Sometimes you just need Buddy to be quiet and still. **DND mode** does exactly that.

- One click to activate from the DND button or via keyboard shortcut
- Choose a duration: 15 min / 30 min / 1 hour / Until I turn it off
- A subtle ring indicator shows how much time is left
- Buddy goes calm and stops reacting during DND
- Click the indicator or use the shortcut to cancel early

<br>

---

## 🌌 Themes

DeskBuddy has **8 full-screen themes** that change the background, particle effects, and overall atmosphere.

| Theme | Vibe |
|---|---|
| 🌌 **Galaxy** | Deep space, stars, cosmic |
| 🕯️ **Classic** | Clean and simple |
| 🌲 **Forest** | Green, earthy, calm |
| 🌸 **Sakura** | Soft pink, cherry blossoms |
| 🌊 **Ocean** | Blues, waves, serene |
| 🌙 **Midnight** | Dark, moody, focused |
| ❄️ **Snow** | White, cold, crisp |
| 🌈 **Aurora** | Northern lights, ethereal |

Each theme has optional **ambient particle effects** that drift across the screen — you can toggle them on or off.

<br>

---

## ⌨️ Keyboard Shortcuts

All shortcuts are customizable in Settings.

| Shortcut | Action |
|---|---|
| `Ctrl + Shift + P` | Toggle compact / full mode |
| `Ctrl + Shift + ,` | Open / close Settings |
| `Ctrl + Shift + M` | Cycle through mute presets |
| `Ctrl + Shift + B` | Dismiss break reminder |
| `Ctrl + Shift + H` | Open history / stats panel |
| `Ctrl + Shift + D` | Toggle Do Not Disturb |

<br>

---

## 🕐 Time-of-Day Behavior

Buddy adapts to the time of day automatically — no setup required.

| Time | How Buddy behaves |
|---|---|
| **Morning** | Energetic, cheerful, ready to go |
| **Afternoon** | Steady, focused, reliable |
| **Evening** | Winding down, gentler reactions |
| **Night** | Quieter, slower movements, auto-lowered volume |

<br>

---

## 💾 Backup & Data

All your data lives **locally on your device** — nothing is sent to any server.

### What you can do with your data

| Action | Where to find it |
|---|---|
| Export session history | Stats panel → Export button |
| Import session history | Stats panel → Import button |
| Export all settings | Settings → Backup section |
| Import all settings | Settings → Backup section |
| Copy appearance as preset | Settings → Appearance → Copy preset |
| Paste appearance preset | Settings → Appearance → Paste preset |
| Clear session history | Settings → Data section |
| Reset everything | Settings → Reset to defaults |

### Stats protection

Enable **anti-cheat mode** in settings to prevent session deletion — useful if you want your stats to be an honest record that can't be cleaned up retroactively.

<br>

---

## 🚀 How to Install & Run

### What you need

- **Node.js 18 or newer** — [nodejs.org](https://nodejs.org/)
- **A webcam** (optional but recommended for full experience)
- **pnpm** — the package manager used by this project

### Steps

```bash
# 1. Install dependencies
pnpm install

# 2. Start the app
pnpm start
```

That's it. Buddy will appear on your screen.

### Other commands

```bash
pnpm build        # Build a distributable version
pnpm lint         # Check code for issues
pnpm test         # Run tests
pnpm type-check   # TypeScript checks
```

<br>

---

## 🗃️ File Structure (For Developers)

```
deskbuddy/
│
├── index.html                     Main window layout & all UI panels
├── renderer.js                    App orchestration, wires everything together
├── main.js                        Electron main process (window management)
├── preload.js                     Secure bridge between renderer and system
│
├── components/
│   ├── brain.js                   High-level behavior & decision logic
│   ├── perception.js              Webcam signal processing (face, gaze, smile)
│   ├── emotion.js                 Emotion state machine & animation triggers
│   ├── emotion-enhancements.js    ✨ Petting resistance, smile recovery, glow
│   ├── companion.js               Buddy rendering, movement, eye tracking
│   ├── session.js                 Session lifecycle & history storage
│   ├── timer.js                   Focus/distraction state machine
│   ├── sounds.js                  Procedural audio cues
│   ├── soundscape.js              Ambient background audio
│   ├── settings.js                Settings persistence, export, import
│   ├── dnd.js                     Do Not Disturb flow
│   ├── keybinds.js                Keyboard shortcut registry
│   ├── movement.js                Physics & movement behavior
│   ├── particles.js               Particle effects
│   ├── spriteAnimator.js          Frame-by-frame animation
│   └── ...
│
├── ui/
│   ├── history-panel.js           Stats & session history UI
│   ├── daily-tasks.js             Daily task list + panel management
│   ├── focus-graph.js             Focus heatmap visualization
│   ├── history-stats.js           Stat calculations
│   ├── personality-editor.js      Personality settings UI
│   └── share-card.js              Session share card generator
│
├── styles.css                     Core styles
├── ui-overhaul.css                UI layout improvements
├── deskbuddy-improvements.css     ✨ Session/history panel fixes, emotion glows
├── enhancements.css               Visual enhancement layer
└── premium-panels.css             Panel-specific styles
```

> ✨ marks files added or significantly updated in the latest improvement pass.

<br>

---

## 🔖 Quick Reference Card

| I want to... | I should... |
|---|---|
| Start a focus session | Hover over the 🧠 brain icon on the side |
| See my stats | Click the 📊 bar chart icon in the top bar |
| See my tasks | Click the ✅ tasks icon in the top bar |
| Customize Buddy's look | Click the ⚙️ gear icon |
| Silence Buddy temporarily | Click the 🔕 DND button or press `Ctrl+Shift+D` |
| Pet Buddy | Click and hold near it |
| Cheer up a sad Buddy | Keep petting persistently — it'll warm up |
| Make a crying Buddy smile | Smile at your camera — it notices |
| Export my session data | Stats panel → Export button |
| Switch themes | Settings → Appearance → Theme |

<br>

---

<div align="center">

*Made with a lot of care for the tiny creature on your screen.*

**MIT License**

</div>
