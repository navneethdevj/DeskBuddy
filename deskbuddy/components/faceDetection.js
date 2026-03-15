/**
 * Face Detection module.
 * Uses MediaPipe Face Landmarker to analyze frames from a hidden webcam
 * stream and derive the user's attention state.
 *
 * Detection loop runs at approximately 10–15 FPS.
 *
 * Detected signals:
 *   - face presence
 *   - head direction   (nose position relative to face outline centre)
 *   - eye openness     (eyelid landmark distance + blink blend-shapes)
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
  const HEAD_AWAY_THRESHOLD    = 0.55; // combined normalised head deviation for Distracted
  const STATE_HOLD_MS          = 300;  // ms candidate state must persist before committing

  let faceLandmarker = null;
  let videoElement   = null;
  let running        = false;
  let intervalId     = null;
  let lastDetectTime = 0;  // track last timestamp sent to MediaPipe (must be strictly increasing)

  // Detected signals
  let facePresent    = false;
  let gazeDirection  = { x: 0, y: 0 };
  let headDirection  = { x: 0, y: 0 };
  let headYaw        = 0;   // degrees, from transformation matrix
  let headPitch      = 0;   // degrees, from transformation matrix
  let eyeOpenness    = 1.0;
  let movementLevel  = 0;
  let faceNormX      = 0;   // normalized face X: -1 to +1
  let faceNormY      = 0;   // normalized face Y: -1 to +1

  // Frame-to-frame movement tracking
  let prevNosePos = null;

  // Timing bookkeeping
  let lastFaceTime    = 0;
  let eyeClosedSince  = 0;

  // Derived state
  let userState = 'NoFace';

  // State smoothing
  let candidateState = 'NoFace';
  let candidateSince = 0;

  // ===== Initialisation =====

  async function init() {
    console.log('Starting camera...');

    // Verify camera API is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.log('Camera access denied');
      console.warn('[FaceDetection] navigator.mediaDevices.getUserMedia not available.');
      userState = 'NoFace';
      return false;
    }

    // --- Step 1: Access the camera FIRST (independent of MediaPipe) ---
    try {
      videoElement = document.getElementById('cameraVideo');
      if (!videoElement) {
        videoElement = document.createElement('video');
        videoElement.id = 'cameraVideo';
        videoElement.setAttribute('autoplay', '');
        videoElement.setAttribute('playsinline', '');
        videoElement.style.display = 'none';
        document.body.appendChild(videoElement);
      }
      videoElement.muted = true;

      var stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      videoElement.srcObject = stream;
      await videoElement.play();
      console.log('Camera access granted');
      running = true;
    } catch (err) {
      console.log('Camera access denied');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        console.warn('[FaceDetection] Camera permission denied by user or system.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        console.warn('[FaceDetection] No camera device found.');
      } else {
        console.warn('[FaceDetection] Camera init failed:', err.name, err.message);
      }
      userState = 'NoFace';
      return false;
    }

    // --- Step 2: Initialize MediaPipe face detection (optional) ---
    if (typeof vision === 'undefined') {
      console.warn('[FaceDetection] MediaPipe vision bundle not loaded — camera is running but face detection disabled.');
      return true;
    }

    try {
      console.log('[FaceDetection] Loading MediaPipe FilesetResolver...');
      var filesetResolver = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      console.log('[FaceDetection] FilesetResolver loaded.');

      var modelUrl =
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

      // Try GPU delegate first; fall back to CPU if GPU fails
      console.log('[FaceDetection] Creating FaceLandmarker (trying GPU)...');
      try {
        faceLandmarker = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: 'VIDEO',
          numFaces: 1
        });
        console.log('[FaceDetection] FaceLandmarker created (GPU).');
      } catch (gpuErr) {
        console.warn('[FaceDetection] GPU delegate failed:', gpuErr.message, '— retrying with CPU...');
        faceLandmarker = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: 'VIDEO',
          numFaces: 1
        });
        console.log('[FaceDetection] FaceLandmarker created (CPU).');
      }

      // Wait for video to have actual frame data before starting detection
      if (videoElement.readyState < 2) {
        await new Promise(function (resolve) {
          videoElement.addEventListener('loadeddata', resolve, { once: true });
          // Safety timeout: don't wait forever
          setTimeout(resolve, 5000);
        });
      }

      lastFaceTime = Date.now();
      intervalId = setInterval(detect, DETECTION_INTERVAL_MS);
      console.log('[FaceDetection] Detection loop started (~' +
        Math.round(1000 / DETECTION_INTERVAL_MS) + ' FPS).');
      return true;
    } catch (err) {
      console.warn('[FaceDetection] MediaPipe init failed:', err.name, err.message);
      console.warn('[FaceDetection] Camera is running but face detection is disabled.');
      return true;
    }
  }

  // ===== Per-frame detection =====

  function detect() {
    if (!running || !faceLandmarker || !videoElement || videoElement.readyState < 2) return;

    // MediaPipe requires strictly increasing timestamps
    var now = performance.now();
    if (now <= lastDetectTime) now = lastDetectTime + 0.1;
    lastDetectTime = now;

    var results;
    try {
      results = faceLandmarker.detectForVideo(videoElement, now);
    } catch (e) {
      console.debug('[FaceDetection] detectForVideo error:', e.message);
      return;
    }

    var ts = Date.now();

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      facePresent = true;
      lastFaceTime = ts;

      var landmarks = results.faceLandmarks[0];

      // --- Head direction from nose tip relative to face outline centre ---
      var noseTip    = landmarks[4];
      var leftFace   = landmarks[234];
      var rightFace  = landmarks[454];
      var topFace    = landmarks[10];
      var bottomFace = landmarks[152];

      if (noseTip && leftFace && rightFace) {
        var faceCenterX = (leftFace.x + rightFace.x) / 2;
        var halfWidth   = Math.abs(rightFace.x - leftFace.x) / 2 || 0.001;
        headDirection.x = (noseTip.x - faceCenterX) / halfWidth;
      }
      if (noseTip && topFace && bottomFace) {
        var faceCenterY = (topFace.y + bottomFace.y) / 2;
        var halfHeight  = Math.abs(bottomFace.y - topFace.y) / 2 || 0.001;
        headDirection.y = (noseTip.y - faceCenterY) / halfHeight;
      }

      // --- Face center position (normalized -1 to +1) ---
      if (noseTip) {
        faceNormX = (noseTip.x - 0.5) * 2;
        faceNormY = (noseTip.y - 0.5) * 2;
      }

      // --- Head yaw/pitch from transformation matrices ---
      if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
        var matrix = results.facialTransformationMatrixes[0];
        if (matrix && matrix.data) {
          var m = matrix.data;
          // 4x4 column-major: Yaw = atan2(m[8], m[10]), Pitch = asin(-m[9])
          headYaw   = Math.atan2(m[8], m[10]) * (180 / Math.PI);
          headPitch = Math.asin(-Math.max(-1, Math.min(1, m[9]))) * (180 / Math.PI);
        }
      } else {
        // Fallback: approximate from landmark-based headDirection
        headYaw   = headDirection.x * 30;
        headPitch = headDirection.y * 25;
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

      // --- Landmark-based eye openness (eyelid distance) ---
      var upperLidL = landmarks[159];
      var lowerLidL = landmarks[145];
      var upperLidR = landmarks[386];
      var lowerLidR = landmarks[374];
      if (upperLidL && lowerLidL && upperLidR && lowerLidR && topFace && bottomFace) {
        var faceH = Math.abs(bottomFace.y - topFace.y) || 0.001;
        var leftEyeRatio  = Math.abs(upperLidL.y - lowerLidL.y) / faceH;
        var rightEyeRatio = Math.abs(upperLidR.y - lowerLidR.y) / faceH;
        // Normalise: ~0.04 is typical open-eye ratio; clamp to 0–1
        var landmarkOpenness = Math.min(1, Math.max(0, ((leftEyeRatio + rightEyeRatio) / 2) / 0.04));
        // Use the lower of blendshape and landmark estimates (catches closure better)
        eyeOpenness = Math.min(eyeOpenness, landmarkOpenness);
      }

      // --- Derive raw state ---
      var rawState;
      if (eyeOpenness < EYE_CLOSED_THRESHOLD) {
        // Eyes mostly closed — track duration
        if (eyeClosedSince === 0) eyeClosedSince = ts;
        if (ts - eyeClosedSince > SLEEPY_THRESHOLD_MS) {
          rawState = 'Sleepy';
        } else {
          rawState = userState;   // hold current state during eye-close transition
        }
      } else {
        eyeClosedSince = 0;
        var headDev = Math.abs(headDirection.x) + Math.abs(headDirection.y);

        if (headDev > HEAD_AWAY_THRESHOLD) {
          rawState = 'Distracted';
        } else {
          rawState = 'Focused';
        }
      }

      // --- State smoothing: hold candidate for STATE_HOLD_MS before committing ---
      if (rawState !== candidateState) {
        candidateState = rawState;
        candidateSince = ts;
      }
      if (ts - candidateSince >= STATE_HOLD_MS) {
        userState = candidateState;
      }
    } else {
      // No face in frame
      facePresent = false;
      prevNosePos = null;
      movementLevel = movementLevel * 0.9;
      if (ts - lastFaceTime > NO_FACE_THRESHOLD_MS) {
        userState = 'NoFace';
        candidateState = 'NoFace';
        candidateSince = ts;
      }
    }
  }

  // ===== Public API =====

  function getUserState()      { return userState; }
  function isFacePresent()     { return facePresent; }
  function getGazeDirection()  { return { x: gazeDirection.x, y: gazeDirection.y }; }
  function getHeadDirection()  { return { x: headDirection.x, y: headDirection.y }; }
  function getHeadYaw()        { return headYaw; }
  function getHeadPitch()      { return headPitch; }
  function getEyeOpenness()    { return eyeOpenness; }
  function getMovementLevel()  { return movementLevel; }
  function getFaceNorm()       { return { x: faceNormX, y: faceNormY }; }
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
    getHeadYaw:       getHeadYaw,
    getHeadPitch:     getHeadPitch,
    getEyeOpenness:   getEyeOpenness,
    getMovementLevel: getMovementLevel,
    getFaceNorm:      getFaceNorm,
    isRunning:        isRunning,
    stop:             stop
  };
})();
