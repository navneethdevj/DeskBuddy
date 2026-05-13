/**
 * Perception — iris gaze, attention score, expression signals,
 *              wave gesture detection, multi-face social state, head tilt.
 *
 * Iris gaze math from:
 *   https://github.com/arnaudlvq/Eye-Contact-RealTime-Detection
 *   https://github.com/Asadullah-Dal17/Eyes-Position-Estimator-Mediapipe
 *     — multi-landmark iris center (all 5 per eye for robustness)
 *     — iris-to-eye-corner ratio for horizontal + vertical gaze
 *
 * Head-pose compensated gaze from:
 *   https://github.com/tensorsense/LaserGaze
 *     — 3D gaze vector concept: subtract head rotation component from
 *       raw iris offset to isolate actual gaze direction
 *
 * Eye visibility weighting from:
 *   https://github.com/brownhci/WebGazer
 *     — when head turns, weight the camera-facing eye higher
 *
 * Attention scoring from:
 *   https://github.com/adithya-s-k/EyeOnTask
 *
 * Wave gesture detection:
 *   — HandLandmarker wrist X-position history
 *   — Directional reversal analysis with temporal smoothing
 *   — Cooldown gate + movement range validation
 *   — Anti-false-positive: elevation check + noise threshold
 *
 * Multi-face temporal smoothing:
 *   — Mode-of-buffer approach (15-frame rolling window)
 *   — Requires 8 consecutive stable frames before committing count change
 *
 * Signal smoothing via One Euro Filter:
 *   https://cristal.univ-lille.fr/~casiez/1euro/
 *
 * Writes window.perception every 66ms (~15Hz matching camera FPS).
 *
 * window.perception = {
 *   facePresent,
 *   headYaw, headPitch, headTiltAngle,  ← headTiltAngle = roll in degrees
 *   gazeX, gazeY,
 *   eyeContact, eyeContactScore,
 *   eyeOpenness,
 *   smileScore, surpriseScore,
 *   userSmiling, userSurprised,
 *   faceX, faceY, headMovement,
 *   attentionScore,
 *   userState, timeInStateMs,
 *   faceCount,           ← temporally smoothed face count
 *   multiPersonPresent,  ← true when faceCount >= 2
 *   handPresent,         ← any hand detected this frame
 *   handCount,           ← number of hands (0–2)
 *   waveDetected,        ← single-frame pulse — true for exactly one eval cycle
 * }
 */
