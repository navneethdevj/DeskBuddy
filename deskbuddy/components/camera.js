/**
 * Camera — MediaPipe FaceLandmarker.
 * Reference: https://github.com/google-ai-edge/mediapipe
 * Docs: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
 *
 * Runs at 15 FPS. Writes window.faceResults each detection frame.
 * window.cameraAvailable = false means app uses fallback (existing) behavior.
 *
 * Iris landmarks:
 *   Left iris center  = lm[468]
 *   Right iris center = lm[473]
 */
const Camera = (() => {

  const FPS            = 15;
  const FRAME_INTERVAL = Math.round(1000 / FPS);
  const VIDEO_TIMEOUT  = 10000;

  let landmarker     = null;
  let videoEl        = null;
  let lastTimestampMs = -1;
  let running        = false;

  window.cameraAvailable = false;
  window.faceResults     = null;

  async function init() {
    videoEl = document.getElementById('camera-feed');
    if (!videoEl) { console.warn('[Camera] #camera-feed not found'); return; }

    try {
      console.log('[Camera] Starting webcam…');
      await _startWebcam();
      console.log('[Camera] Webcam started — initializing MediaPipe…');
      try {
        await _initLandmarker();
      } catch (err) {
        // §4.3 — _startWebcam succeeded but _initLandmarker threw: the stream
        // is still open so the camera LED stays on.  Stop it explicitly here.
        if (videoEl && videoEl.srcObject) {
          videoEl.srcObject.getTracks().forEach(t => t.stop());
          videoEl.srcObject = null;
        }
        throw err;
      }
      window.cameraAvailable = true;
      running = true;
      requestAnimationFrame(_loop);
      console.log('[Camera] Ready — %d FPS, iris landmarks enabled', FPS);
    } catch (err) {
      console.warn('[Camera] Unavailable —', err.message || err);
    }
  }

  async function _startWebcam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('navigator.mediaDevices.getUserMedia not available');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }, audio: false
    });
    videoEl.srcObject = stream;
    try {
      await new Promise((resolve, reject) => {
        videoEl.addEventListener('loadeddata', resolve, { once: true });
        videoEl.addEventListener('error',      reject,  { once: true });
        setTimeout(() => reject(new Error('Video element did not fire loadeddata within 10 s')), VIDEO_TIMEOUT);
      });
    } catch (err) {
      // Camera stream must be stopped explicitly; otherwise the camera LED
      // stays on even though the app will operate in no-camera fallback mode.
      stream.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
      throw err;
    }
    console.log('[Camera] Video ready — readyState=%d, %dx%d',
      videoEl.readyState, videoEl.videoWidth, videoEl.videoHeight);
  }

  async function _initLandmarker() {
    const { FaceLandmarker, FilesetResolver } = window;
    if (!FaceLandmarker) throw new Error('window.FaceLandmarker is undefined — CJS shim failed');
    if (!FilesetResolver) throw new Error('window.FilesetResolver is undefined — CJS shim failed');

    const wasmPath = '../node_modules/@mediapipe/tasks-vision/wasm';
    console.log('[Camera] Loading WASM fileset from', wasmPath);
    const vision = await FilesetResolver.forVisionTasks(wasmPath);
    console.log('[Camera] WASM fileset resolved:', JSON.stringify(vision));

    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/' +
      'face_landmarker/face_landmarker/float16/1/face_landmarker.task';
    console.log('[Camera] Creating FaceLandmarker (model: %s)…', modelUrl);

    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelUrl,
        delegate: 'CPU'
      },
      outputFaceBlendshapes:              true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1
    });
    console.log('[Camera] FaceLandmarker created successfully');
  }

  function _loop(timestamp) {
    if (!running) return;
    requestAnimationFrame(_loop);

    // Enforce frame interval
    const ms = Math.round(timestamp);
    if (ms - lastTimestampMs < FRAME_INTERVAL) return;
    if (!landmarker || !videoEl || videoEl.readyState < 2) return;

    // detectForVideo requires strictly increasing integer timestamps
    if (ms <= lastTimestampMs) return;

    try {
      window.faceResults = landmarker.detectForVideo(videoEl, ms);
      lastTimestampMs = ms;
    } catch (err) {
      console.warn('[Camera] Detection error:', err.message || err);
    }
  }

  return { init };
})();
