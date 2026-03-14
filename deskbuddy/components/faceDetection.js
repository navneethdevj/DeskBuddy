/**
 * Face Detection module.
 * Uses MediaPipe Face Landmarker to analyze frames from a hidden webcam
 * stream and derive the user's attention state.
 *
 * Detection loop runs at approximately 10–15 FPS.
 *
 * Detected signals:
 *   - face presence
 *   - head direction   (nose landmark offset from centre)
 *   - eye openness     (inverse of blink blend-shapes)
 *
 * Derived user states:
 *   Focused    – face present, head facing screen, eyes open
 *   Distracted – face present but head turned away from screen
 *   Sleepy     – face present but eyes mostly closed for several seconds
 *   NoFace     – no face detected in the frame
 *
 * The webcam video is never rendered on screen.
 */
const FaceDetection = (() => {
  // Detection interval — targets ~12 FPS (within the 10–15 FPS range)
  const DETECTION_INTERVAL_MS = 80;

  // Timing thresholds
  const NO_FACE_THRESHOLD_MS = 3000;   // ms without face before NoFace state
  const SLEEPY_THRESHOLD_MS  = 3000;   // ms of closed eyes before Sleepy state

  // Signal thresholds
  const EYE_CLOSED_THRESHOLD   = 0.45; // blink blend-shape score (0–1)
  const HEAD_AWAY_THRESHOLD    = 0.45; // combined head deviation for Distracted

  let faceLandmarker = null;
  let videoElement   = null;
  let running        = false;
  let intervalId     = null;

  // Detected signals
  let facePresent    = false;
  let gazeDirection  = { x: 0, y: 0 };
  let headDirection  = { x: 0, y: 0 };
  let eyeOpenness    = 1.0;
  let movementLevel  = 0;

  // Frame-to-frame movement tracking
  let prevNosePos = null;

  // Timing bookkeeping
  let lastFaceTime    = 0;
  let eyeClosedSince  = 0;

  // Derived state
  let userState = 'NoFace';

  // ===== Initialisation =====

  async function init() {
    if (typeof vision === 'undefined') {
      console.warn('[FaceDetection] MediaPipe vision bundle not loaded — disabled.');
      userState = 'NoFace';
      return false;
    }

    try {
      // Create a hidden video element for the webcam feed
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
      intervalId = setInterval(detect, DETECTION_INTERVAL_MS);
      return true;
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        console.log('Camera access denied');
      }
      console.warn('[FaceDetection] Init failed:', err.message);
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

      // --- Head direction from nose tip (landmark 1) relative to face centre ---
      var noseTip = landmarks[1];
      if (noseTip) {
        headDirection.x = (noseTip.x - 0.5) * 2;   // -1 (left) to 1 (right)
        headDirection.y = (noseTip.y - 0.5) * 2;   // -1 (up)   to 1 (down)
      }

      // --- Movement level: frame-to-frame nose displacement ---
      if (noseTip && prevNosePos) {
        var mdx = noseTip.x - prevNosePos.x;
        var mdy = noseTip.y - prevNosePos.y;
        movementLevel = movementLevel * 0.7 + Math.sqrt(mdx * mdx + mdy * mdy) * 0.3;
      }
      if (noseTip) {
        prevNosePos = { x: noseTip.x, y: noseTip.y };
      }

      // --- Eye openness & gaze from blend-shapes ---
      if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
        var map = {};
        results.faceBlendshapes[0].categories.forEach(function (s) {
          map[s.categoryName] = s.score;
        });

        var blinkL = map['eyeBlinkLeft']  || 0;
        var blinkR = map['eyeBlinkRight'] || 0;
        eyeOpenness = 1 - (blinkL + blinkR) / 2;

        // Horizontal gaze (positive = right)
        var lookInL  = map['eyeLookInLeft']   || 0;
        var lookOutL = map['eyeLookOutLeft']  || 0;
        var lookInR  = map['eyeLookInRight']  || 0;
        var lookOutR = map['eyeLookOutRight'] || 0;
        gazeDirection.x = ((lookOutL - lookInL) + (lookInR - lookOutR)) / 2;

        // Vertical gaze (positive = down)
        var lookUpL   = map['eyeLookUpLeft']    || 0;
        var lookDownL = map['eyeLookDownLeft']  || 0;
        var lookUpR   = map['eyeLookUpRight']   || 0;
        var lookDownR = map['eyeLookDownRight'] || 0;
        gazeDirection.y = ((lookDownL - lookUpL) + (lookDownR - lookUpR)) / 2;
      }

      // --- Derive user state ---
      if (eyeOpenness < EYE_CLOSED_THRESHOLD) {
        // Eyes mostly closed — track duration
        if (eyeClosedSince === 0) eyeClosedSince = ts;
        if (ts - eyeClosedSince > SLEEPY_THRESHOLD_MS) {
          userState = 'Sleepy';
        }
      } else {
        eyeClosedSince = 0;
        var headDev = Math.abs(headDirection.x) + Math.abs(headDirection.y);

        if (headDev > HEAD_AWAY_THRESHOLD) {
          userState = 'Distracted';
        } else {
          userState = 'Focused';
        }
      }
    } else {
      // No face in frame
      facePresent = false;
      prevNosePos = null;
      movementLevel = movementLevel * 0.9;
      if (ts - lastFaceTime > NO_FACE_THRESHOLD_MS) {
        userState = 'NoFace';
      }
    }
  }

  // ===== Public API =====

  function getUserState()      { return userState; }
  function isFacePresent()     { return facePresent; }
  function getGazeDirection()  { return { x: gazeDirection.x, y: gazeDirection.y }; }
  function getHeadDirection()  { return { x: headDirection.x, y: headDirection.y }; }
  function getEyeOpenness()    { return eyeOpenness; }
  function getMovementLevel()  { return movementLevel; }
  function isRunning()         { return running; }

  function stop() {
    running = false;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (videoElement && videoElement.srcObject) {
      videoElement.srcObject.getTracks().forEach(function (t) { t.stop(); });
    }
  }

  return {
    init:             init,
    getUserState:     getUserState,
    isFacePresent:    isFacePresent,
    getGazeDirection: getGazeDirection,
    getHeadDirection: getHeadDirection,
    getEyeOpenness:   getEyeOpenness,
    getMovementLevel: getMovementLevel,
    isRunning:        isRunning,
    stop:             stop
  };
})();
