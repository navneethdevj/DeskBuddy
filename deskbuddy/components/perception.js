/**
 * Perception — iris gaze, attention score, expression signals.
 *
 * Iris gaze math from:
 *   https://github.com/arnaudlvq/Eye-Contact-RealTime-Detection
 *   https://github.com/Asadullah-Dal17/Eyes-Position-Estimator-Mediapipe
 *
 * Attention scoring from:
 *   https://github.com/adithya-s-k/EyeOnTask
 *
 * Expression detection concept from:
 *   https://github.com/justadudewhohacks/face-api.js
 *   (NOT installed — implemented via MediaPipe blendshapes)
 *
 * Writes window.perception every 66ms (~15Hz matching camera FPS).
 *
 * window.perception = {
 *   facePresent,
 *   headYaw, headPitch,
 *   gazeX, gazeY,         — -1 to +1 iris offset (Eye Contact Detection math)
 *   eyeContact,           — true when iris centered in eye socket
 *   eyeContactScore,      — 0-1 confidence
 *   eyeOpenness,          — 0=closed 1=open
 *   smileScore,           — 0-1
 *   surpriseScore,        — 0-1
 *   userSmiling,          — boolean
 *   userSurprised,        — boolean
 *   faceX, faceY,         — 0-1 normalized face position on screen
 *   headMovement,         — pixel delta of nose tip between frames
 *   attentionScore,       — 0-100 (EyeOnTask concept)
 *   userState,            — 'Focused'|'LookingAway'|'Sleepy'|'NoFace'
 *   timeInStateMs
 * }
 */
