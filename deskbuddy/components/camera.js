/**
 * Camera — webcam access and MediaPipe FaceLandmarker.
 * Phase 1: Provides window.faceResults and window.cameraAvailable.
 */
const Camera = (() => {

  const TARGET_FPS        = 12;
  const FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS);
  const INIT_TIMEOUT_MS   = 10000;

  let faceLandmarker  = null;
  let videoEl         = null;
  let lastDetectionMs = 0;
  let running         = false;

  window.cameraAvailable = false;
  window.faceResults     = null;

  async function init() {
    console.log('[Camera] init() called');

    videoEl = document.getElementById('camera-feed');
    if (!videoEl) {
      console.error('[Camera] FAIL — #camera-feed element not found in HTML');
      return;
    }
    console.log('[Camera] video element found');

    // Step 1: Check navigator.mediaDevices
    console.log('[Camera] navigator.mediaDevices:', navigator.mediaDevices);
    console.log('[Camera] getUserMedia:', navigator.mediaDevices?.getUserMedia);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error('[Camera] FAIL — navigator.mediaDevices.getUserMedia not available');
      console.error('[Camera] This usually means Electron camera permission was denied before the request');
      window.cameraAvailable = false;
      return;
    }

    try {
      // Step 2: Request camera
      console.log('[Camera] Requesting camera via getUserMedia...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false
      });
      console.log('[Camera] Camera stream obtained:', stream);

      videoEl.srcObject = stream;
      console.log('[Camera] Stream attached to video element');

      // Step 3: Wait for video
      await new Promise((resolve, reject) => {
        videoEl.addEventListener('loadeddata', () => {
          console.log('[Camera] Video ready — readyState:', videoEl.readyState);
          resolve();
        }, { once: true });
        videoEl.addEventListener('error', (e) => {
          console.error('[Camera] Video error:', e);
          reject(e);
        }, { once: true });
        setTimeout(() => reject(new Error('Video ready timeout after 10s')), INIT_TIMEOUT_MS);
      });

      // Step 4: Load MediaPipe
      console.log('[Camera] Loading MediaPipe FaceLandmarker...');
      console.log('[Camera] FaceLandmarker on window:', typeof window.FaceLandmarker);
      console.log('[Camera] FilesetResolver on window:', typeof window.FilesetResolver);

      await _initMediaPipe();
      console.log('[Camera] MediaPipe ready');

      window.cameraAvailable = true;
      running = true;
      requestAnimationFrame(_detectionLoop);
      console.log('[Camera] READY — running at', TARGET_FPS, 'FPS');

    } catch (err) {
      console.error('[Camera] FAILED at some step above');
      console.error('[Camera] Error name:', err.name);
      console.error('[Camera] Error message:', err.message);
      console.error('[Camera] Full error:', err);
      window.cameraAvailable = false;
    }
  }

  async function _initMediaPipe() {
    const { FaceLandmarker, FilesetResolver } = window;

    if (typeof FaceLandmarker === 'undefined' || typeof FilesetResolver === 'undefined') {
      throw new Error('MediaPipe CDN script not loaded — FaceLandmarker or FilesetResolver undefined');
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
      outputFaceBlendshapes:              true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1
    });
  }

  let _detectionCount = 0;

  function _detectionLoop(timestamp) {
    if (!running) return;
    requestAnimationFrame(_detectionLoop);
    if (timestamp - lastDetectionMs < FRAME_INTERVAL_MS) return;
    if (!faceLandmarker || !videoEl || videoEl.readyState < 2) return;
    try {
      window.faceResults = faceLandmarker.detectForVideo(videoEl, timestamp);
      lastDetectionMs = timestamp;
      _detectionCount++;
      // Log first detection, then every 60 frames (~5s)
      if (_detectionCount === 1 || _detectionCount % 60 === 0) {
        const faces = window.faceResults?.faceLandmarks?.length ?? 0;
        console.log('[Camera] Detection #' + _detectionCount + ' — faces found:', faces);
      }
    } catch (err) {
      console.error('[Camera] Detection error:', err.message);
    }
  }

  function isAvailable() { return window.cameraAvailable; }

  return { init, isAvailable };

})();
