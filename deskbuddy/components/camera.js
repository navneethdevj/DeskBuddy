/**
 * Camera — MediaPipe FaceLandmarker (multi-face) + HandLandmarker (lazy, optional).
 *
 * PERFORMANCE TUNING:
 *   Face:  12 FPS  — was 15, saves ~20% GPU load
 *   Hand:   3 FPS  — was 10; waves are slow gestures, 3fps is enough
 *   Object: 3 FPS  — was 5; phone detection doesn't need fast refresh
 *
 * HOW TO TRIGGER WAVE DETECTION:
 *   Raise your hand so your wrist is in the upper 70% of the camera frame.
 *   Wave it clearly left-right at least 3 times within ~1.5 seconds.
 *
 * tick(timestamp) called by Brain's rAF loop — no self-scheduled RAF.
 */
const Camera = (() => {

  const FPS             = 12;
  const FRAME_INTERVAL  = Math.round(1000 / FPS);       // ~84ms
  const HAND_FPS        = 3;
  const HAND_INTERVAL   = Math.round(1000 / HAND_FPS);  // ~334ms
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

  window.cameraAvailable = false;
  window.faceResults     = null;
  window.handResults     = null;
  window.handAvailable   = false;
  window.objResults      = [];
  window.objAvailable    = false;

  async function init() {
    videoEl = document.getElementById('camera-feed');
    if (!videoEl) { console.warn('[Camera] #camera-feed not found'); return; }
    try {
      await _startWebcam();
      await _initFaceLandmarker();
      window.cameraAvailable = true;
      running = true;
      console.log('[Camera] FaceLandmarker ready — %dFPS', FPS);
      setTimeout(_initHandLandmarker, 3000);
      setTimeout(_initObjDetector,    5000);
    } catch (err) {
      console.warn('[Camera] Unavailable —', err.message || err);
    }
  }

  async function _startWebcam() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('getUserMedia not available');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    videoEl.srcObject = stream;
    await new Promise((resolve, reject) => {
      videoEl.addEventListener('loadeddata', resolve, { once: true });
      videoEl.addEventListener('error',      reject,  { once: true });
      setTimeout(() => reject(new Error('Video timeout')), VIDEO_TIMEOUT);
    });
  }

  async function _initFaceLandmarker() {
    const { FaceLandmarker, FilesetResolver } = window;
    if (!FaceLandmarker || !FilesetResolver)
      throw new Error('MediaPipe Vision not loaded');
    const vision = await FilesetResolver.forVisionTasks(
      '../node_modules/@mediapipe/tasks-vision/wasm'
    );
    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/' +
      'face_landmarker/face_landmarker/float16/1/face_landmarker.task';
    for (const delegate of ['GPU', 'CPU']) {
      try {
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelUrl, delegate },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: 'VIDEO',
          numFaces: 4,
        });
        console.log('[Camera] FaceLandmarker: %s', delegate);
        return;
      } catch (_) {}
    }
    throw new Error('FaceLandmarker failed on all delegates');
  }

  async function _initHandLandmarker() {
    if (_handInitPending || _handInitDone) return;
    _handInitPending = true;
    try {
      const { HandLandmarker, FilesetResolver } = window;
      if (!HandLandmarker || !FilesetResolver) {
        console.warn('[Camera] HandLandmarker not available');
        return;
      }
      const vision = await FilesetResolver.forVisionTasks(
        '../node_modules/@mediapipe/tasks-vision/wasm'
      );
      const modelUrl = 'https://storage.googleapis.com/mediapipe-models/' +
        'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
      for (const delegate of ['GPU', 'CPU']) {
        try {
          handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: modelUrl, delegate },
            runningMode: 'VIDEO',
            numHands: 1,
          });
          window.handAvailable = true;
          _handInitDone = true;
          console.log('[Camera] HandLandmarker: %s at %dFPS — wave: raise hand + wave left-right 3x', delegate, HAND_FPS);
          return;
        } catch (_) {}
      }
      console.warn('[Camera] HandLandmarker unavailable — wave disabled');
    } catch (err) {
      console.warn('[Camera] HandLandmarker error:', err.message);
    } finally {
      _handInitPending = false;
    }
  }

  function tick(timestamp) {
    if (!running) return;
    const ms = Math.round(timestamp);
    if (!videoEl || videoEl.readyState < 2) return;

    if (faceLandmarker && ms - lastFaceTimestampMs >= FRAME_INTERVAL && ms > lastFaceTimestampMs) {
      try {
        window.faceResults  = faceLandmarker.detectForVideo(videoEl, ms);
        lastFaceTimestampMs = ms;
      } catch (err) {
        console.warn('[Camera] Face error:', err.message);
      }
    }

    if (handLandmarker && window.handAvailable &&
        ms - lastHandTimestampMs >= HAND_INTERVAL && ms > lastHandTimestampMs) {
      try {
        window.handResults  = handLandmarker.detectForVideo(videoEl, ms);
        lastHandTimestampMs = ms;
      } catch (_) {}
    }

    if (objDetector && window.objAvailable &&
        ms - lastObjTimestampMs >= OBJ_INTERVAL && ms > lastObjTimestampMs) {
      try {
        const res        = objDetector.detectForVideo(videoEl, ms);
        window.objResults  = res?.detections || [];
        lastObjTimestampMs = ms;
      } catch (_) {
        window.objResults = [];
      }
    }
  }

  const OBJ_FPS      = 3;
  const OBJ_INTERVAL = Math.round(1000 / OBJ_FPS);

  async function _initObjDetector() {
    if (_objInitPending || _objInitDone) return;
    _objInitPending = true;
    try {
      const { ObjectDetector, FilesetResolver } = window;
      if (!ObjectDetector || !FilesetResolver) { return; }
      const vision = await FilesetResolver.forVisionTasks(
        '../node_modules/@mediapipe/tasks-vision/wasm'
      );
      const modelUrl = 'https://storage.googleapis.com/mediapipe-models/' +
        'object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
      objDetector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
        scoreThreshold: 0.30,
        maxResults:     3,
        runningMode: 'VIDEO',
      });
      window.objAvailable = true;
      _objInitDone = true;
      console.log('[Camera] ObjectDetector ready at %dFPS', OBJ_FPS);
    } catch (err) {
      console.warn('[Camera] ObjectDetector failed:', err.message);
    } finally {
      _objInitPending = false;
    }
  }

  return { init, tick };
})();
