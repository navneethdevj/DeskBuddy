/**
 * Perception — derives clean signals from raw face detection.
 * Reads window.faceResults every 100ms.
 * Writes window.perception — single source of truth for all behavior.
 *
 * window.perception = {
 *   facePresent:   boolean,
 *   headYaw:       number (degrees, neg=left, pos=right),
 *   headPitch:     number (degrees),
 *   eyeOpenness:   number (0=closed, 1=open),
 *   faceX:         number (0–1 normalized screen X),
 *   faceY:         number (0–1 normalized screen Y),
 *   headMovement:  number (pixel delta of nose tip),
 *   userState:     'Focused'|'LookingAway'|'Sleepy'|'NoFace',
 *   timeInStateMs: number (ms since last state change)
 * }
 */
const Perception = (() => {

  const EVAL_MS            = 100;
  const DEBOUNCE_MS        = 1000;
  const SLEEPY_CONFIRM_MS  = 3000;
  const NOFACE_CONFIRM_MS  = 3000;
  const SLEEPY_THRESHOLD   = 0.25;
  const OPEN_THRESHOLD     = 0.40;
  const AWAY_YAW_DEG       = 20;
  const FOCUSED_YAW_DEG    = 15;

  let candidateState  = 'NoFace';
  let candidateStart  = 0;
  let confirmedState  = 'NoFace';
  let stateEntryTime  = Date.now();
  let sleepyMs        = 0;
  let nofaceMs        = 0;
  let lastEvalTime    = Date.now();
  let prevNoseX       = null;
  let prevNoseY       = null;

  // Initialise immediately so consumers never see undefined
  window.perception = {
    facePresent: false, headYaw: 0, headPitch: 0,
    eyeOpenness: 1, faceX: 0.5, faceY: 0.5,
    headMovement: 0, userState: 'NoFace', timeInStateMs: 0
  };

  function init() {
    setInterval(_evaluate, EVAL_MS);
  }

  function _evaluate() {
    const now = Date.now();
    const dt  = now - lastEvalTime;
    lastEvalTime = now;

    const r = window.faceResults;
    const hasLandmarks = r?.faceLandmarks?.length > 0;

    if (!hasLandmarks) {
      nofaceMs  += dt;
      sleepyMs   = 0;
      prevNoseX  = null; prevNoseY = null;
      _write({ facePresent: false, headYaw: 0, headPitch: 0,
               eyeOpenness: 1, faceX: 0.5, faceY: 0.5, headMovement: 0 });
      _transition(nofaceMs >= NOFACE_CONFIRM_MS ? 'NoFace' : confirmedState, now);
      return;
    }

    nofaceMs = 0;
    const lm = r.faceLandmarks[0];
    const bs = r.faceBlendshapes?.[0]?.categories ?? [];
    const mx = r.facialTransformationMatrixes?.[0]?.data ?? null;

    let yaw = 0, pitch = 0;
    if (mx) {
      yaw   = Math.atan2(mx[8], mx[10]) * (180 / Math.PI);
      pitch = Math.atan2(-mx[9], Math.sqrt(mx[8]*mx[8] + mx[10]*mx[10])) * (180 / Math.PI);
    }

    const blinkL = bs.find(c => c.categoryName === 'eyeBlinkLeft')?.score  ?? 0;
    const blinkR = bs.find(c => c.categoryName === 'eyeBlinkRight')?.score ?? 0;
    const eyeOpenness = 1 - (blinkL + blinkR) / 2;

    const nose = lm[4];
    const faceX = nose?.x ?? 0.5;
    const faceY = nose?.y ?? 0.5;

    let headMovement = 0;
    if (prevNoseX !== null && nose) {
      const dxPx = (nose.x - prevNoseX) * window.innerWidth;
      const dyPx = (nose.y - prevNoseY) * window.innerHeight;
      headMovement = Math.sqrt(dxPx*dxPx + dyPx*dyPx);
    }
    if (nose) { prevNoseX = nose.x; prevNoseY = nose.y; }

    eyeOpenness < SLEEPY_THRESHOLD
      ? (sleepyMs += dt)
      : (sleepyMs = Math.max(0, sleepyMs - dt * 0.5));

    _write({ facePresent: true, headYaw: yaw, headPitch: pitch,
             eyeOpenness, faceX, faceY, headMovement });

    let candidate;
    if      (sleepyMs >= SLEEPY_CONFIRM_MS)           candidate = 'Sleepy';
    else if (Math.abs(yaw) > AWAY_YAW_DEG)            candidate = 'LookingAway';
    else if (Math.abs(yaw) <= FOCUSED_YAW_DEG
             && eyeOpenness >= OPEN_THRESHOLD)         candidate = 'Focused';
    else                                               candidate = 'Focused';

    _transition(candidate, now);
  }

  function _write(signals) {
    Object.assign(window.perception, signals);
    window.perception.timeInStateMs = Date.now() - stateEntryTime;
  }

  function _transition(candidate, now) {
    if (candidate !== candidateState) {
      candidateState = candidate;
      candidateStart = now;
    }
    if ((now - candidateStart) >= DEBOUNCE_MS && candidate !== confirmedState) {
      confirmedState = candidate;
      stateEntryTime = now;
    }
    window.perception.userState     = confirmedState;
    window.perception.timeInStateMs = now - stateEntryTime;
  }

  return { init };
})();
