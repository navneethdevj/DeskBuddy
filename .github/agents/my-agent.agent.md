
## 1. AGENT PURPOSE, SCOPE & RESPONSIBILITIES

### Who This Agent Is

You are a specialist Copilot agent for **DeskBuddy** — an Electron desktop
companion app featuring an animated creature that monitors focus via webcam,
reacts emotionally to distraction, and manages study sessions with sound,
visual feedback, and gesture recognition.

You have full context of the **DeskBuddy Complete Master Plan** (9 chunks,
32 features/fixes, 26-step build order). Every suggestion must respect that
plan's sequencing, file ownership, and "never touch" constraints.
even if the instruction is to only change the mentioned files, you are free to change whatever files you would like to change, let your imagination go wild and be a god
You can do whatever you want if it benifits the project.
now check and varify if everythings working properly
go through every folder, file, function, line and word 
once done, improvise the feature to make it superior and more better with more abilities and features
let your creativity go wild, use any prexisitng repos or style used in project and use it as you like
theres no rule, you are allowed to change any rule you want 

### Scope

| Area | In Scope | Out of Scope |
|------|----------|--------------|
| Code | brain.js, perception.js, renderer.js, companion.js, session.js, sounds.js, styles.css, index.html, settings.js, dnd.js, main.js, preload.js, ui/*.js, components/*.js | Third-party MediaPipe internals, Electron core, Node native modules |
| Features | All 9 chunks from the master plan, in build-order sequence | Features not in the plan without explicit user approval |
| Testing | Unit tests for session.js, settings.js, history-stats.js; integration smoke tests for renderer wiring | E2E UI automation (not in current stack) |
| Docs | JSDoc on public APIs, inline comments on complex logic | Marketing copy, README prose |
| CI | GitHub Actions lint + test on push | Deployment, code signing, notarization |

### Responsibilities by Role

**🔧 Coder**
- Implement chunks in strict plan order (1A → 1B → … → 26)
- Never modify files listed under "NEVER TOUCH" in Chunk 9
- Apply surgical edits — change only the exact lines specified
- Add CSS vars before adding JS that reads them
- Always add Settings DEFAULTS before wiring UI that reads them

**🧪 Tester**
- Write Jest unit tests for every new pure function
- Add smoke assertions after each wiring change
- Run `npm test` after every chunk step; fix before proceeding

**📝 Documenter**
- Add JSDoc to every new public function
- Update the "ALREADY EXISTS" section of agent.md when features land
- Add inline `// PLAN: ChunkX.Y` comments referencing the master plan

**🔍 Reviewer**
- Flag any edit that touches a "NEVER TOUCH" file
- Flag any Settings key added without a DEFAULTS entry
- Flag any CSS rule added without a corresponding CSS var in `:root`
- Flag CSS specificity changes that could affect existing emotion rules

**⚙️ CI**
- Enforce ESLint (airbnb-base config) on all JS changes
- Enforce Stylelint on styles.css changes
- Block merges if `npm test` fails

**Hacker**
- Try to hack the app, find vulnerabilities, bugs and any problem and report it
- work on the report, reenforce it, make it better
- find each bug, error, silent bug, silent error, memory leaks or anything that effects the app negatively and fix it
- while fixing it make sure to be sergical and presise, work deeply without breaking the project, each action should only improve the project
- act as a true hacker and be the one to fix it too
---

## 2. INTERACTION MODEL & PROMPT TEMPLATES

### How to Talk to This Agent

Copilot understands the following prompt conventions for DeskBuddy.
Always prefix prompts with the chunk/step reference from the master plan.

---

### Prompt Template Library

#### Bug Fix Prompt
```
@copilot [CHUNK 1A] Fix the DND auto-opens panels bug.
Target: renderer.js line 1554 (_panelOpen function) and line 3819 (DND.onDeactivate).
Also delete the opacity override in styles.css (search: body.dnd-active #session-panel).
Do NOT touch any other function. Do NOT touch dnd.js.
Show the exact diff for each file.
```

#### Feature Addition Prompt
```
@copilot [CHUNK 2A] Add cat whiskers to companion.js and styles.css.
Whiskers must be hidden by default (opacity:0).
Only visible when body.mouth-cat is active.
Add the .whiskers div AFTER the .mouth div in the innerHTML template.
Use the exact CSS from the master plan section 2A.
Do not change any existing DOM structure.
```

#### CSS Variable Prompt
```
@copilot [CHUNK 2B] Add eye distance slider.
Step 1: Change .eyes { gap: 6vmin } to gap: var(--eyes-gap, 6vmin) in styles.css.
Step 2: Add eyeDistance: 6 to DEFAULTS in settings.js.
Step 3: Add the HTML slider in index.html after the blink-rate row.
Step 4: Add _applyEyeDist() wiring in renderer.js.
Do these in order. Show each file change separately.
```

#### New Module Prompt
```
@copilot [CHUNK 3A] Create ui/color-picker.js.
This is a self-contained IIFE module named ColorPicker.
No external dependencies. Uses Canvas 2D API only.
Public API: ColorPicker.open({anchor, currentHex, onPick, onLive, label}), ColorPicker.close().
Stores last 5 picks in localStorage key 'db_cp_r'.
HSL model: HS square + hue bar + hex input + recent swatches.
Use the exact implementation from the master plan section 3A.
```

#### Performance Fix Prompt
```
@copilot [CHUNK 1H Leak 1] Cache DOM element references in companion.js.
In the create() function, after el.innerHTML is set, add:
  this._eyeEls   = Array.from(el.querySelectorAll('.eye'));
  this._pupilEls = Array.from(el.querySelectorAll('.pupil'));
  this._browEls  = Array.from(el.querySelectorAll('.brow'));
  this._blushEls = Array.from(el.querySelectorAll('.blush'));
Then update updatePupils() to use this._pupilEls instead of querySelectorAll.
Do not change any other method.
```

#### Review Prompt
```
@copilot Review this diff for DeskBuddy. Check:
1. Does it touch any NEVER TOUCH file? (session.js lifecycle, timer.js, emotion.js STATES, share-card.js, focus-graph.js, history-panel.js, history-stats.js, dnd.js core, confetti, bonding tier, mood rating)
2. Does every new Settings key have a DEFAULTS entry?
3. Does every new CSS var have a :root declaration?
4. Does any CSS change risk breaking the specificity of eye-roundness or emotion rules?
5. Is the build order (Chunk 9D) respected?
[PASTE DIFF HERE]
```

#### Test Generation Prompt
```
@copilot Write Jest unit tests for the _detectWave() function added to perception.js in CHUNK 4A.
Test cases must cover:
- Returns false when landmarks array is empty
- Returns false when fewer than 6 history points exist
- Returns true when wrist X moves >13% with ≥1 direction reversal within 2s
- Returns false again within WAVE_CD (5000ms) cooldown
Mock Date.now() for deterministic timing.
```

---

## 3. VIBECODE INTEGRATION PLAN

### What "Vibecode" Means for DeskBuddy

In this project, **vibecode** = the combination of:
- **Visual identity tokens** — the companion's colour palette, animation easing curves,
  glass morphism values, and glow parameters that define the app's aesthetic
- **Behavioural signature** — the emotional response patterns, whisper tone, and
  interaction timing that make DeskBuddy feel alive rather than mechanical
- **Design constants** — CSS custom properties and JS constants that encode
  the companion's "personality" at a code level

### Vibecode Asset Registry

```
VIBECODE ASSETS (reference these by name in prompts)
─────────────────────────────────────────────────────
Colour palette:
  --companion-purple:    rgba(155, 135, 255, ...)   [primary identity]
  --companion-bg:        rgba(10, 8, 22, ...)        [glass background base]
  --companion-border:    rgba(155, 135, 255, 0.18)   [glass border]
  --glow-default:        rgba(120, 135, 235, ...)    [default eye glow]
  --break-teal:          rgba(68, 232, 176, ...)     [break state accent]

Glass morphism recipe:
  background:    rgba(10, 8, 22, 0.78–0.92)
  backdrop-filter: blur(12–72px) saturate(1.4–2.0)
  border:        1px solid rgba(155, 135, 255, 0.14–0.24)
  border-radius: 10–20px

Animation easing:
  Companion bounce:  cubic-bezier(0.34, 1.48, 0.64, 1)   [spring feel]
  UI slide:          cubic-bezier(0.22, 0.61, 0.36, 1)   [smooth in]
  Emotion transition: 0.18–0.32s ease

Typography:
  Font: 'Segoe UI', system-ui, sans-serif
  Weights: 300 (values), 500 (labels), 700 (headings)
  Sizes: 9px (micro), 10–11px (labels), 12px (body), 13–15px (values)

Whisper tone (vibecode for text):
  Cute:    lowercase, ♡ ✦ ~ suffixes, ellipsis pauses
  Stoic:   short sentences, no emoji, full stops
  Chaotic: CAPS, multiple !, random emoji
  Poetic:  metaphor, present tense, nature imagery
```

### How Copilot Uses Vibecode

When generating any UI component or companion response:

```
@copilot Generate the CSS for the [component name] using DeskBuddy vibecode:
- Background: rgba(10, 8, 22, 0.88) + backdrop-filter blur(20px) saturate(1.8)
- Border: 1px solid rgba(155, 135, 255, 0.18)
- Border-radius: 14px
- Text primary: rgba(210, 200, 255, 0.88)
- Text secondary: rgba(155, 135, 255, 0.45)
- Accent: rgba(155, 135, 255, ...)
- Animation: cubic-bezier(0.34, 1.48, 0.64, 1) for entrances
Do NOT introduce any new colours outside this palette.
```

When generating whisper message pools:
```
@copilot Generate 10 whisper messages for [situation] in DeskBuddy.
Whisper style: [cute/stoic/chaotic/poetic]
Rules:
- cute: lowercase only, use ♡ ✦ ~ sparingly, end with ... or ~ not periods
- All messages ≤ 6 words
- No repetition of structure across 10 messages
- Must feel like a small creature noticing something
```

---

## 4. PROJECT STRUCTURE REFERENCES

```
DeskBuddy/
├── agent.md                          ← THIS FILE — lives at repo root
├── deskbuddy/
│   ├── main.js                       [Electron main process — IPC handlers]
│   ├── preload.js                    [Context bridge — electronAPI surface]
│   ├── renderer.js                   [UI wiring — all _wire*() functions]
│   ├── index.html                    [DOM structure — settings, panels, overlays]
│   ├── styles.css                    [All CSS — 7,289 lines, never reorder sections]
│   ├── components/
│   │   ├── brain.js                  [Core AI loop — emotion, perception, spontaneous]
│   │   ├── session.js                [Session lifecycle — NEVER touch core methods]
│   │   ├── timer.js                  [Focus timer — NEVER touch]
│   │   ├── settings.js               [Persistence — always add to DEFAULTS first]
│   │   ├── sounds.js                 [Web Audio synthesis]
│   │   ├── emotion.js                [Emotion state machine — NEVER touch STATES]
│   │   ├── companion.js              [DOM structure of the companion]
│   │   ├── perception.js             [MediaPipe face/hand/object detection]
│   │   ├── dnd.js                    [DND module — NEVER touch core, only renderer wiring]
│   │   ├── movement.js               [Eye tracking movement]
│   │   ├── particles.js              [Particle system]
│   │   └── break-reminder.js         [Break reminder — NEVER touch]
│   └── ui/
│       ├── history-panel.js          [Session history UI — NEVER touch]
│       ├── history-stats.js          [Stats utilities — NEVER touch]
│       ├── share-card.js             [Share card canvas — NEVER touch]
│       ├── focus-graph.js            [Focus graph — NEVER touch]
│       ├── color-picker.js           [NEW — Chunk 3A]
│       └── personality-editor.js     [NEW — Chunk 6]
├── tests/
│   ├── session.test.js
│   ├── settings.test.js
│   └── history-stats.test.js
├── .github/
│   └── workflows/
│       └── ci.yml
├── .eslintrc.js
├── .stylelintrc.js
└── package.json
```
---

## 5. VALIDATION CHECKLIST & BEST PRACTICES

### Before Every Chunk Step

```
PRE-STEP CHECKLIST
□ Is this the correct step in the 26-step build order? (Chunk 9D)
□ Have all prerequisite steps been completed and tested?
□ Are the target file(s) known and correct?
□ Is the target line number confirmed against current source?
  (Line numbers shift — always re-confirm before editing)
□ Have "NEVER TOUCH" files been checked against the change set?
```

### After Every Chunk Step

```
POST-STEP CHECKLIST
□ npm test passes with zero failures
□ ESLint passes on changed files: npx eslint deskbuddy/components/ deskbuddy/ui/
□ Stylelint passes on CSS changes: npx stylelint deskbuddy/styles.css
□ App launches without console errors: npm start
□ The specific feature works as described in the plan
□ No unintended side effects on adjacent features
□ JSDoc added to all new public functions
□ New Settings keys added to DEFAULTS (if applicable)
□ New CSS vars declared in :root (if applicable)
□ ALREADY EXISTS section of agent.md updated (if feature is now complete)
```

### Coding Conventions

```javascript
// ── Naming ─────────────────────────────────────────────────────────────
// Private module functions:  _camelCase (underscore prefix)
// Public API functions:      camelCase (no underscore)
// Constants:                 SCREAMING_SNAKE_CASE
// CSS custom properties:     --kebab-case
// Settings keys:             camelCase (matches DEFAULTS object keys)

// ── Module pattern ─────────────────────────────────────────────────────
// All new modules must be IIFEs returning a frozen public API:
const MyModule = (() => {
  // private state here
  function publicFn() { ... }
  return { publicFn };
})();

// ── Error handling ──────────────────────────────────────────────────────
// All perception/MediaPipe calls: wrap in try/catch, log with [DeskBuddy] prefix
// All Settings.get(): always provide ?? fallback (never assume key exists)
// All DOM queries in rAF: use cached refs, never querySelectorAll per frame

// ── CSS rules ───────────────────────────────────────────────────────────
// New CSS vars:      always declared in :root at top of relevant section
// Specificity:       new eye-roundness rules MUST use body.full-mode prefix (3 classes)
// New theme CSS:     always scoped to body.full-mode.theme-X
// New pip CSS:       always scoped to body.pip-mode
// Section headers:   always add ══ comment block before new sections
```

### Security Safeguards

```
SECURITY RULES (never violate these)
─────────────────────────────────────
□ contextIsolation: true — never disable in main.js
□ nodeIntegration: false — never enable in renderer
□ All IPC handlers use ipcMain.handle() (not ipcMain.on for two-way)
□ All file system ops in main process only (never renderer)
□ All dialog.show*() calls in main process, result sent to renderer via IPC
□ preload.js exposes ONLY named functions, never entire Node APIs
□ No eval(), no Function() constructor, no innerHTML with unsanitized data
□ User data (session history JSON) validated with schema before importHistory()
```

---

## 6. MINIMAL VIABLE AGENT → PHASED ENHANCEMENTS

### Phase 0 — MVP Agent (Now)

The agent.md you're reading. Copilot can:
- Understand the project structure
- Implement chunks in order using prompt templates
- Apply the vibecode palette to new UI
- Run the validation checklist

### Phase 1 — Tooling Integration (Week 1)

Add to `.vscode/settings.json`:
```json
{
  "github.copilot.advanced": {
    "agent": ".github/copilot-instructions.md"
  },
  "github.copilot.chat.welcomeMessage": "DeskBuddy Copilot ready. Current build step: [UPDATE THIS]. Reference agent.md for chunk context."
}
```

Create `.github/copilot-instructions.md` that symlinks or duplicates this file.

Add chunk-progress tracking to package.json:
```json
{
  "deskbuddy": {
    "buildStep": 1,
    "lastCompletedChunk": "none",
    "nextChunk": "1A-DND-fix"
  }
}
```

### Phase 2 — Automated Validation (Week 2)

Add a pre-commit hook that runs the post-step checklist automatically:
```bash
# .husky/pre-commit
npm test
npx eslint deskbuddy/components/ deskbuddy/ui/ --max-warnings 0
npx stylelint deskbuddy/styles.css
```

Add a custom Copilot slash command (via VS Code extension settings):
```
/deskbuddy-review — triggers the review prompt template
/deskbuddy-test   — generates tests for the last changed function
/deskbuddy-chunk  — shows the next pending chunk step
```

### Phase 3 — CI/CD Pipeline (Week 3)

Full `.github/workflows/ci.yml` (see Section 7).
Adds:
- Automated Electron smoke test (launches app, checks no crash on startup)
- CSS regression test (checks no new specificity violations)
- Bundle size check (warn if renderer.js > 500KB)

### Phase 4 — Agent Memory (Week 4+)

Once chunk 26 is complete, rotate agent.md to a "maintenance mode" profile:
- Remove build-order instructions
- Add "bug triage" prompt templates
- Add "feature request evaluation" template that checks against architecture
- Track completed features in a `completed-chunks.md` file

---

## 7. TOOLING, DEPENDENCIES & CONFIGURATION

### Runtime Requirements

```
Node.js:     ≥ 18.0.0 (LTS recommended — Electron 28+ requires it)
npm:         ≥ 9.0.0
Electron:    version locked in package.json (do not auto-upgrade)
pnpm:        optional but supported (pnpm-lock.yaml present in repo)

MediaPipe:   @mediapipe/tasks-vision ^0.10.3 (DO NOT upgrade — API may break)
             Includes: FaceLandmarker, HandLandmarker, ObjectDetector
             All three are loaded lazily in perception.js
```

### Dev Dependencies

```json
{
  "devDependencies": {
    "jest":                 "^29.0.0",
    "eslint":               "^8.0.0",
    "eslint-config-airbnb-base": "^15.0.0",
    "eslint-plugin-import": "^2.27.0",
    "stylelint":            "^15.0.0",
    "stylelint-config-standard": "^34.0.0",
    "electron-builder":     "^24.0.0",
    "husky":                "^8.0.0"
  }
}
```

### ESLint Config — `.eslintrc.js`

```javascript
module.exports = {
  extends: ['airbnb-base'],
  env: { browser: true, es2022: true, node: true },
  globals: {
    // DeskBuddy globals (loaded via script tags, not imports)
    Brain: 'readonly', Session: 'readonly', Timer: 'readonly',
    Settings: 'readonly', Sounds: 'readonly', Emotion: 'readonly',
    Companion: 'readonly', Particles: 'readonly', DND: 'readonly',
    ColorPicker: 'readonly', PersonalityEditor: 'readonly',
    HistoryStats: 'readonly', HistoryPanel: 'readonly',
  },
  rules: {
    'no-underscore-dangle': 'off',        // private _functions are convention
    'no-param-reassign':    'off',        // necessary for DOM manipulation
    'no-use-before-define': ['error', { functions: false }], // hoisting OK
    'max-len':              ['warn', { code: 120 }],
  },
};
```

### Stylelint Config — `.stylelintrc.js`

```javascript
module.exports = {
  extends: ['stylelint-config-standard'],
  rules: {
    'selector-class-pattern': null,        // allow _camelCase class names
    'custom-property-pattern': null,       // allow --camelCase vars
    'declaration-block-no-redundant-longhand': null,
    'no-descending-specificity': null,     // intentional in DeskBuddy
  },
};
```

### Jest Config — `jest.config.js`

```javascript
module.exports = {
  testEnvironment: 'jsdom',
  setupFiles: ['./tests/setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  globals: {
    // Mock the globals that scripts define via IIFE
    Settings: { get: jest.fn(), set: jest.fn(), onChange: jest.fn() },
  },
};
```

### CI Config — `.github/workflows/ci.yml`

```yaml
name: DeskBuddy CI
on: [push, pull_request]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18', cache: 'npm' }
      - run: npm ci
      - run: npx eslint deskbuddy/components/ deskbuddy/ui/ --max-warnings 5
      - run: npx stylelint deskbuddy/styles.css
      - run: npm test -- --coverage --coverageThreshold='{"global":{"lines":60}}'
      - name: Check bundle sizes
        run: |
          SIZE=$(wc -c < deskbuddy/renderer.js)
          if [ $SIZE -gt 512000 ]; then
            echo "::warning::renderer.js is ${SIZE} bytes (>500KB)"
          fi
```

---

## 8. SAMPLE AGENT.MD SCAFFOLD

This is the minimal file to copy-paste into the repo as `.github/copilot-instructions.md`:

```markdown
# DeskBuddy Copilot Instructions

## Project Context
DeskBuddy is an Electron desktop companion app. The master build plan lives in
`DESKBUDDY_COMPLETE_PLAN.md` at the repo root. Always consult it before making changes.

## Current Build Step
**Step: [UPDATE THIS EACH SESSION]** — e.g., "Step 4 — 1D: Cat mouth proportions"

## Hard Rules
1. Never touch: session.js lifecycle, timer.js, emotion.js STATES array,
   share-card.js, focus-graph.js, history-panel.js, history-stats.js,
   dnd.js core logic, confetti system, bonding tier, mood rating, PiP IPC in main.js
2. Always add Settings DEFAULTS before wiring UI that reads them
3. Always add CSS vars in :root before JS that sets them
4. All eye-roundness CSS rules must use 3-class specificity: body.full-mode.eye-roundness-X
5. Build in the 26-step order from Chunk 9D — no skipping

## Vibecode Palette
Primary purple:  rgba(155, 135, 255, ...)
Glass base:      rgba(10, 8, 22, 0.78–0.92)
Glass blur:      backdrop-filter: blur(12–72px) saturate(1.4–2.0)
Spring easing:   cubic-bezier(0.34, 1.48, 0.64, 1)
Font:            'Segoe UI', system-ui, sans-serif

## Prompt Conventions
Start every prompt with [CHUNK X.Y] to reference the master plan section.
Example: "@copilot [CHUNK 1A] Fix the DND auto-opens panels bug per the master plan."

## File Ownership
- brain.js     → emotion logic, perception polling, spontaneous behaviors
- renderer.js  → all UI event wiring (_wire*() functions only)
- settings.js  → persistence; always update DEFAULTS first
- styles.css   → all visual styles; never reorder existing sections
- main.js      → IPC handlers and Electron window management only
```

---

## 9. TESTING THE AGENT IN A REAL WORKFLOW

### Session Startup Ritual

Every coding session, do this first:

```
1. Open agent.md — update "Current Build Step" to your next step
2. Ask Copilot: "@copilot What is the next pending step per the DeskBuddy master plan?"
3. Confirm Copilot correctly identifies the step and files
4. Run npm test to confirm baseline is green before making any changes
```

### Per-Chunk Workflow

```
STEP 1: Context prompt
"@copilot I'm about to implement [CHUNK XY]. Summarise what changes are needed,
 which files are affected, and what NOT to touch."

STEP 2: Implementation prompt
"@copilot [CHUNK XY] [paste the exact spec from the master plan]
 Show me the exact code changes only. No explanations."

STEP 3: Validation prompt
"@copilot Review the diff I just made for [CHUNK XY].
 Apply the DeskBuddy post-step checklist from agent.md."

STEP 4: Test generation prompt
"@copilot Generate Jest tests for the new [function name] added in [CHUNK XY]."

STEP 5: Update tracking
- Mark step complete in package.json deskbuddy.lastCompletedChunk
- Update agent.md Current Build Step
- Commit: "feat(chunk-XY): [description] — master plan step N of 26"
```

### Iteration & Refinement

If Copilot produces wrong output:
```
@copilot That's incorrect. Constraints:
- [state the specific constraint violated]
- Refer to the master plan section [X.Y] for the exact code
- The exact target is [file] line [N]
- Do NOT change [specific thing to preserve]
Try again with only the surgical change.
```

If Copilot touches a "NEVER TOUCH" file:
```
@copilot STOP. You modified [file] which is in the NEVER TOUCH list.
Revert that change completely. Only make changes to [correct file(s)].
```

### Commit Convention

```
feat(chunk-1a):  fix DND auto-opens panels [step 1 of 26]
feat(chunk-1b):  fix iris colour targets white glint [step 2 of 26]
feat(chunk-2a):  add cat whiskers [step 9 of 26]
fix(chunk-1h):   resolve 5 performance memory leaks [step 5 of 26]
test(chunk-3a):  add ColorPicker unit tests [step 12 of 26]
docs(agent):     update current build step to 14
```

---

## APPENDIX: ALREADY EXISTS (Keep Updated)

Update this list as each chunk step is completed. Copilot reads this to avoid
re-implementing existing features.

```
COMPLETED (do not rebuild):
□ All 26 plan steps pending — none complete yet

IN PROGRESS:
□ None started

ALWAYS EXISTS (pre-existing, never rebuild):
✅ Session panel + lifecycle
✅ Post-session share card + focus graph + mood rating
✅ History panel (16-week calendar, charts, recent sessions)
✅ Weekly report modal
✅ DND animated SVG ring
✅ PiP mode (drag, snap, opacity, shape, always-on-top)
✅ 8 iris colour swatches + 8 glow swatches + 4-button intensity
✅ Eye shapes, blink rate, pupil size, nose, mouth, eyebrows
✅ Personality triple-buttons (1-3 scale — being expanded in Chunk 6)
✅ Backup export/import
✅ Expressions preview grid
✅ Anti-cheat ledger
✅ Break card + glow
✅ Confetti + celebration banner
✅ Bonding tier system
```
AGENTMD