const Perception = (() => {

  const EVAL_MS           = 66;
  const DEBOUNCE_MS       = 350;
  const SLEEPY_CONFIRM_MS = 1800;
  const NOFACE_CONFIRM_MS = 1000;
  const LOOKING_AWAY_YAW  = 20;

  const EYE_CONTACT_THRESHOLD = 0.28;

  const ATTN_GAIN_CONTACT = 3.2;
  const ATTN_GAIN_FOCUSED = 1.4;
  const ATTN_DECAY        = 1.2;
  const ATTN_DECAY_NOFACE = 2.2;

  const SMILE_THRESHOLD    = 0.42;
  const SURPRISE_THRESHOLD = 0.40;
  const SMILE_CONFIRM_FRAMES    = 2;
  const SURPRISE_CONFIRM_FRAMES = 2;

  const EAR_BLINK_THRESHOLD  = 0.21;
  const EAR_SLEEPY_THRESHOLD = 0.24;
  const EAR_DEFAULT_OPEN     = 0.30;

  const BIAS_LEARN_RATE = 0.005;
  const BIAS_MAX        = 0.25;
  let gazeBiasX = 0, gazeBiasY = 0;

  // ── One Euro Filter ─────────────────────────────────────────────────────────
  function _createOneEuro(minCutoff, beta, dCutoff) {
    let xPrev = null, dxPrev = 0, tPrev = null;
    function _alpha(cutoff, dt) {
      const tau = 1.0 / (2 * Math.PI * cutoff);
      return 1.0 / (1.0 + tau / dt);
    }
    return {
      filter(x, t) {
        if (tPrev === null) { xPrev = x; tPrev = t; dxPrev = 0; return x; }
        const dt = Math.max(t - tPrev, 1e-6);
        const dx = (x - xPrev) / dt;
        const edx = _alpha(dCutoff, dt);
        const dxHat = edx * dx + (1 - edx) * dxPrev;
        const cutoff = minCutoff + beta * Math.abs(dxHat);
        const a = _alpha(cutoff, dt);
        const xHat = a * x + (1 - a) * xPrev;
        xPrev = xHat; dxPrev = dxHat; tPrev = t;
        return xHat;
      },
      reset() { xPrev = null; tPrev = null; dxPrev = 0; }
    };
  }

  const filterFaceX = _createOneEuro(1.0, 0.5, 1.0);
  const filterFaceY = _createOneEuro(1.0, 0.5, 1.0);
  const filterGazeX = _createOneEuro(1.5, 0.7, 1.0);
  const filterGazeY = _createOneEuro(1.5, 0.7, 1.0);

  const FILTER_RESET_GRACE_MS = 3000;
  let lastFaceSeenTime = 0;

  let candidateState = 'NoFace', candidateStart = 0;
  let confirmedState = 'NoFace', stateEntryTime  = Date.now();
  let sleepyMs = 0, nofaceMs = 0, lastEvalTime = Date.now();
  let prevNoseX = null, prevNoseY = null;
  let attentionScore = 50;

  let _smileConfirmCount    = 0;
  let _surpriseConfirmCount = 0;

  // ── Multi-face temporal smoothing ───────────────────────────────────────────
  // Mode of a rolling buffer + streak requirement prevents single-frame spikes
  const FACE_BUFFER_SIZE   = 15;
  const FACE_STABLE_FRAMES = 8;
  let _faceCountBuffer      = [];
  let _stableFaceCount      = 0;
  let _faceStreakValue       = 0;
  let _faceStreak            = 0;

  function _updateFaceCount(rawCount) {
    _faceCountBuffer.push(rawCount);
    if (_faceCountBuffer.length > FACE_BUFFER_SIZE) _faceCountBuffer.shift();

    // Mode: most frequent value in buffer
    const freq = {};
    for (const c of _faceCountBuffer) freq[c] = (freq[c] || 0) + 1;
    let mode = 0, maxF = 0;
    for (const [val, cnt] of Object.entries(freq)) {
      if (cnt > maxF) { maxF = cnt; mode = parseInt(val, 10); }
    }

    // Streak counting — require N consecutive frames of same mode
    if (mode === _faceStreakValue) {
      _faceStreak++;
    } else {
      _faceStreakValue = mode;
      _faceStreak = 1;
    }

    if (_faceStreak >= FACE_STABLE_FRAMES && mode !== _stableFaceCount) {
      _stableFaceCount = mode;
    }

    return _stableFaceCount;
  }

  // ── Wave gesture detection ─────────────────────────────────────────────────
  // Wrist X-position history with directional reversal analysis.
  // Anti-false-positive: elevation check, noise floor, range guard, cooldown.
  const WAVE_WINDOW_MS      = 1600;  // analyse last 1.6 s
  const WAVE_MIN_RANGE      = 0.10;  // minimum X-range (10% of frame width)
  const WAVE_MIN_REVERSALS  = 3;     // need ≥ 3 direction changes
  const WAVE_NOISE_FLOOR    = 0.006; // ignore movements smaller than this
  const WAVE_ELEV_Y         = 0.72;  // wrist must be in upper 72% of frame
  const WAVE_COOLDOWN_MS    = 5000;  // 5 s between wave detections
  const WAVE_HAND_OPEN_MIN  = 0.04;  // index tip ≥ this above wrist (hand upright)

  let _waveHistory          = [];    // [{x, t}]
  let _waveLastDetectedAt   = 0;

  // ── Phone confidence — multi-signal rolling state ──────────────────────────
  // Smoothed confidence accumulates over time to prevent single-frame spikes.
  // _phoneEma: exponential moving average of the raw per-frame score (0–95).
  // _phoneHitBuffer: rolling 8-slot boolean — how many recent frames saw "cell phone".
  // _phonePersistMs: continuous ms above detection threshold (anti-flicker gate).
  let _phoneEma           = 0;
  let _phoneHitBuffer     = [];       // rolling array of boolean hits — one slot per OBJ frame
  const PHONE_HIT_WINDOW  = 24;       // 24 eval-cycles @ 15fps ÷ 3 cycles-per-obj-frame = 8 obj-frames = 1.6 s
  const PHONE_EMA_ALPHA   = 0.25;     // smoothing factor — higher = faster response
  let _phoneLastObjResults = null;    // deduplicate: only push to buffer when objResults pointer changes

  function _detectWave(handResults, now) {
    if (!handResults?.landmarks?.length) {
      // Brief hand dropout — preserve history but don't add new point
      return false;
    }

    if (now - _waveLastDetectedAt < WAVE_COOLDOWN_MS) return false;

    const hand     = handResults.landmarks[0];
    const wrist    = hand[0];
    const indexTip = hand[8];

    if (!wrist || !indexTip) return false;

    // Elevation check — hand must be raised (y=0 is top in normalized coords)
    if (wrist.y > WAVE_ELEV_Y) return false;

    // Upright check — index tip should be above wrist (not resting face-down)
    if (indexTip.y > wrist.y - WAVE_HAND_OPEN_MIN) return false;

    // Record wrist X in time-stamped history
    _waveHistory.push({ x: wrist.x, t: now });

    // Trim entries outside the time window
    const windowStart = now - WAVE_WINDOW_MS;
    _waveHistory = _waveHistory.filter(p => p.t >= windowStart);

    // Need enough data points (at minimum ~4 frames at 10 FPS)
    if (_waveHistory.length < 6) return false;

    // Range gate — must have moved enough to qualify as a wave
    const xs    = _waveHistory.map(p => p.x);
    const range = Math.max(...xs) - Math.min(...xs);
    if (range < WAVE_MIN_RANGE) return false;

    // Count directional reversals, ignoring sub-noise movements
    let reversals = 0;
    let lastDir   = 0;
    for (let i = 1; i < _waveHistory.length; i++) {
      const dx = _waveHistory[i].x - _waveHistory[i - 1].x;
      if (Math.abs(dx) < WAVE_NOISE_FLOOR) continue;  // noise floor
      const dir = dx > 0 ? 1 : -1;
      if (lastDir !== 0 && dir !== lastDir) reversals++;
      lastDir = dir;
    }

    if (reversals >= WAVE_MIN_REVERSALS) {
      _waveLastDetectedAt = now;
      _waveHistory = [];  // reset — clean slate after confirmed wave
      return true;
    }

    return false;
  }

  // ── window.perception defaults ──────────────────────────────────────────────
  window.perception = {
    facePresent: false, headYaw: 0, headPitch: 0, headTiltAngle: 0,
    gazeX: 0, gazeY: 0, eyeContact: false, eyeContactScore: 0,
    eyeOpenness: 1, smileScore: 0, surpriseScore: 0,
    userSmiling: false, userSurprised: false,
    faceX: 0.5, faceY: 0.5, headMovement: 0,
    attentionScore: 50, userState: 'NoFace', timeInStateMs: 0,
    faceCount: 0, multiPersonPresent: false,
    handPresent: false, handCount: 0, waveDetected: false,
    phoneConfidence: 0, phoneDetected: false,
  };

  // ── Main evaluation loop ────────────────────────────────────────────────────

  function init() {
    setInterval(_evaluate, EVAL_MS);
  }

  function _evaluate() {
    const now = Date.now();
    const dt  = now - lastEvalTime;
    lastEvalTime = now;

    // Clear single-frame flags at the START of each cycle
    window.perception.waveDetected = false;

    const r   = window.faceResults;
    const has = r?.faceLandmarks?.length > 0;

    // ── Hand / wave state ─────────────────────────────────────────────────────
    // Always evaluate hand data regardless of face state
    _evaluateHands(now);

    if (!has) { _handleNoFace(dt, now); }
    else      { _processLandmarks(r, dt, now); }

    // ── Phone confidence — runs every eval cycle regardless of face state ─────
    // Uses cached window.objResults (populated by camera.js at 5 fps).
    _updatePhoneConfidence();
  }

  function _evaluateHands(now) {
    const hr = window.handResults;
    const handCount = hr?.landmarks?.length ?? 0;

    window.perception.handPresent = handCount > 0;
    window.perception.handCount   = handCount;

    if (handCount > 0 && window.handAvailable) {
      const waveDetected = _detectWave(hr, now);
      if (waveDetected) {
        window.perception.waveDetected = true;
      }
    } else if (!window.handAvailable) {
      // HandLandmarker not ready — keep fields at safe defaults
      window.perception.handPresent = false;
      window.perception.handCount   = 0;
    }
  }

  function _handleNoFace(dt, now) {
    nofaceMs += dt;
    sleepyMs  = 0;
    _smileConfirmCount    = 0;
    _surpriseConfirmCount = 0;
    prevNoseX = null; prevNoseY = null;

    if (now - lastFaceSeenTime > FILTER_RESET_GRACE_MS) {
      filterFaceX.reset(); filterFaceY.reset();
      filterGazeX.reset(); filterGazeY.reset();
    }

    attentionScore = Math.max(0, attentionScore - ATTN_DECAY_NOFACE);

    // Update face count with 0
    const stableFaceCount = _updateFaceCount(0);

    _write({
      facePresent: false, headYaw: 0, headPitch: 0, headTiltAngle: 0,
      gazeX: 0, gazeY: 0, eyeContact: false, eyeContactScore: 0,
      eyeOpenness: 1, smileScore: 0, surpriseScore: 0,
      userSmiling: false, userSurprised: false,
      faceX: 0.5, faceY: 0.5, headMovement: 0,
      attentionScore: Math.round(attentionScore),
      faceCount: stableFaceCount,
      multiPersonPresent: stableFaceCount >= 2,
    });
    _transition(nofaceMs >= NOFACE_CONFIRM_MS ? 'NoFace' : confirmedState, now);
  }

  function _processLandmarks(r, dt, now) {
    lastFaceSeenTime = now;
    const lm = r.faceLandmarks[0];
    const bs = r.faceBlendshapes?.[0]?.categories ?? [];
    const mx = r.facialTransformationMatrixes?.[0]?.data ?? null;

    // ── Head pose from 4×4 transformation matrix ──────────────────────────────
    // Column-major layout: mx[col*4 + row]
    // Rxx=mx[0] Rxy=mx[4] Rxz=mx[8]
    // Ryx=mx[1] Ryy=mx[5] Ryz=mx[9]
    // Rzx=mx[2] Rzy=mx[6] Rzz=mx[10]
    let yaw = 0, pitch = 0, roll = 0;
    if (mx) {
      yaw   = Math.atan2(mx[8],  mx[10]) * (180 / Math.PI);
      pitch = Math.atan2(-mx[9], Math.sqrt(mx[8] * mx[8] + mx[10] * mx[10])) * (180 / Math.PI);
      // Roll (Z): head tilt left/right — atan2(-Ryx, Rxx)
      roll  = Math.atan2(-mx[1], mx[0]) * (180 / Math.PI);
    }

    // ── Eye openness — fuse blendshape + EAR ──────────────────────────────────
    const blinkL     = _bs(bs, 'eyeBlinkLeft');
    const blinkR     = _bs(bs, 'eyeBlinkRight');
    const bsOpenness = 1 - (blinkL + blinkR) / 2;

    const earL = _computeEAR(lm, [33, 160, 158, 133, 153, 144]);
    const earR = _computeEAR(lm, [362, 385, 387, 263, 373, 380]);
    const earAvg = (earL + earR) / 2;
    const earOpenness = earAvg > EAR_SLEEPY_THRESHOLD ? 1.0
                      : earAvg > EAR_BLINK_THRESHOLD  ? (earAvg - EAR_BLINK_THRESHOLD) / (EAR_SLEEPY_THRESHOLD - EAR_BLINK_THRESHOLD)
                      : 0.0;
    const eyeOpenness = Math.min(bsOpenness, earOpenness);

    // ── Iris gaze ──────────────────────────────────────────────────────────────
    const { gazeX, gazeY, eyeContactScore } = _computeIrisGaze(lm, yaw, pitch);
    const eyeContact = eyeContactScore > (1 - EYE_CONTACT_THRESHOLD);

    // ── Expressions ───────────────────────────────────────────────────────────
    const smileScore    = (_bs(bs, 'mouthSmileLeft') + _bs(bs, 'mouthSmileRight')) / 2;
    const surpriseScore = _bs(bs, 'jawOpen') * 0.6 + _bs(bs, 'eyeWideLeft') * 0.2 + _bs(bs, 'eyeWideRight') * 0.2;

    _smileConfirmCount    = smileScore    > SMILE_THRESHOLD    ? Math.min(_smileConfirmCount    + 1, SMILE_CONFIRM_FRAMES)    : Math.max(0, _smileConfirmCount    - 1);
    _surpriseConfirmCount = surpriseScore > SURPRISE_THRESHOLD ? Math.min(_surpriseConfirmCount + 1, SURPRISE_CONFIRM_FRAMES) : Math.max(0, _surpriseConfirmCount - 1);
    const userSmiling   = _smileConfirmCount    >= SMILE_CONFIRM_FRAMES;
    const userSurprised = _surpriseConfirmCount >= SURPRISE_CONFIRM_FRAMES;

    // ── Face position ──────────────────────────────────────────────────────────
    const nose    = lm[4];
    const rawFaceX = nose?.x ?? 0.5;
    const rawFaceY = nose?.y ?? 0.5;

    let headMovement = 0;
    if (prevNoseX !== null && nose) {
      const dx = (nose.x - prevNoseX) * window.innerWidth;
      const dy = (nose.y - prevNoseY) * window.innerHeight;
      headMovement = Math.sqrt(dx * dx + dy * dy);
    }
    if (nose) { prevNoseX = nose.x; prevNoseY = nose.y; }

    const tSec = now / 1000;
    const faceX = filterFaceX.filter(rawFaceX, tSec);
    const faceY = filterFaceY.filter(rawFaceY, tSec);

    // ── Sleepy accumulator ─────────────────────────────────────────────────────
    const isReadingPosture = pitch > 10;
    if (!isReadingPosture) {
      const sleepyThreshold = earAvg < EAR_SLEEPY_THRESHOLD ? 0.35 : 0.25;
      eyeOpenness < sleepyThreshold ? (sleepyMs += dt) : (sleepyMs = Math.max(0, sleepyMs - dt * 0.5));
    } else {
      sleepyMs = Math.max(0, sleepyMs - dt * 0.5);
    }

    // ── Attention score ────────────────────────────────────────────────────────
    const headForward = Math.abs(yaw) < 15 && eyeOpenness > 0.40;
    if      (headForward && eyeContact) attentionScore = Math.min(100, attentionScore + ATTN_GAIN_CONTACT);
    else if (headForward)               attentionScore = Math.min(100, attentionScore + ATTN_GAIN_FOCUSED);
    else                                attentionScore = Math.max(0,   attentionScore - ATTN_DECAY);

    // ── Gaze filtering + bias correction ──────────────────────────────────────
    const smoothGazeX = filterGazeX.filter(gazeX, tSec);
    const smoothGazeY = filterGazeY.filter(gazeY, tSec);

    if (confirmedState === 'Focused' && headForward && eyeOpenness > 0.5) {
      gazeBiasX += (smoothGazeX - gazeBiasX) * BIAS_LEARN_RATE;
      gazeBiasY += (smoothGazeY - gazeBiasY) * BIAS_LEARN_RATE;
      gazeBiasX = Math.max(-BIAS_MAX, Math.min(BIAS_MAX, gazeBiasX));
      gazeBiasY = Math.max(-BIAS_MAX, Math.min(BIAS_MAX, gazeBiasY));
    }
    const correctedGazeX = smoothGazeX - gazeBiasX;
    const correctedGazeY = smoothGazeY - gazeBiasY;

    // ── Multi-face count (raw = all detected faces this frame) ─────────────────
    const rawFaceCount   = r.faceLandmarks.length;
    const stableFaceCount = _updateFaceCount(rawFaceCount);

    // ── Head tilt angle — clamped & smoothed for companion mirror ─────────────
    // Roll can be noisy; clamp to ±35° (head never tilts more than this naturally)
    const headTiltAngle = Math.max(-35, Math.min(35, roll));

    _write({
      facePresent: true, headYaw: yaw, headPitch: pitch,
      headTiltAngle,
      gazeX: correctedGazeX, gazeY: correctedGazeY, eyeContact, eyeContactScore,
      eyeOpenness, smileScore, surpriseScore,
      userSmiling, userSurprised,
      faceX, faceY, headMovement,
      attentionScore: Math.round(attentionScore),
      faceCount: stableFaceCount,
      multiPersonPresent: stableFaceCount >= 2,
    });

    let candidate;
    if      (sleepyMs >= SLEEPY_CONFIRM_MS)    candidate = 'Sleepy';
    else if (Math.abs(yaw) > LOOKING_AWAY_YAW) candidate = 'LookingAway';
    else                                        candidate = 'Focused';
    _transition(candidate, now);
  }

  // ── EAR (Eye Aspect Ratio) ──────────────────────────────────────────────────
  function _computeEAR(lm, indices) {
    const p1 = lm[indices[0]], p2 = lm[indices[1]], p3 = lm[indices[2]];
    const p4 = lm[indices[3]], p5 = lm[indices[4]], p6 = lm[indices[5]];
    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return EAR_DEFAULT_OPEN;
    const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    const v1   = dist(p2, p6);
    const v2   = dist(p3, p5);
    const h    = dist(p1, p4);
    if (h < 1e-6) return 0.3;
    return (v1 + v2) / (2 * h);
  }

  // ── Multi-landmark iris center ──────────────────────────────────────────────
  function _avgLandmarks(lm, indices) {
    let x = 0, y = 0, count = 0;
    for (let i = 0; i < indices.length; i++) {
      const pt = lm[indices[i]];
      if (pt) { x += pt.x; y += pt.y; count++; }
    }
    if (count === 0) return null;
    return { x: x / count, y: y / count };
  }

  function _avgY(lm, indices) {
    let y = 0, count = 0;
    for (let i = 0; i < indices.length; i++) {
      const pt = lm[indices[i]];
      if (pt) { y += pt.y; count++; }
    }
    return count > 0 ? y / count : 0.5;
  }

  // ── Iris gaze formula ───────────────────────────────────────────────────────
  function _computeIrisGaze(lm, headYaw, headPitch) {
    const lIris = _avgLandmarks(lm, [468, 469, 470, 471, 472]);
    const rIris = _avgLandmarks(lm, [473, 474, 475, 476, 477]);
    if (!lIris || !rIris) return { gazeX: 0, gazeY: 0, eyeContactScore: 0.5 };

    const leftOuter  = lm[33],  leftInner  = lm[133];
    const rightOuter = lm[362], rightInner = lm[263];

    const lEyeW  = Math.abs(leftInner.x  - leftOuter.x)  || 0.001;
    const lCtrX  = (leftOuter.x  + leftInner.x)  / 2;
    const lGazeX = (lIris.x - lCtrX) / lEyeW;

    const rEyeW  = Math.abs(rightInner.x - rightOuter.x) || 0.001;
    const rCtrX  = (rightOuter.x + rightInner.x) / 2;
    const rGazeX = (rIris.x - rCtrX) / rEyeW;

    const yawBias = Math.max(-1, Math.min(1, (headYaw || 0) / 30));
    const wLeft   = 0.5 + yawBias * 0.3;
    const wRight  = 1 - wLeft;
    let rawGazeX  = lGazeX * wLeft + rGazeX * wRight;

    const lTopY = _avgY(lm, [159, 160, 161]);
    const lBotY = _avgY(lm, [145, 144, 153]);
    const lEyeH = Math.abs(lBotY - lTopY) || 0.001;
    const lMidY = (lTopY + lBotY) / 2;
    const lGazeY = (lIris.y - lMidY) / lEyeH;

    const rTopY = _avgY(lm, [386, 385, 384]);
    const rBotY = _avgY(lm, [374, 373, 380]);
    const rEyeH = Math.abs(rBotY - rTopY) || 0.001;
    const rMidY = (rTopY + rBotY) / 2;
    const rGazeY = (rIris.y - rMidY) / rEyeH;

    let rawGazeY = lGazeY * wLeft + rGazeY * wRight;

    const HEAD_COMP_X = 0.012;
    const HEAD_COMP_Y = 0.008;
    rawGazeX -= (headYaw   || 0) * HEAD_COMP_X;
    rawGazeY -= (headPitch || 0) * HEAD_COMP_Y;

    const gazeX = Math.max(-1, Math.min(1, rawGazeX * 4));
    const gazeY = Math.max(-1, Math.min(1, rawGazeY * 4));
    const eyeContactScore = Math.max(0, 1 - Math.sqrt(gazeX * gazeX + gazeY * gazeY));
    return { gazeX, gazeY, eyeContactScore };
  }

  // ── State helpers ───────────────────────────────────────────────────────────

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

  // ── Phone confidence — true multi-signal pipeline ──────────────────────────
  //
  // Signal weights (max total 95):
  //   1. Object detection  — 45  (EfficientDet "cell phone" hit, score-scaled)
  //   2. Gaze + posture    — 20  (head bowed AND gaze down — combined only)
  //   3. Spatial proximity — 20  (phone bounding-box near face centroid)
  //   4. Inactivity        — 10  (no keyboard/mouse for 8 s)
  //
  // Signals 2-4 are SUPPORTING signals — they never independently trigger
  // detection. Signal 1 (object) is the primary gate.
  //
  // _phoneEma: EMA of raw per-cycle score → damps flicker.
  // _phoneHitBuffer: rolling hit-rate of object detections → temporal evidence.
  // Final phoneConfidence = EMA-smoothed output, 0–95.
  // phoneDetected = phoneConfidence >= 45  (requires solid object evidence).

  function _updatePhoneConfidence() {
    const p       = window.perception;
    const objs    = window.objResults || [];

    // ── Signal 1: object detection (weight 45) ──────────────────────────────
    let raw = 0;

    const phoneHit = objs.find(d =>
      d.categories?.some(c => c.categoryName === 'cell phone' && c.score > 0.25)
    );

    // Only push to hit buffer when objResults has actually changed (camera runs at 5fps,
    // perception at 15fps — without dedup each detection gets triple-counted).
    const currentObjs = window.objResults;
    if (currentObjs !== _phoneLastObjResults) {
      _phoneLastObjResults = currentObjs;
      _phoneHitBuffer.push(!!phoneHit);
      if (_phoneHitBuffer.length > PHONE_HIT_WINDOW) _phoneHitBuffer.shift();
    }

    // Hit rate: fraction of recent cycles that had a detection
    const hitRate = _phoneHitBuffer.filter(Boolean).length / _phoneHitBuffer.length;

    if (phoneHit) {
      const sc = phoneHit.categories.find(c => c.categoryName === 'cell phone')?.score || 0;
      // Score-scale to 0–45; multiply by hit-rate for temporal persistence
      raw += Math.min(45, Math.round(sc / 0.40 * 45) * hitRate);

      // ── Signal 3: spatial proximity (weight 20) ─────────────────────────
      // Require phone bounding-box center within 0.30 of face centroid.
      // Suppresses TVs / monitors / background rectangles.
      if (p.facePresent && phoneHit.boundingBox) {
        const bb  = phoneHit.boundingBox;
        const vid = document.getElementById('camera-feed');
        const vW  = vid?.videoWidth  || 640;
        const vH  = vid?.videoHeight || 480;
        const bx  = (bb.originX + bb.width  / 2) / vW;
        const by  = (bb.originY + bb.height / 2) / vH;
        const dist = Math.hypot(bx - (p.faceX || 0.5), by - (p.faceY || 0.5));
        if (dist < 0.30) raw += 20;
        // Partial credit for objects in the lower-central region (phone held below face)
        else if (dist < 0.55 && by > (p.faceY || 0.5)) raw += 8;
      }
    } else {
      // Rapid decay when no object detected — don't let stale confidence linger
      raw = 0;
    }

    // ── Signal 2: gaze + posture (weight 20) ────────────────────────────────
    // Both conditions must hold: head bowed AND iris gaze downward.
    // This signal STRENGTHENS object evidence — never independently fires.
    // gazeY > 0.25 = iris looking downward (positive = downward in our coords).
    if (p.facePresent && p.headPitch > 15 && p.gazeY > 0.25) {
      raw += 20;
    }

    // ── Signal 4: inactivity (weight 10) ────────────────────────────────────
    // Keyboard + mouse silence for 8 s → slightly more likely to be on phone.
    // Gentle boost only — cannot carry the score above threshold alone.
    const tKey   = window._lastKeyTime   || 0;
    const tMouse = window._lastMouseTime || 0;
    const silence = Date.now() - Math.max(tKey, tMouse);
    if (silence > 8000) raw += 10;

    // ── EMA smoothing ───────────────────────────────────────────────────────
    // Alpha 0.25: new value contributes 25%, previous 75% → ~4-cycle lag.
    // When raw drops to 0 (phone gone), faster decay: alpha 0.40.
    const alpha = raw === 0 ? 0.40 : PHONE_EMA_ALPHA;
    _phoneEma   = alpha * raw + (1 - alpha) * _phoneEma;

    // Clamp and write
    const conf = Math.min(95, Math.round(_phoneEma));
    window.perception.phoneConfidence = conf;
    // Detection threshold = 45: requires solid object signal + at least one support signal.
    // Hysteresis: once detected, hold until confidence drops below 30 (prevents flicker).
    const wasDetected = window.perception.phoneDetected;
    window.perception.phoneDetected = wasDetected
      ? conf >= 30    // hysteresis low threshold — holds detection state
      : conf >= 45;   // entry threshold — requires solid evidence
  }

  return { init };
})();
