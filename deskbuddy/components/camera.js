/**
 * Camera Awareness module.
 * Uses MediaPipe Face Landmarker to detect face presence, head direction,
 * eye openness, and movement level from a hidden webcam feed at 10–15 FPS.
 *
 * Converts camera signals into user states:
 *   Focused      – face present, eyes open, head oriented toward screen
 *   Distracted   – face present, gaze slightly away
 *   LookingAway  – face present, head significantly turned
 *   Sleepy       – eyes mostly closed for several seconds
 *   NoFace       – no face detected for > 3 seconds
 *
 * The webcam video is never rendered on screen.
 */
const Camera = (() => {
  const DETECTION_INTERVAL = 80;           // ~12 FPS (10–15 range)
  const NO_FACE_THRESHOLD = 3000;          // ms before NoFace state
  const SLEEPY_THRESHOLD = 3000;           // ms of closed eyes before Sleepy
  const EYE_CLOSED_VALUE = 0.45;           // blendshape threshold
  const GAZE_AWAY_THRESHOLD = 0.25;        // mild gaze deviation → Distracted
  const HEAD_AWAY_THRESHOLD = 0.45;        // strong head turn → LookingAway

  let faceLandmarker = null;
  let videoElement = null;
  let running = false;
  let intervalId = null;

  // Detected signals
  let facePresent = false;
  let gazeDirection = { x: 0, y: 0 };     // -1 to 1 normalized
  let headDirection = { x: 0, y: 0 };     // -1 to 1 normalized (nose offset)
  let eyeOpenness = 1.0;                   // 0 = closed, 1 = open
  let movementLevel = 0;                   // 0 = still, higher = more motion

  // Movement tracking (frame-to-frame landmark delta)
  let prevNosePos = null;

  // Timing
  let lastFaceTime = 0;
  let eyeClosedSince = 0;

  // Derived state
  let userState = 'Focused';

  // ===== Initialisation =====

  async function init() {
    // Guard: MediaPipe must be loaded via CDN
    if (typeof vision === 'undefined') {
      console.warn('[Camera] MediaPipe vision bundle not loaded – camera disabled.');
      userState = 'NoFace';
      return false;
    }

    try {
      videoElement = document.createElement('video');
      videoElement.className = 'camera-feed-hidden';
      videoElement.setAttribute('autoplay', '');
      videoElement.setAttribute('playsinline', '');
      document.body.appendChild(videoElement);

      var stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, frameRate: { ideal: 15 } }
      });
      videoElement.srcObject = stream;
      await videoElement.play();
      console.log('Camera access granted');

      var filesetResolver = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      faceLandmarker = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU'
        },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 1
      });

      lastFaceTime = Date.now();
      running = true;
      intervalId = setInterval(detect, DETECTION_INTERVAL);
      return true;
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        console.log('Camera access denied');
      }
      console.warn('[Camera] Init failed:', err.message);
      userState = 'NoFace';
      return false;
    }
  }

  // ===== Per-frame detection =====

  function detect() {
    if (!running || !faceLandmarker || !videoElement || videoElement.readyState < 2) return;

    var now = performance.now();
    var results;
    try {
      results = faceLandmarker.detectForVideo(videoElement, now);
    } catch (_) {
      return;
    }

    var ts = Date.now();

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      facePresent = true;
      lastFaceTime = ts;

      var landmarks = results.faceLandmarks[0];

      // Head direction from nose tip (landmark 1) relative to face center
      var noseTip = landmarks[1];
      if (noseTip) {
        headDirection.x = (noseTip.x - 0.5) * 2;   // -1 (left) to 1 (right)
        headDirection.y = (noseTip.y - 0.5) * 2;   // -1 (up) to 1 (down)
      }

      // Movement level: frame-to-frame nose displacement
      if (noseTip && prevNosePos) {
        var mdx = noseTip.x - prevNosePos.x;
        var mdy = noseTip.y - prevNosePos.y;
        movementLevel = movementLevel * 0.7 + Math.sqrt(mdx * mdx + mdy * mdy) * 0.3;
      }
      if (noseTip) {
        prevNosePos = { x: noseTip.x, y: noseTip.y };
      }

      if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
        var map = {};
        results.faceBlendshapes[0].categories.forEach(function (s) {
          map[s.categoryName] = s.score;
        });

        // Eye openness (inverse of blink)
        var blinkL = map['eyeBlinkLeft'] || 0;
        var blinkR = map['eyeBlinkRight'] || 0;
        eyeOpenness = 1 - (blinkL + blinkR) / 2;

        // Horizontal gaze (positive = right)
        var lookInL  = map['eyeLookInLeft']  || 0;
        var lookOutL = map['eyeLookOutLeft'] || 0;
        var lookInR  = map['eyeLookInRight']  || 0;
        var lookOutR = map['eyeLookOutRight'] || 0;
        gazeDirection.x = ((lookOutL - lookInL) + (lookInR - lookOutR)) / 2;

        // Vertical gaze (positive = down)
        var lookUpL   = map['eyeLookUpLeft']   || 0;
        var lookDownL = map['eyeLookDownLeft'] || 0;
        var lookUpR   = map['eyeLookUpRight']   || 0;
        var lookDownR = map['eyeLookDownRight'] || 0;
        gazeDirection.y = ((lookDownL - lookUpL) + (lookDownR - lookUpR)) / 2;
      }

      // --- Derive user state ---
      if (eyeOpenness < EYE_CLOSED_VALUE) {
        if (eyeClosedSince === 0) eyeClosedSince = ts;
        if (ts - eyeClosedSince > SLEEPY_THRESHOLD) {
          userState = 'Sleepy';
        }
      } else {
        eyeClosedSince = 0;
        var headDev = Math.abs(headDirection.x) + Math.abs(headDirection.y);
        var gazeDev = Math.abs(gazeDirection.x) + Math.abs(gazeDirection.y);

        if (headDev > HEAD_AWAY_THRESHOLD) {
          userState = 'LookingAway';
        } else if (gazeDev > GAZE_AWAY_THRESHOLD) {
          userState = 'Distracted';
        } else {
          userState = 'Focused';
        }
      }
    } else {
      facePresent = false;
      prevNosePos = null;
      movementLevel = movementLevel * 0.9;  // decay when no face
      if (ts - lastFaceTime > NO_FACE_THRESHOLD) {
        userState = 'NoFace';
      }
    }
  }

  // ===== Public API =====

  function getUserState()       { return userState; }
  function isFacePresent()      { return facePresent; }
  function getGazeDirection()   { return { x: gazeDirection.x, y: gazeDirection.y }; }
  function getHeadDirection()   { return { x: headDirection.x, y: headDirection.y }; }
  function getEyeOpenness()     { return eyeOpenness; }
  function getMovementLevel()   { return movementLevel; }
  function isRunning()          { return running; }

  function stop() {
    running = false;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (videoElement && videoElement.srcObject) {
      videoElement.srcObject.getTracks().forEach(function (t) { t.stop(); });
    }
  }

  return {
    init: init,
    getUserState: getUserState,
    isFacePresent: isFacePresent,
    getGazeDirection: getGazeDirection,
    getHeadDirection: getHeadDirection,
    getEyeOpenness: getEyeOpenness,
    getMovementLevel: getMovementLevel,
    isRunning: isRunning,
    stop: stop
  };
})();
