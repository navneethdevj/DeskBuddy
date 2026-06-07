import { useState, useEffect, useRef, useCallback } from 'react';

interface SplashScreenProps {
  /** Set to true when the app has finished its async boot work */
  isReady?: boolean;
  /** Minimum ms to display the splash, regardless of isReady */
  minDuration?: number;
}

// ── Stage definitions ────────────────────────────────────────────────────────
const STAGES = [
  { text: 'Initializing DeskBuddy…',   pct: 10 },
  { text: 'Verifying your session…',    pct: 32 },
  { text: 'Loading workspaces…',         pct: 58 },
  { text: 'Syncing tasks and notes…',    pct: 82 },
  { text: 'Everything is ready  ✦',     pct: 100 },
] as const;

const LOGO = 'DeskBuddy';

// ── Particle system ──────────────────────────────────────────────────────────
interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  a: number; // base opacity
}

const mkParticles = (w: number, h: number, n = 60): Particle[] =>
  Array.from({ length: n }, () => ({
    x:  Math.random() * w,
    y:  Math.random() * h,
    vx: (Math.random() - 0.5) * 0.45,
    vy: (Math.random() - 0.5) * 0.45,
    r:  Math.random() * 1.8 + 0.4,
    a:  Math.random() * 0.45 + 0.08,
  }));

// ── Ring marker dots ─────────────────────────────────────────────────────────
const RingDots = ({ radius, count }: { radius: number; count: number }): JSX.Element => (
  <>
    {Array.from({ length: count }, (_, i) => {
      const rad = ((i / count) * 360 - 90) * (Math.PI / 180);
      return (
        <circle
          key={i}
          r={radius > 80 ? 1.8 : 2.5}
          cx={Math.cos(rad) * radius + 130}
          cy={Math.sin(rad) * radius + 130}
          fill="#e8963a"
          fillOpacity={radius > 80 ? 0.45 : 0.7}
        />
      );
    })}
  </>
);

