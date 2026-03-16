/**
 * Perception — iris gaze, attention score, expression signals.
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
 *     — when head turns, weight the camera-facing eye higher for
 *       more reliable gaze estimation at angles
 *
 * Attention scoring from:
 *   https://github.com/adithya-s-k/EyeOnTask
 *
 * Expression detection concept from:
 *   https://github.com/justadudewhohacks/face-api.js
 *   (NOT installed — implemented via MediaPipe blendshapes)
 *
 * Signal smoothing via One Euro Filter:
 *   https://cristal.univ-lille.fr/~casiez/1euro/
 *   Adaptive low-pass: heavy smoothing when still (no jitter), light when
 *   moving fast (low latency). Standard in AR/VR face tracking pipelines.
 *
 * Writes window.perception every 66ms (~15Hz matching camera FPS).
 *
 * window.perception = {
 *   facePresent,
 *   headYaw, headPitch,
 *   gazeX, gazeY,         — -1 to +1 iris offset (head-pose compensated)
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
  const SURPRISE_THRESHOLD = 0.65;

  // === EAR (Eye Aspect Ratio) — Eyes-Position-Estimator approach ===
  // https://github.com/Asadullah-Dal17/Eyes-Position-Estimator-Mediapipe
  // EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|) where p1-p6 are eye boundary landmarks.
  // Lower EAR = more closed eye. More reliable than blendshapes alone for blink detection.
  // Typical EAR range: ~0.15 (fully closed) to ~0.35 (wide open)
  const EAR_BLINK_THRESHOLD = 0.21;   // below this = blink / closed
  const EAR_SLEEPY_THRESHOLD = 0.24;  // below this for sustained period = sleepy
  const EAR_DEFAULT_OPEN = 0.30;      // fallback when landmarks are missing

  // === Adaptive gaze bias correction — WebGazer calibration concept ===
  // https://github.com/brownhci/WebGazer
  // Track mean gaze offset during confirmed "Focused" state and subtract it.
  // This corrects for individual webcam position / head pose differences.
  const BIAS_LEARN_RATE   = 0.005;  // slow adaptation to avoid overcorrection
  const BIAS_MAX          = 0.25;   // maximum correction magnitude
  let gazeBiasX = 0, gazeBiasY = 0;

  // ── One Euro Filter ─────────────────────────────────────────────────────
  // Ref: https://cristal.univ-lille.fr/~casiez/1euro/
  // Adaptively smooths noisy tracking signals: heavy filtering when still
  // (eliminates jitter), light filtering when moving fast (reduces latency).
  // Used in face-api.js pipelines, AR face filters, and VR hand tracking.
  //
  // minCutoff: minimum cutoff freq (Hz) — lower = smoother when still
  // beta:      speed coefficient — higher = faster response to movement
  // dCutoff:   derivative cutoff freq — smooths the speed estimate itself
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

  // Face position filters — low minCutoff for jitter-free stillness
  const filterFaceX = _createOneEuro(1.0, 0.5, 1.0);
  const filterFaceY = _createOneEuro(1.0, 0.5, 1.0);
  // Iris gaze filters — slightly more responsive (higher minCutoff)
  const filterGazeX = _createOneEuro(1.5, 0.7, 1.0);
  const filterGazeY = _createOneEuro(1.5, 0.7, 1.0);

  // Grace period: don't reset filters on brief face dropout.
  // Typical MediaPipe dropout is 1–3 frames (~66–200ms). Keeping the filter
  // state means re-acquisition smoothly transitions from the last position.
  const FILTER_RESET_GRACE_MS = 3000;
  let lastFaceSeenTime = 0;

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
    // Only reset filters after prolonged absence — brief dropouts keep
    // smooth state so re-acquisition doesn't cause a position jump.
    if (now - lastFaceSeenTime > FILTER_RESET_GRACE_MS) {
      filterFaceX.reset(); filterFaceY.reset();
      filterGazeX.reset(); filterGazeY.reset();
    }
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
    lastFaceSeenTime = now;
    const lm = r.faceLandmarks[0];
    const bs = r.faceBlendshapes?.[0]?.categories ?? [];
    const mx = r.facialTransformationMatrixes?.[0]?.data ?? null;

    // Head pose from 4x4 transformation matrix (standard MediaPipe approach)
    let yaw = 0, pitch = 0;
    if (mx) {
      yaw   = Math.atan2(mx[8],  mx[10]) * (180 / Math.PI);
      pitch = Math.atan2(-mx[9], Math.sqrt(mx[8]*mx[8] + mx[10]*mx[10])) * (180 / Math.PI);
    }

    // Eye openness — fuse blendshape + geometric EAR for robustness
    // Blendshapes alone can miss partial blinks; EAR catches them geometrically.
    const blinkL      = _bs(bs, 'eyeBlinkLeft');
    const blinkR      = _bs(bs, 'eyeBlinkRight');
    const bsOpenness  = 1 - (blinkL + blinkR) / 2;

    // === EAR (Eye Aspect Ratio) — Eyes-Position-Estimator approach ===
    // Geometric measure: more reliable than blendshapes for partial blinks
    const earL = _computeEAR(lm, [33, 160, 158, 133, 153, 144]);   // left eye
    const earR = _computeEAR(lm, [362, 385, 387, 263, 373, 380]);  // right eye
    const earAvg = (earL + earR) / 2;
    const earOpenness = earAvg > EAR_SLEEPY_THRESHOLD ? 1.0
                      : earAvg > EAR_BLINK_THRESHOLD  ? (earAvg - EAR_BLINK_THRESHOLD) / (EAR_SLEEPY_THRESHOLD - EAR_BLINK_THRESHOLD)
                      : 0.0;
    // Fuse: take the minimum (most conservative = catches both blendshape and geometric blinks)
    const eyeOpenness = Math.min(bsOpenness, earOpenness);

    // ── IRIS GAZE (multi-repo enhanced) ─────────────────────────────────────
    // Eyes-Position-Estimator: all 5 iris landmarks for robust center
    // WebGazer: yaw-based eye weighting (camera-facing eye more reliable)
    // LaserGaze: head-pose compensation (separate gaze from head rotation)
    const { gazeX, gazeY, eyeContactScore } = _computeIrisGaze(lm, yaw, pitch);
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

    // One Euro Filter — adaptive smoothing removes jitter when still,
    // stays responsive during fast head movement (no manual alpha tuning)
    const tSec = now / 1000;
    const faceX = filterFaceX.filter(rawFaceX, tSec);
    const faceY = filterFaceY.filter(rawFaceY, tSec);

    // Sleepy accumulator — uses fused openness (blendshape + EAR)
    // EAR-based threshold catches drooping eyelids that blendshapes sometimes miss
    const sleepyThreshold = earAvg < EAR_SLEEPY_THRESHOLD ? 0.35 : 0.25;
    eyeOpenness < sleepyThreshold ? (sleepyMs += dt) : (sleepyMs = Math.max(0, sleepyMs - dt * 0.5));

    // ── ATTENTION SCORE (EyeOnTask logic) ────────────────────────────────────
    // Key insight from EyeOnTask: true attention requires BOTH head forward AND eye contact.
    // Just having head forward (looking at screen corner) scores lower.
    const headForward = Math.abs(yaw) < 15 && eyeOpenness > 0.40;
    if      (headForward && eyeContact) attentionScore = Math.min(100, attentionScore + ATTN_GAIN_CONTACT);
    else if (headForward)               attentionScore = Math.min(100, attentionScore + ATTN_GAIN_FOCUSED);
    else                                attentionScore = Math.max(0,   attentionScore - ATTN_DECAY);

    // Filter iris gaze with One Euro too
    const smoothGazeX = filterGazeX.filter(gazeX, tSec);
    const smoothGazeY = filterGazeY.filter(gazeY, tSec);

    // === Adaptive gaze bias correction (WebGazer calibration concept) ===
    // During confirmed Focused state, the user is likely looking at the screen.
    // Track the mean gaze offset and subtract it to correct for individual
    // webcam position / head pose differences over time.
    if (confirmedState === 'Focused' && headForward && eyeOpenness > 0.5) {
      gazeBiasX += (smoothGazeX - gazeBiasX) * BIAS_LEARN_RATE;
      gazeBiasY += (smoothGazeY - gazeBiasY) * BIAS_LEARN_RATE;
      gazeBiasX = Math.max(-BIAS_MAX, Math.min(BIAS_MAX, gazeBiasX));
      gazeBiasY = Math.max(-BIAS_MAX, Math.min(BIAS_MAX, gazeBiasY));
    }
    const correctedGazeX = smoothGazeX - gazeBiasX;
    const correctedGazeY = smoothGazeY - gazeBiasY;

    _write({
      facePresent: true, headYaw: yaw, headPitch: pitch,
      gazeX: correctedGazeX, gazeY: correctedGazeY, eyeContact, eyeContactScore,
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

  // ── EAR (Eye Aspect Ratio) ────────────────────────────────────────────
  // Source: https://github.com/Asadullah-Dal17/Eyes-Position-Estimator-Mediapipe
  // EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
  // where indices = [p1, p2, p3, p4, p5, p6] (outer, upper-outer, upper-inner, inner, lower-inner, lower-outer)
  // Lower EAR = more closed eye. Geometric measure — robust to lighting changes.
  function _computeEAR(lm, indices) {
    const p1 = lm[indices[0]], p2 = lm[indices[1]], p3 = lm[indices[2]];
    const p4 = lm[indices[3]], p5 = lm[indices[4]], p6 = lm[indices[5]];
    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return EAR_DEFAULT_OPEN;

    const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    const vertical1 = dist(p2, p6);
    const vertical2 = dist(p3, p5);
    const horizontal = dist(p1, p4);
    if (horizontal < 1e-6) return 0.3;
    return (vertical1 + vertical2) / (2 * horizontal);
  }

  // ── MULTI-LANDMARK IRIS CENTER ─────────────────────────────────────────
  // Source: https://github.com/Asadullah-Dal17/Eyes-Position-Estimator-Mediapipe
  // Average all landmarks in a set for robust center estimation.
  // Using 5 iris points instead of 1 eliminates single-frame jitter.
  function _avgLandmarks(lm, indices) {
    let x = 0, y = 0, count = 0;
    for (let i = 0; i < indices.length; i++) {
      const pt = lm[indices[i]];
      if (pt) { x += pt.x; y += pt.y; count++; }
    }
    if (count === 0) return null;
    return { x: x / count, y: y / count };
  }

  // Average only the Y coordinate of multiple landmarks — used for vertical
  // eye boundary estimation with multiple eyelid points for stability.
  function _avgY(lm, indices) {
    let y = 0, count = 0;
    for (let i = 0; i < indices.length; i++) {
      const pt = lm[indices[i]];
      if (pt) { y += pt.y; count++; }
    }
    return count > 0 ? y / count : 0.5;
  }

  // ── IRIS GAZE FORMULA (enhanced) ───────────────────────────────────────
  // Sources:
  //   Eyes-Position-Estimator — all 5 iris landmarks per eye for robust center
  //     https://github.com/Asadullah-Dal17/Eyes-Position-Estimator-Mediapipe
  //   WebGazer — yaw-based eye weighting (camera-facing eye is more reliable)
  //     https://github.com/brownhci/WebGazer
  //   LaserGaze — head-pose compensation (subtract rotation from raw iris offset)
  //     https://github.com/tensorsense/LaserGaze
  //
  // Core formula: gazeX = (iris_center - eye_center) / eye_width * amplify
  // Enhanced with: multi-landmark iris, both-eye vertical, yaw weighting,
  //                head-pose compensation
  function _computeIrisGaze(lm, headYaw, headPitch) {
    // === Multi-landmark iris center (Eyes-Position-Estimator approach) ===
    // Left iris: 468=center, 469=right, 470=top, 471=left, 472=bottom
    // Right iris: 473=center, 474=right, 475=top, 476=left, 477=bottom
    const lIris = _avgLandmarks(lm, [468, 469, 470, 471, 472]);
    const rIris = _avgLandmarks(lm, [473, 474, 475, 476, 477]);
    if (!lIris || !rIris) return { gazeX: 0, gazeY: 0, eyeContactScore: 0.5 };

    // Eye corner landmarks
    const leftOuter  = lm[33],  leftInner  = lm[133];
    const rightOuter = lm[362], rightInner = lm[263];

    // --- Horizontal gaze (both eyes) ---
    const lEyeW  = Math.abs(leftInner.x  - leftOuter.x)  || 0.001;
    const lCtrX  = (leftOuter.x  + leftInner.x)  / 2;
    const lGazeX = (lIris.x - lCtrX) / lEyeW;

    const rEyeW  = Math.abs(rightInner.x - rightOuter.x) || 0.001;
    const rCtrX  = (rightOuter.x + rightInner.x) / 2;
    const rGazeX = (rIris.x - rCtrX) / rEyeW;

    // === Yaw-based eye weighting (WebGazer concept) ===
    // When head turns, the eye facing the camera gives more reliable data.
    // Positive yaw = head turned right → left eye faces camera more.
    const yawBias = Math.max(-1, Math.min(1, (headYaw || 0) / 30));
    const wLeft   = 0.5 + yawBias * 0.3;
    const wRight  = 1 - wLeft;
    let rawGazeX  = lGazeX * wLeft + rGazeX * wRight;

    // --- Vertical gaze (BOTH eyes, multi-landmark boundaries) ---
    // Enhanced: use multiple upper and lower eyelid landmarks for more stable
    // boundary estimation (Eyes-Position-Estimator uses multiple points per lid)
    // Left eye: upper lids 159,160,161 ; lower lids 145,144,153
    const lTopY = _avgY(lm, [159, 160, 161]);
    const lBotY = _avgY(lm, [145, 144, 153]);
    const lEyeH = Math.abs(lBotY - lTopY) || 0.001;
    const lMidY = (lTopY + lBotY) / 2;
    const lGazeY = (lIris.y - lMidY) / lEyeH;

    // Right eye: upper lids 386,385,384 ; lower lids 374,373,380
    const rTopY = _avgY(lm, [386, 385, 384]);
    const rBotY = _avgY(lm, [374, 373, 380]);
    const rEyeH = Math.abs(rBotY - rTopY) || 0.001;
    const rMidY = (rTopY + rBotY) / 2;
    const rGazeY = (rIris.y - rMidY) / rEyeH;

    let rawGazeY = lGazeY * wLeft + rGazeY * wRight;

    // === Head pose compensation (LaserGaze concept) ===
    // When head rotates, iris appears shifted even if actual gaze hasn't changed.
    // Subtract a fraction of head rotation from iris offset to isolate true
    // gaze direction. Compensation factors tuned to MediaPipe's coordinate scale.
    const HEAD_COMP_X = 0.012;
    const HEAD_COMP_Y = 0.008;
    rawGazeX -= (headYaw   || 0) * HEAD_COMP_X;
    rawGazeY -= (headPitch || 0) * HEAD_COMP_Y;

    // Amplify x4 and clamp (raw offset range is tiny ~0.0-0.25)
    const gazeX = Math.max(-1, Math.min(1, rawGazeX * 4));
    const gazeY = Math.max(-1, Math.min(1, rawGazeY * 4));

    // Eye contact: 1.0 = iris centered, 0.0 = extreme edge
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
