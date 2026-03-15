/**
 * Perception — derives clean user-state signals from raw face detection.
 *
 * Reads window.faceResults every 100ms.
 * Writes window.perception — the single source of truth for all behavioral systems.
 *
 * window.perception shape:
 * {
 *   facePresent:   boolean  — is a face currently detected?
 *   headYaw:       number   — degrees, negative=left, positive=right
 *   headPitch:     number   — degrees, negative=up, positive=down
 *   eyeOpenness:   number   — 0.0 (closed) to 1.0 (fully open)
 *   faceX:         number   — 0.0–1.0, normalized horizontal face center
 *   faceY:         number   — 0.0–1.0, normalized vertical face center
 *   headMovement:  number   — pixel delta of nose tip vs last frame
 *   userState:     string   — 'Focused' | 'LookingAway' | 'Sleepy' | 'NoFace'
 *   timeInStateMs: number   — milliseconds since userState last changed
 * }
 *
 * State transitions are debounced (1000ms hold required) to prevent flicker.
 * Sleepy requires 3s continuous low eye-openness before confirming.
 * NoFace requires 3s continuous absence before confirming.
 */
const Perception = (() => {

  // ── Config ────────────────────────────────────────────────────────────────
  const EVAL_INTERVAL_MS      = 100;
  const STATE_DEBOUNCE_MS     = 1000;
  const SLEEPY_CONFIRM_MS     = 3000;
  const NO_FACE_CONFIRM_MS    = 3000;
  const SLEEPY_EYE_THRESHOLD  = 0.25;   // below this = sleepy
  const FOCUSED_EYE_THRESHOLD = 0.40;   // above this = eyes open
  const LOOKING_AWAY_YAW_DEG  = 20;     // beyond this = looking away
  const FOCUSED_YAW_DEG       = 15;     // within this = facing screen

  // ── State ─────────────────────────────────────────────────────────────────
  let candidateState      = 'NoFace';
  let candidateStart      = 0;
  let confirmedState      = 'NoFace';
  let stateEntryTime      = Date.now();
  let sleepyAccumulatorMs = 0;
  let noFaceAccumulatorMs = 0;
  let lastEvalTime        = Date.now();
  let prevNoseX           = null;
  let prevNoseY           = null;

  // ── Initialise output immediately so consumers never see undefined ─────────
  window.perception = {
    facePresent:   false,
    headYaw:       0,
    headPitch:     0,
    eyeOpenness:   1,
    faceX:         0.5,
    faceY:         0.5,
    headMovement:  0,
    userState:     'NoFace',
    timeInStateMs: 0
  };

  // ── Public API ────────────────────────────────────────────────────────────

  function init() {
    console.log('[Perception] init() called — starting evaluation loop');
    setInterval(_evaluate, EVAL_INTERVAL_MS);
    // Log perception state every 5 seconds for diagnosis
    setInterval(() => {
      console.log('[Perception] state:', JSON.stringify(window.perception));
    }, 5000);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  function _evaluate() {
    const now = Date.now();
    const dt  = now - lastEvalTime;
    lastEvalTime = now;

    const results = window.faceResults;
    const hasLandmarks = results &&
                         results.faceLandmarks &&
                         results.faceLandmarks.length > 0;

    if (!hasLandmarks) {
      _handleNoFace(dt, now);
      return;
    }

    noFaceAccumulatorMs = 0;
    _processLandmarks(results, dt, now);
  }

  function _handleNoFace(dt, now) {
    noFaceAccumulatorMs += dt;
    sleepyAccumulatorMs = 0;
    prevNoseX = null;
    prevNoseY = null;

    _writeSignals({
      facePresent:  false,
      headYaw:      0, headPitch:  0,
      eyeOpenness:  1, headMovement: 0,
      faceX: 0.5, faceY: 0.5
    });

    const candidate = noFaceAccumulatorMs >= NO_FACE_CONFIRM_MS ? 'NoFace' : confirmedState;
    _updateState(candidate, now);
  }

  function _processLandmarks(results, dt, now) {
    const landmarks   = results.faceLandmarks[0];
    const blendshapes = results.faceBlendshapes?.[0]?.categories ?? [];
    const matrix      = results.facialTransformationMatrixes?.[0]?.data ?? null;

    // Head rotation from 4×4 transformation matrix
    let yaw = 0, pitch = 0;
    if (matrix) {
      yaw   = Math.atan2(matrix[8],  matrix[10]) * (180 / Math.PI);
      pitch = Math.atan2(-matrix[9],
        Math.sqrt(matrix[8] * matrix[8] + matrix[10] * matrix[10])
      ) * (180 / Math.PI);
    }

    // Eye openness: invert blink score (0=open, 1=closed → flip to 0=closed, 1=open)
    const blinkL = _getBlendshape(blendshapes, 'eyeBlinkLeft');
    const blinkR = _getBlendshape(blendshapes, 'eyeBlinkRight');
    const eyeOpenness = 1 - (blinkL + blinkR) / 2;

    // Face center from nose tip (landmark index 4)
    const nose = landmarks[4];
    const faceX = nose?.x ?? 0.5;
    const faceY = nose?.y ?? 0.5;

    // Head movement in screen pixels
    let headMovement = 0;
    if (prevNoseX !== null && nose) {
      const dxPx = (nose.x - prevNoseX) * window.innerWidth;
      const dyPx = (nose.y - prevNoseY) * window.innerHeight;
      headMovement = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
    }
    if (nose) { prevNoseX = nose.x; prevNoseY = nose.y; }

    // Sleepy accumulator
    if (eyeOpenness < SLEEPY_EYE_THRESHOLD) {
      sleepyAccumulatorMs += dt;
    } else {
      sleepyAccumulatorMs = Math.max(0, sleepyAccumulatorMs - dt * 0.5); // decay
    }

    _writeSignals({ facePresent: true, headYaw: yaw, headPitch: pitch,
                    eyeOpenness, faceX, faceY, headMovement });

    // Classify state
    let candidate;
    if (sleepyAccumulatorMs >= SLEEPY_CONFIRM_MS) {
      candidate = 'Sleepy';
    } else if (Math.abs(yaw) > LOOKING_AWAY_YAW_DEG) {
      candidate = 'LookingAway';
    } else if (Math.abs(yaw) <= FOCUSED_YAW_DEG && eyeOpenness >= FOCUSED_EYE_THRESHOLD) {
      candidate = 'Focused';
    } else {
      candidate = 'Focused'; // face present, not looking away, not sleepy → focused
    }

    _updateState(candidate, now);
  }

  function _writeSignals(signals) {
    Object.assign(window.perception, signals);
    window.perception.timeInStateMs = Date.now() - stateEntryTime;
  }

  function _updateState(candidate, now) {
    if (candidate !== candidateState) {
      candidateState = candidate;
      candidateStart = now;
    }
    // Commit only after debounce period
    if ((now - candidateStart) >= STATE_DEBOUNCE_MS && candidate !== confirmedState) {
      confirmedState = candidate;
      stateEntryTime = now;
    }
    window.perception.userState     = confirmedState;
    window.perception.timeInStateMs = now - stateEntryTime;
  }

  function _getBlendshape(categories, name) {
    return categories.find(c => c.categoryName === name)?.score ?? 0;
  }

  return { init };

})();