// ── Main component ────────────────────────────────────────────────────────────
export const SplashScreen = ({
  isReady    = false,
  minDuration = 2700,
}: SplashScreenProps): JSX.Element | null => {
  const [stageIdx, setStageIdx]   = useState(0);
  const [exiting,  setExiting]    = useState(false);
  const [visible,  setVisible]    = useState(true);
  const [minDone,  setMinDone]    = useState(false);

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const mouseRef   = useRef({ x: -9999, y: -9999 });
  const rafRef     = useRef<number>(0);
  const ptsRef     = useRef<Particle[]>([]);
  const exitRef    = useRef(false);

  // ── Stage timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    STAGES.forEach((_, i) => {
      if (i === 0) return;
      timers.push(setTimeout(() => setStageIdx(i), i * 490));
    });
    const min = setTimeout(() => setMinDone(true), minDuration);
    return () => { timers.forEach(clearTimeout); clearTimeout(min); };
  }, [minDuration]);

  // ── Exit trigger ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!minDone || !isReady) return;
    setExiting(true);
    exitRef.current = true;
    const t = setTimeout(() => setVisible(false), 750);
    return () => clearTimeout(t);
  }, [minDone, isReady]);

  // ── Canvas particle loop ───────────────────────────────────────────────────
  const startCanvas = useCallback((): (() => void) => {
    const canvas = canvasRef.current;
    const ctx    = canvas?.getContext('2d');
    if (!canvas || !ctx) return () => undefined;

    const resize = (): void => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      ptsRef.current = mkParticles(canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const tick = (): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { x: mx, y: my } = mouseRef.current;
      const pts = ptsRef.current;
      const cx  = canvas.width  / 2;
      const cy  = canvas.height / 2;

      pts.forEach((p, i) => {
        // Mouse repulsion
        const mdx  = p.x - mx;
        const mdy  = p.y - my;
        const mdist = Math.hypot(mdx, mdy);
        if (mdist < 120 && mdist > 0) {
          const f = ((120 - mdist) / 120) * 0.5;
          p.vx += (mdx / mdist) * f;
          p.vy += (mdy / mdist) * f;
        }

        // Exit: particles scatter from centre
        if (exitRef.current) {
          const edx = p.x - cx;
          const edy = p.y - cy;
          const ed  = Math.hypot(edx, edy) || 1;
          p.vx += (edx / ed) * 0.35;
          p.vy += (edy / ed) * 0.35;
          p.a  *= 0.97;
        }

        // Dampen + move
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.x  += p.vx;
        p.y  += p.vy;

        // Wrap edges
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width)  p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        // Draw dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232,150,58,${p.a})`;
        ctx.fill();

        // Draw connections to nearby particles
        for (let j = i + 1; j < pts.length; j++) {
          const q    = pts[j]!;
          const dist = Math.hypot(p.x - q.x, p.y - q.y);
          if (dist < 140) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            const a = (1 - dist / 140) * 0.09 * (p.a / 0.45);
            ctx.strokeStyle = `rgba(232,150,58,${a})`;
            ctx.lineWidth   = 0.6;
            ctx.stroke();
          }
        }
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => startCanvas(), [startCanvas]);

  // ── Mouse / touch tracking ─────────────────────────────────────────────────
  useEffect(() => {
    const onMouse = (e: MouseEvent): void => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    const onTouch = (e: TouchEvent):  void => {
      const t = e.touches[0];
      if (t) mouseRef.current = { x: t.clientX, y: t.clientY };
    };
    window.addEventListener('mousemove', onMouse);
    window.addEventListener('touchmove', onTouch, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('touchmove', onTouch);
    };
  }, []);

  if (!visible) return null;

  const stage    = STAGES[stageIdx] ?? STAGES[STAGES.length - 1]!;
  const progress = stage.pct;

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-bg select-none"
      style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, #2a2824 1px, transparent 0)',
        backgroundSize: '22px 22px',
        animation: exiting ? 'splash-exit 750ms cubic-bezier(0.4,0,1,1) forwards' : undefined,
      }}
      aria-label="Loading DeskBuddy"
      role="status"
      aria-live="polite"
    >
      {/* ── Canvas layer ────────────────────────────────────────────────── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
      />

      {/* ── Ambient centre glow ──────────────────────────────────────────── */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(232,150,58,0.08) 0%, transparent 65%)' }}
        aria-hidden="true"
      />

      {/* ── Centre content ──────────────────────────────────────────────── */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-8">

        {/* SVG ring system */}
        <div className="relative" aria-hidden="true">
          <svg viewBox="0 0 260 260" width="260" height="260">

            {/* Outer ring — very slow CW, sparse dash */}
            <circle
              cx="130" cy="130" r="120"
              fill="none" stroke="#e8963a"
              strokeWidth="1.2" strokeOpacity="0.16"
              strokeDasharray="6 10"
              style={{ transformOrigin: '130px 130px', animation: 'ring-cw 26s linear infinite' }}
            />

            {/* Mid ring — CCW, medium dash */}
            <g style={{ transformOrigin: '130px 130px', animation: 'ring-ccw 14s linear infinite' }}>
              <circle cx="130" cy="130" r="84" fill="none" stroke="#e8963a" strokeWidth="1" strokeOpacity="0.30" strokeDasharray="3 7" />
              <RingDots radius={84} count={3} />
            </g>

            {/* Inner ring — fast CW, heavy dash */}
            <g style={{ transformOrigin: '130px 130px', animation: 'ring-cw 7.5s linear infinite' }}>
              <circle cx="130" cy="130" r="52" fill="none" stroke="#e8963a" strokeWidth="2" strokeOpacity="0.55" strokeDasharray="10 5" />
              <RingDots radius={52} count={4} />
            </g>

            {/* Second inner orbit — slow CCW, thin */}
            <g style={{ transformOrigin: '130px 130px', animation: 'ring-ccw 19s linear infinite' }}>
              <circle cx="130" cy="130" r="35" fill="none" stroke="#e8963a" strokeWidth="0.8" strokeOpacity="0.22" strokeDasharray="2 4" />
            </g>

            {/* Centre glow halos */}
            <circle cx="130" cy="130" r="24" fill="#e8963a" fillOpacity="0.05" />
            <circle cx="130" cy="130" r="14" fill="#e8963a" fillOpacity="0.09" />

            {/* Pulsing core */}
            <circle
              cx="130" cy="130" r="7"
              fill="#e8963a" fillOpacity="0.45"
              style={{ transformOrigin: '130px 130px', animation: 'core-pulse 2.4s ease-in-out infinite' }}
            />
            {/* Hard centre dot */}
            <circle cx="130" cy="130" r="2.5" fill="#f0a845" />
          </svg>

          {/* "D" mark overlay — Bricolage Grotesque letterform centred in rings */}
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-fade-in text-5xl font-extrabold text-accent/20"
            style={{
              fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
              animationDelay: '0.3s',
              letterSpacing: '-0.04em',
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            D
          </span>
        </div>

        {/* Logo text — letter by letter */}
        <div className="flex items-baseline" aria-label="DeskBuddy">
          {LOGO.split('').map((char, i) => (
            <span
              key={i}
              className="inline-block animate-slide-up"
              style={{
                fontFamily:     '"Bricolage Grotesque", system-ui, sans-serif',
                fontSize:       '2.6rem',
                fontWeight:     800,
                color:          '#f0ebe0',
                letterSpacing:  '-0.025em',
                lineHeight:     1,
                animationDelay: `${0.45 + i * 0.065}s`,
              }}
            >
              {char === ' ' ? '\u00a0' : char}
            </span>
          ))}
        </div>

        {/* Stage message — re-mounts on stage change for fade-in */}
        <div className="h-5 text-center" aria-live="polite" aria-atomic="true">
          <p key={stageIdx} className="animate-fade-in text-sm text-ink-3">
            {stage.text}
          </p>
        </div>

        {/* Stage progress dots */}
        <div className="flex items-center gap-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Loading: ${progress}%`}>
          {STAGES.map((s, i) => {
            const done   = i < stageIdx;
            const active = i === stageIdx;
            return (
              <div
                key={i}
                className="rounded-full transition-all duration-500"
                style={{
                  width:           active ? '22px' : '6px',
                  height:          '6px',
                  backgroundColor: done    ? '#4caf7c'
                                  : active ? '#e8963a'
                                  :          '#2c2924',
                  opacity: done ? 0.7 : 1,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* ── Bottom progress bar ──────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-surface-2" aria-hidden="true">
        <div
          className="h-full transition-all duration-[500ms] ease-out"
          style={{
            width:      `${progress}%`,
            background: 'linear-gradient(90deg, rgba(232,150,58,0.3), #e8963a 50%, #f0a845)',
          }}
        />
      </div>

      {/* ── Version watermark ───────────────────────────────────────────── */}
      <p className="absolute bottom-3 right-4 text-[10px] text-ink-4 animate-fade-in" aria-hidden="true" style={{ animationDelay: '1s' }}>
        DeskBuddy
      </p>
    </div>
  );
};