const Perception = (() => {

  const EVAL_MS           = 66;
  const DEBOUNCE_MS       = 1000;
  const SLEEPY_CONFIRM_MS = 3000;
  const NOFACE_CONFIRM_MS = 3000;
  const LOOKING_AWAY_YAW  = 20;

  // From Eyes Position Estimator repo — iris offset beyond this = not looking at camera
  const EYE_CONTACT_THRESHOLD = 0.28;

  // From EyeOnTask repo — attention score rise/fall rates
  // Score rises faster when head is forward AND iris is centered (true attention)
  const ATTN_GAIN_CONTACT = 2.5;  // focused + eye contact
  const ATTN_GAIN_FOCUSED = 1.0;  // focused, no direct eye contact
  const ATTN_DECAY        = 0.8;  // distracted or looking away
  const ATTN_DECAY_NOFACE = 1.6;  // faster decay when face gone entirely

  // From face-api.js expression concept — thresholds for smile and surprise
  const SMILE_THRESHOLD    = 0.45;
  const SURPRISE_THRESHOLD = 0.50;

  // EMA (Exponential Moving Average) — smooths noisy MediaPipe signals
  // Higher alpha = more responsive; lower = smoother.
  // At 15Hz eval rate, alpha 0.35 gives ~300ms convergence to 88%.
  const EMA_ALPHA_FACE = 0.35;
  const EMA_ALPHA_GAZE = 0.40;
  let emaFaceX = 0.5, emaFaceY = 0.5;
  let emaGazeX = 0,   emaGazeY = 0;
  let emaInitialized = false;

  let candidateState = 'NoFace', candidateStart = 0;
  let confirmedState = 'NoFace', stateEntryTime  = Date.now();
  let sleepyMs = 0, nofaceMs = 0, lastEvalTime = Date.now();
  let prevNoseX = null, prevNoseY = null;
  let attentionScore = 50;

  // Initialize immediately so consumers never see undefined
  window.perception = {
    facePresent: false, headYaw: 0, headPitch: 0,
    gazeX: 0, gazeY: 0, eyeContact: false, eyeContactScore: 0,
    eyeOpenness: 1, smileScore: 0, surpriseScore: 0,
    userSmiling: false, userSurprised: false,
    faceX: 0.5, faceY: 0.5, headMovement: 0,
    attentionScore: 50, userState: 'NoFace', timeInStateMs: 0
  };

  function init() {
    setInterval(_evaluate, EVAL_MS);
  }

  function _evaluate() {
    const now = Date.now();
    const dt  = now - lastEvalTime;
    lastEvalTime = now;

    const r   = window.faceResults;
    const has = r?.faceLandmarks?.length > 0;

    if (!has) { _handleNoFace(dt, now); return; }
    nofaceMs = 0;
    _processLandmarks(r, dt, now);
  }

  function _handleNoFace(dt, now) {
    nofaceMs += dt;
    sleepyMs  = 0;
    prevNoseX = null; prevNoseY = null;
    emaInitialized = false;
    // Attention decays faster when completely gone — from EyeOnTask logic
    attentionScore = Math.max(0, attentionScore - ATTN_DECAY_NOFACE);

    _write({ facePresent: false, headYaw: 0, headPitch: 0,
             gazeX: 0, gazeY: 0, eyeContact: false, eyeContactScore: 0,
             eyeOpenness: 1, smileScore: 0, surpriseScore: 0,
             userSmiling: false, userSurprised: false,
             faceX: 0.5, faceY: 0.5, headMovement: 0,
             attentionScore: Math.round(attentionScore) });
    _transition(nofaceMs >= NOFACE_CONFIRM_MS ? 'NoFace' : confirmedState, now);
  }

  function _processLandmarks(r, dt, now) {
    const lm = r.faceLandmarks[0];
    const bs = r.faceBlendshapes?.[0]?.categories ?? [];
    const mx = r.facialTransformationMatrixes?.[0]?.data ?? null;

    // Head pose from 4x4 transformation matrix (standard MediaPipe approach)
    let yaw = 0, pitch = 0;
    if (mx) {
      yaw   = Math.atan2(mx[8],  mx[10]) * (180 / Math.PI);
      pitch = Math.atan2(-mx[9], Math.sqrt(mx[8]*mx[8] + mx[10]*mx[10])) * (180 / Math.PI);
    }

    // Eye openness from blink blendshapes
    const blinkL      = _bs(bs, 'eyeBlinkLeft');
    const blinkR      = _bs(bs, 'eyeBlinkRight');
    const eyeOpenness = 1 - (blinkL + blinkR) / 2;

    // ── IRIS GAZE (Eye Contact Detection + Eyes Position Estimator) ──────────
    // landmark indices confirmed from MediaPipe face mesh map:
    //   Left eye:  outer=33, inner=133, iris center=468, upper lid=159, lower lid=145
    //   Right eye: outer=362, inner=263, iris center=473, upper lid=386, lower lid=374
    // Formula from repos: offset = (iris_center - eye_center) / eye_width
    // Amplify x4 because raw offset is tiny (~0.0 to 0.25 range)
    const { gazeX, gazeY, eyeContactScore } = _computeIrisGaze(lm);
    const eyeContact = eyeContactScore > (1 - EYE_CONTACT_THRESHOLD);

    // ── EXPRESSIONS (face-api.js concept via MediaPipe blendshapes) ─────────
    // face-api classifies: happy=mouth corners up, surprised=jaw open + eyes wide
    const smileScore    = (_bs(bs,'mouthSmileLeft') + _bs(bs,'mouthSmileRight')) / 2;
    const surpriseScore = _bs(bs,'jawOpen')*0.6 + _bs(bs,'eyeWideLeft')*0.2 + _bs(bs,'eyeWideRight')*0.2;

    // Face center from nose tip (landmark 4)
    const nose = lm[4];
    const rawFaceX = nose?.x ?? 0.5;
    const rawFaceY = nose?.y ?? 0.5;

    // Head movement delta (px) — uses RAW (un-smoothed) nose for responsiveness
    let headMovement = 0;
    if (prevNoseX !== null && nose) {
      const dx = (nose.x - prevNoseX) * window.innerWidth;
      const dy = (nose.y - prevNoseY) * window.innerHeight;
      headMovement = Math.sqrt(dx*dx + dy*dy);
    }
    if (nose) { prevNoseX = nose.x; prevNoseY = nose.y; }

    // EMA smooth face position and iris gaze to remove MediaPipe jitter
    if (!emaInitialized) {
      emaFaceX = rawFaceX; emaFaceY = rawFaceY;
      emaGazeX = gazeX;    emaGazeY = gazeY;
      emaInitialized = true;
    } else {
      emaFaceX += (rawFaceX - emaFaceX) * EMA_ALPHA_FACE;
      emaFaceY += (rawFaceY - emaFaceY) * EMA_ALPHA_FACE;
      emaGazeX += (gazeX    - emaGazeX) * EMA_ALPHA_GAZE;
      emaGazeY += (gazeY    - emaGazeY) * EMA_ALPHA_GAZE;
    }
    const faceX = emaFaceX;
    const faceY = emaFaceY;

    // Sleepy accumulator
    eyeOpenness < 0.25 ? (sleepyMs += dt) : (sleepyMs = Math.max(0, sleepyMs - dt * 0.5));

    // ── ATTENTION SCORE (EyeOnTask logic) ────────────────────────────────────
    // Key insight from EyeOnTask: true attention requires BOTH head forward AND eye contact.
    // Just having head forward (looking at screen corner) scores lower.
    const headForward = Math.abs(yaw) < 15 && eyeOpenness > 0.40;
    if      (headForward && eyeContact) attentionScore = Math.min(100, attentionScore + ATTN_GAIN_CONTACT);
    else if (headForward)               attentionScore = Math.min(100, attentionScore + ATTN_GAIN_FOCUSED);
    else                                attentionScore = Math.max(0,   attentionScore - ATTN_DECAY);

    _write({
      facePresent: true, headYaw: yaw, headPitch: pitch,
      gazeX: emaGazeX, gazeY: emaGazeY, eyeContact, eyeContactScore,
      eyeOpenness, smileScore, surpriseScore,
      userSmiling:   smileScore    > SMILE_THRESHOLD,
      userSurprised: surpriseScore > SURPRISE_THRESHOLD,
      faceX, faceY, headMovement,
      attentionScore: Math.round(attentionScore)
    });

    let candidate;
    if      (sleepyMs >= SLEEPY_CONFIRM_MS)    candidate = 'Sleepy';
    else if (Math.abs(yaw) > LOOKING_AWAY_YAW) candidate = 'LookingAway';
    else                                        candidate = 'Focused';
    _transition(candidate, now);
  }

  // ── IRIS GAZE FORMULA ─────────────────────────────────────────────────────
  // Source: https://github.com/arnaudlvq/Eye-Contact-RealTime-Detection
  // Source: https://github.com/Asadullah-Dal17/Eyes-Position-Estimator-Mediapipe
  //
  // Core formula: gazeX = (iris_x - eye_center_x) / eye_width * amplify
  // Eye contact score = 1.0 when iris perfectly centered, 0.0 at extreme edge
  function _computeIrisGaze(lm) {
    // Landmark indices from MediaPipe face mesh
    const leftOuter  = lm[33],  leftInner  = lm[133], leftIris  = lm[468];
    const rightOuter = lm[362], rightInner = lm[263],  rightIris = lm[473];

    if (!leftIris || !rightIris) return { gazeX: 0, gazeY: 0, eyeContactScore: 0.5 };

    // Left eye horizontal offset
    const lEyeW  = Math.abs(leftInner.x  - leftOuter.x)  || 0.001;
    const lCtrX  = (leftOuter.x  + leftInner.x)  / 2;
    const lGazeX = (leftIris.x  - lCtrX)  / lEyeW;

    // Right eye horizontal offset
    const rEyeW  = Math.abs(rightInner.x - rightOuter.x) || 0.001;
    const rCtrX  = (rightOuter.x + rightInner.x) / 2;
    const rGazeX = (rightIris.x - rCtrX)  / rEyeW;

    // Average both eyes, amplify x4 (raw values are tiny ~0.0-0.25)
    const gazeX = Math.max(-1, Math.min(1, ((lGazeX + rGazeX) / 2) * 4));

    // Vertical offset using upper/lower lid landmarks (159=upper, 145=lower)
    const lTop  = lm[159]?.y ?? leftIris.y;
    const lBot  = lm[145]?.y ?? leftIris.y;
    const lEyeH = Math.abs(lBot - lTop) || 0.001;
    const lMidY = (lTop + lBot) / 2;
    const gazeY = Math.max(-1, Math.min(1, ((leftIris.y - lMidY) / lEyeH) * 4));

    // Eye contact: 1.0 = iris centered, 0.0 = looking at edge
    const eyeContactScore = Math.max(0, 1 - Math.sqrt(gazeX*gazeX + gazeY*gazeY));
    return { gazeX, gazeY, eyeContactScore };
  }

  function _write(signals) {
    Object.assign(window.perception, signals);
    window.perception.timeInStateMs = Date.now() - stateEntryTime;
  }

  function _transition(candidate, now) {
    if (candidate !== candidateState) { candidateState = candidate; candidateStart = now; }
    if ((now - candidateStart) >= DEBOUNCE_MS && candidate !== confirmedState) {
      confirmedState = candidate; stateEntryTime = now;
    }
    window.perception.userState     = confirmedState;
    window.perception.timeInStateMs = now - stateEntryTime;
  }

  function _bs(cats, name) {
    return cats.find(c => c.categoryName === name)?.score ?? 0;
  }

  return { init };
})();
