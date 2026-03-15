/**
 * Camera — webcam access and MediaPipe FaceLandmarker.
 * Runs at 12 FPS. Writes window.faceResults and window.cameraAvailable.
 * Completely invisible — never renders anything.
 * All failures are non-fatal and logged only.
 */
const Camera = (() => {

  const TARGET_FPS        = 12;
  const FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS); // ~83ms
  const VIDEO_TIMEOUT_MS  = 10000;

  let faceLandmarker  = null;
  let videoEl         = null;
  let lastDetectionMs = 0;
  let running         = false;

  window.cameraAvailable = false;
  window.faceResults     = null;

  async function init() {
    videoEl = document.getElementById('camera-feed');
    if (!videoEl) {
      console.warn('[Camera] #camera-feed element not found');
      return;
    }

    try {
      await _initWebcam();
      await _initMediaPipe();
      window.cameraAvailable = true;
      running = true;
      requestAnimationFrame(_loop);
      console.log('[Camera] Ready at', TARGET_FPS, 'FPS');
    } catch (err) {
      console.warn('[Camera] Unavailable —', err.name + ':', err.message);
      window.cameraAvailable = false;
    }
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
      setTimeout(() => reject(new Error('Video timeout')), VIDEO_TIMEOUT_MS);
    });
  }

  async function _initMediaPipe() {
    const { FaceLandmarker, FilesetResolver } = window;
    if (!FaceLandmarker || !FilesetResolver) {
      throw new Error('MediaPipe CDN not loaded — check script tag in index.html');
    }

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/' +
          'face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'CPU'   // CPU is more reliable across systems than GPU
      },
      outputFaceBlendshapes:              true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1
    });
  }

  function _loop(timestamp) {
    if (!running) return;
    requestAnimationFrame(_loop);

    if (timestamp - lastDetectionMs < FRAME_INTERVAL_MS) return;
    if (!faceLandmarker || !videoEl || videoEl.readyState < 2) return;

    try {
      window.faceResults = faceLandmarker.detectForVideo(videoEl, timestamp);
      lastDetectionMs = timestamp;
    } catch (_) {
      // per-frame errors are non-fatal
    }
  }

  return { init };
})();
