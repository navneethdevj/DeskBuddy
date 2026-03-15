/**
 * Camera — webcam access and MediaPipe FaceLandmarker.
 *
 * Responsibilities:
 *   1. Request camera permission and attach stream to #camera-feed video element.
 *   2. Initialize MediaPipe FaceLandmarker with VIDEO mode.
 *   3. Run detection at a controlled 12 FPS (never more — performance budget).
 *   4. Write raw results to window.faceResults every detection frame.
 *
 * This module is entirely invisible. It never renders anything.
 * All errors are caught and logged — camera failure is non-fatal.
 * window.cameraAvailable (boolean) signals to other modules whether camera works.
 */
const Camera = (() => {

  // ── Config ────────────────────────────────────────────────────────────────
  const TARGET_FPS        = 12;
  const FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS);  // ~83ms
  const INIT_TIMEOUT_MS   = 10000;  // 10s max wait for video ready

  // ── State ─────────────────────────────────────────────────────────────────
  let faceLandmarker   = null;
  let videoEl          = null;
  let lastDetectionMs  = 0;
  let running          = false;

  // ── Public globals written by this module ─────────────────────────────────
  window.cameraAvailable = false;
  window.faceResults     = null;

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Main entry point. Called from renderer.js after Brain.start().
   * Async — does not block the main animation loop.
   */
  async function init() {
    videoEl = document.getElementById('camera-feed');
    if (!videoEl) {
      console.warn('[Camera] #camera-feed element missing from HTML');
      return;
    }

    try {
      await _initMediaPipe();
      await _initWebcam();
      window.cameraAvailable = true;
      running = true;
      requestAnimationFrame(_detectionLoop);
      console.log('[Camera] Ready — running at', TARGET_FPS, 'FPS');
    } catch (err) {
      console.warn('[Camera] Unavailable:', err.message);
      window.cameraAvailable = false;
      // App continues in fallback mode — cursor-based gaze still works until Phase 2
    }
  }

  function isAvailable() {
    return window.cameraAvailable;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async function _initMediaPipe() {
    const { FaceLandmarker, FilesetResolver } = window;

    if (typeof FaceLandmarker === 'undefined' || typeof FilesetResolver === 'undefined') {
      throw new Error('MediaPipe not loaded — check CDN script tag in index.html');
    }

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: [
          'https://storage.googleapis.com/mediapipe-models/',
          'face_landmarker/face_landmarker/float16/1/face_landmarker.task'
        ].join(''),
        delegate: 'GPU'
      },
      outputFaceBlendshapes:             true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1
    });
  }

  async function _initWebcam() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false
    });

    videoEl.srcObject = stream;

    await new Promise((resolve, reject) => {
      videoEl.addEventListener('loadeddata', resolve, { once: true });
      videoEl.addEventListener('error',      reject,  { once: true });
      setTimeout(() => reject(new Error('Video ready timeout')), INIT_TIMEOUT_MS);
    });
  }

  function _detectionLoop(timestamp) {
    if (!running) return;
    requestAnimationFrame(_detectionLoop);

    // Rate-gate to TARGET_FPS
    if (timestamp - lastDetectionMs < FRAME_INTERVAL_MS) return;

    // Guard: video must be streaming
    if (!faceLandmarker || !videoEl || videoEl.readyState < 2) return;

    try {
      window.faceResults = faceLandmarker.detectForVideo(videoEl, timestamp);
      lastDetectionMs = timestamp;
    } catch (_) {
      // Detection errors are non-fatal — next frame will retry
    }
  }

  return { init, isAvailable };

})();
