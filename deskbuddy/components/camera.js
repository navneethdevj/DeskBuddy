/**
 * Camera — MediaPipe FaceLandmarker.
 * Reference: https://github.com/google-ai-edge/mediapipe
 * Docs: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
 *
 * Runs at 15 FPS. Writes window.faceResults each detection frame.
 * window.cameraAvailable = false means app uses fallback (existing) behavior.
 *
 * Iris landmarks for Chunk 2:
 *   Left iris center  = lm[468]
 *   Right iris center = lm[473]
 */
const Camera = (() => {

  const FPS            = 15;
  const FRAME_INTERVAL = Math.round(1000 / FPS);
  const VIDEO_TIMEOUT  = 10000;

  let landmarker  = null;
  let videoEl     = null;
  let lastFrameMs = 0;
  let running     = false;

  window.cameraAvailable = false;
  window.faceResults     = null;

  async function init() {
    videoEl = document.getElementById('camera-feed');
    if (!videoEl) { console.warn('[Camera] #camera-feed not found'); return; }

    try {
      await _startWebcam();
      await _initLandmarker();
      window.cameraAvailable = true;
      running = true;
      requestAnimationFrame(_loop);
      console.log('[Camera] Ready — 15 FPS, iris landmarks enabled');
    } catch (err) {
      console.warn('[Camera] Unavailable —', err.message);
      // Non-fatal — app continues with original cursor-based behavior
    }
  }

  async function _startWebcam() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }, audio: false
    });
    videoEl.srcObject = stream;
    await new Promise((resolve, reject) => {
      videoEl.addEventListener('loadeddata', resolve, { once: true });
      videoEl.addEventListener('error',      reject,  { once: true });
      setTimeout(() => reject(new Error('Video timeout')), VIDEO_TIMEOUT);
    });
  }

  async function _initLandmarker() {
    // FaceLandmarker + FilesetResolver come from vision_bundle.cjs on window
    const { FaceLandmarker, FilesetResolver } = window;
    if (!FaceLandmarker || !FilesetResolver) {
      throw new Error('MediaPipe not loaded — check vision_bundle.cjs script tag in index.html');
    }

    const vision = await FilesetResolver.forVisionTasks(
      '../node_modules/@mediapipe/tasks-vision/wasm'
    );

    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/' +
          'face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'CPU'  // GPU causes silent failures on many systems
      },
      outputFaceBlendshapes:              true,  // needed: smile, blink, expressions
      outputFacialTransformationMatrixes: true,  // needed: yaw/pitch/roll head pose
      runningMode: 'VIDEO',
      numFaces: 1
    });
  }

  function _loop(timestamp) {
    if (!running) return;
    requestAnimationFrame(_loop);
    if (timestamp - lastFrameMs < FRAME_INTERVAL) return;
    if (!landmarker || !videoEl || videoEl.readyState < 2) return;
    try {
      window.faceResults = landmarker.detectForVideo(videoEl, timestamp);
      lastFrameMs = timestamp;
    } catch (_) {}
  }

  return { init };
})();
