/**
 * Sprite Animation Engine.
 * Manages frame-based animations for the companion.
 * Uses CSS classes as placeholder frames until real sprite images are available.
 *
 * Animations run at 6–12 FPS independently from the 60 FPS movement loop.
 */
const SpriteAnimator = (() => {
  const animations = {
    idle: { frames: ['sprite-idle-1', 'sprite-idle-2', 'sprite-idle-3', 'sprite-idle-2'], fps: 6, loop: true },
    walk: { frames: ['sprite-walk-1', 'sprite-walk-2', 'sprite-walk-3', 'sprite-walk-4'], fps: 8, loop: true },
    jump: { frames: ['sprite-jump-1', 'sprite-jump-2', 'sprite-jump-3'], fps: 10, loop: false }
  };

  let currentAnim = null;
  let currentFrame = 0;
  let frameTimer = null;
  let element = null;
  let onComplete = null;

  /** All unique frame class names, built once on init for quick removal. */
  let allFrameClasses = [];

  /**
   * Bind the animator to a companion DOM element and start the idle animation.
   */
  function init(el) {
    element = el;
    allFrameClasses = [];
    Object.values(animations).forEach(function (a) {
      a.frames.forEach(function (f) {
        if (allFrameClasses.indexOf(f) === -1) allFrameClasses.push(f);
      });
    });
    element.classList.add('sprite-active');
    play('idle');
  }

  /**
   * Play a named animation.
   * @param {string} name  Animation key (idle | walk | jump).
   * @param {Function} [callback]  Called when a non-looping animation finishes.
   */
  function play(name, callback) {
    if (!animations[name]) return;
    if (name === currentAnim && frameTimer) return;

    currentAnim = name;
    currentFrame = 0;
    onComplete = callback || null;

    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }

    var anim = animations[name];
    var interval = Math.round(1000 / anim.fps);

    applyFrame();
    frameTimer = setInterval(function () {
      currentFrame++;
      if (currentFrame >= anim.frames.length) {
        if (anim.loop) {
          currentFrame = 0;
        } else {
          currentFrame = anim.frames.length - 1;
          clearInterval(frameTimer);
          frameTimer = null;
          if (onComplete) {
            var cb = onComplete;
            onComplete = null;
            cb();
          }
          return;
        }
      }
      applyFrame();
    }, interval);
  }

  /**
   * Apply the current frame's CSS class to the element.
   */
  function applyFrame() {
    if (!element) return;
    allFrameClasses.forEach(function (c) { element.classList.remove(c); });
    var anim = animations[currentAnim];
    if (anim) {
      element.classList.add(anim.frames[currentFrame]);
    }
  }

  /**
   * Return the name of the currently playing animation.
   */
  function getAnimation() {
    return currentAnim;
  }

  /**
   * Stop the frame timer.
   */
  function stop() {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
  }

  return { init: init, play: play, getAnimation: getAnimation, stop: stop };
})();
