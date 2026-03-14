/**
 * Basic webcam access module.
 * Requests camera permission and runs the stream in the background.
 * The video is never displayed in the UI.
 */
var CameraAccess = (function () {
  var stream = null;

  function init() {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(function (s) {
        stream = s;
        console.log('Camera access granted');
      })
      .catch(function (err) {
        console.log('Camera access denied');
      });
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
  }

  return { init: init, stop: stop };
})();
