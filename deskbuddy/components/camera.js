/**
 * Camera — MediaPipe FaceLandmarker (multi-face) + HandLandmarker (lazy, optional).
 *
 * FaceLandmarker:
 *   - numFaces: 4 (expanded from 1 for multi-face social detection)
 *   - 15 FPS — writes window.faceResults each detection frame
 *
 * HandLandmarker:
 *   - Lazy-initialized 1.8 s after face tracking starts (non-blocking startup)
 *   - GPU delegate with silent fallback to disabled
 *   - 10 FPS — writes window.handResults when ready
 *   - window.handAvailable = false until init succeeds
 *
 * window.cameraAvailable = false → app uses no-camera fallback behavior.
 *
 * Iris landmarks (used by perception.js):
 *   Left iris center  = lm[468]   Right iris center = lm[473]
 */
const Camera = (() => {

  const FPS             = 15;
  const FRAME_INTERVAL  = Math.round(1000 / FPS);       // ~67 ms
  const HAND_FPS        = 10;
  const HAND_INTERVAL   = Math.round(1000 / HAND_FPS);  // 100 ms
  const VIDEO_TIMEOUT   = 10000;

  let faceLandmarker      = null;
  let handLandmarker      = null;
  let objDetector         = null;
  let videoEl             = null;
  let lastFaceTimestampMs = -1;
  let lastHandTimestampMs = -1;
  let lastObjTimestampMs  = -1;
  let running             = false;
  let _handInitPending    = false;
  let _handInitDone       = false;
  let _objInitPending     = false;
  let _objInitDone        = false;

  // Globals read by perception.js and brain.js
  window.cameraAvailable = false;
  window.faceResults     = null;
  window.handResults     = null;
  window.handAvailable   = false;
  window.objResults      = [];   // [{categories:[{categoryName,score}], boundingBox:{originX,originY,width,height}}]
  window.objAvailable    = false;

  // ── Public init ─────────────────────────────────────────────────────────────

  async function init() {
    videoEl = document.getElementById('camera-feed');
    if (!videoEl) { console.warn('[Camera] #camera-feed not found'); return; }

    try {
      console.log('[Camera] Starting webcam…');
      await _startWebcam();
      console.log('[Camera] Webcam ready — initializing FaceLandmarker…');
      await _initFaceLandmarker();
      window.cameraAvailable = true;
      running = true;
      requestAnimationFrame(_loop);
      console.log('[Camera] FaceLandmarker ready — %d FPS, numFaces=4', FPS);

      // Lazy HandLandmarker — delay so it doesn't compete with face init at startup
      setTimeout(_initHandLandmarker, 1800);
      // Lazy ObjectDetector — delay further so hand + face are both stable first
      setTimeout(_initObjDetector, 3500);
    } catch (err) {
      console.warn('[Camera] Unavailable —', err.message || err);
    }
  }

  // ── Webcam ──────────────────────────────────────────────────────────────────

  async function _startWebcam() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('navigator.mediaDevices.getUserMedia not available');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    videoEl.srcObject = stream;
    try {
      await new Promise((resolve, reject) => {
        videoEl.addEventListener('loadeddata', resolve, { once: true });
        videoEl.addEventListener('error',      reject,  { once: true });
        setTimeout(() => reject(new Error('Video loadeddata timeout after 10 s')), VIDEO_TIMEOUT);
      });
    } catch (err) {
      stream.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
      throw err;
    }
    console.log('[Camera] Video ready — readyState=%d, %dx%d',
      videoEl.readyState, videoEl.videoWidth, videoEl.videoHeight);
  }

  // ── FaceLandmarker ──────────────────────────────────────────────────────────

  async function _initFaceLandmarker() {
    const { FaceLandmarker, FilesetResolver } = window;
    if (!FaceLandmarker)  throw new Error('window.FaceLandmarker undefined — CJS shim failed');
    if (!FilesetResolver) throw new Error('window.FilesetResolver undefined — CJS shim failed');

    const wasmPath = '../node_modules/@mediapipe/tasks-vision/wasm';
    const vision   = await FilesetResolver.forVisionTasks(wasmPath);

    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/' +
      'face_landmarker/face_landmarker/float16/1/face_landmarker.task';

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelUrl,
        delegate: 'CPU',   // CPU unchanged — stable across all hardware
      },
      outputFaceBlendshapes:              true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 4,   // ← expanded from 1 for multi-face social awareness
    });
  }

  // ── HandLandmarker (lazy, optional) ─────────────────────────────────────────

  async function _initHandLandmarker() {
    if (_handInitPending || _handInitDone) return;
    _handInitPending = true;
    try {
      const { HandLandmarker, FilesetResolver } = window;
      if (!HandLandmarker) {
        console.warn('[Camera] window.HandLandmarker not found — wave detection disabled');
        return;
      }
      if (!FilesetResolver) {
        console.warn('[Camera] window.FilesetResolver not found — wave detection disabled');
        return;
      }

      const wasmPath = '../node_modules/@mediapipe/tasks-vision/wasm';
      const vision   = await FilesetResolver.forVisionTasks(wasmPath);

      const modelUrl = 'https://storage.googleapis.com/mediapipe-models/' +
        'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: 'GPU',  // GPU preferred for hand tracking performance
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });

      window.handAvailable = true;
      _handInitDone = true;
      console.log('[Camera] HandLandmarker ready (GPU) — wave detection enabled');
    } catch (err) {
      // GPU may not be available; HandLandmarker is optional — fail silently
      console.warn('[Camera] HandLandmarker init failed (wave detection disabled):', err.message || err);
      window.handAvailable = false;
    } finally {
      _handInitPending = false;
    }
  }

  // ── Detection loop ──────────────────────────────────────────────────────────

  function _loop(timestamp) {
    if (!running) return;
    requestAnimationFrame(_loop);

    const ms = Math.round(timestamp);
    if (!videoEl || videoEl.readyState < 2) return;

    // Face detection at FPS — strict monotonic timestamp guard
    if (faceLandmarker &&
        ms - lastFaceTimestampMs >= FRAME_INTERVAL &&
        ms > lastFaceTimestampMs) {
      try {
        window.faceResults = faceLandmarker.detectForVideo(videoEl, ms);
        lastFaceTimestampMs = ms;
      } catch (err) {
        console.warn('[Camera] Face detection error:', err.message || err);
      }
    }

    // Hand detection at HAND_FPS — only when HandLandmarker is ready
    // Uses a separate timestamp so it never conflicts with the face loop
    if (handLandmarker &&
        window.handAvailable &&
        ms - lastHandTimestampMs >= HAND_INTERVAL &&
        ms > lastHandTimestampMs) {
      try {
        window.handResults = handLandmarker.detectForVideo(videoEl, ms);
        lastHandTimestampMs = ms;
      } catch (_) {
        // Hand detection is optional — silent failure keeps face tracking alive
      }
    }

    // Object detection at OBJ_FPS — only when ObjectDetector is ready
    // Uses its own timestamp; a separate cadence keeps GPU load manageable.
    if (objDetector &&
        window.objAvailable &&
        ms - lastObjTimestampMs >= OBJ_INTERVAL &&
        ms > lastObjTimestampMs) {
      try {
        const res = objDetector.detectForVideo(videoEl, ms);
        window.objResults    = res?.detections || [];
        lastObjTimestampMs   = ms;
      } catch (_) {
        window.objResults = [];
      }
    }
  }

  // ── ObjectDetector (lazy, optional) ────────────────────────────────────────
  // EfficientDet-Lite0 COCO — "cell phone" label.
  // Runs at OBJ_FPS inside _loop() after init completes.
  // GPU delegate preferred; falls back silently on failure.

  const OBJ_FPS      = 5;
  const OBJ_INTERVAL = Math.round(1000 / OBJ_FPS);  // 200 ms

  async function _initObjDetector() {
    if (_objInitPending || _objInitDone) return;
    _objInitPending = true;
    try {
      const { ObjectDetector, FilesetResolver } = window;
      if (!ObjectDetector) {
        console.warn('[Camera] window.ObjectDetector not found — phone object detection disabled');
        return;
      }
      if (!FilesetResolver) {
        console.warn('[Camera] window.FilesetResolver not found — phone object detection disabled');
        return;
      }

      const wasmPath = '../node_modules/@mediapipe/tasks-vision/wasm';
      const vision   = await FilesetResolver.forVisionTasks(wasmPath);

      const modelUrl = 'https://storage.googleapis.com/mediapipe-models/' +
        'object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

      objDetector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: 'GPU',
        },
        scoreThreshold: 0.25,
        maxResults:     5,
        runningMode:    'VIDEO',
      });

      window.objAvailable = true;
      _objInitDone = true;
      console.log('[Camera] ObjectDetector ready (GPU) — phone detection enabled');
    } catch (err) {
      console.warn('[Camera] ObjectDetector init failed (phone detection disabled):', err.message || err);
      window.objAvailable = false;
    } finally {
      _objInitPending = false;
    }
  }

  return { init };
})();
