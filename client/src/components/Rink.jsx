import { useEffect, useRef } from 'react';

/**
 * Canvas renderer + input capture.
 * The server owns physics; we interpolate snapshots for smooth motion.
 */
export default function Rink({ field, state, players, mySlot, onInput }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const latest = useRef(state);
  const render = useRef({
    puck: { x: field.width / 2, y: field.height / 2 },
    home: { x: 120, y: field.height / 2 },
    away: { x: field.width - 120, y: field.height / 2 },
  });

  latest.current = state;

  // Pointer / touch input -> normalized field coordinates.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const send = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * field.width;
      const y = ((clientY - rect.top) / rect.height) * field.height;
      onInput(x, y);
    };

    const onPointer = (e) => {
      e.preventDefault();
      send(e.clientX, e.clientY);
    };
    const onTouch = (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) send(t.clientX, t.clientY);
    };

    canvas.addEventListener('pointermove', onPointer, { passive: false });
    canvas.addEventListener('pointerdown', onPointer, { passive: false });
    canvas.addEventListener('touchmove', onTouch, { passive: false });
    canvas.addEventListener('touchstart', onTouch, { passive: false });

    // Keyboard fallback (arrows / WASD) for players without a mouse.
    const keys = new Set();
    const pos = { x: mySlot === 'home' ? 120 : field.width - 120, y: field.height / 2 };
    const kd = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      keys.add(e.key.toLowerCase());
    };
    const ku = (e) => keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    const kbTimer = setInterval(() => {
      if (keys.size === 0) return;
      const sp = 13;
      if (keys.has('arrowup') || keys.has('w')) pos.y -= sp;
      if (keys.has('arrowdown') || keys.has('s')) pos.y += sp;
      if (keys.has('arrowleft') || keys.has('a')) pos.x -= sp;
      if (keys.has('arrowright') || keys.has('d')) pos.x += sp;
      pos.x = Math.max(0, Math.min(field.width, pos.x));
      pos.y = Math.max(0, Math.min(field.height, pos.y));
      onInput(pos.x, pos.y);
    }, 1000 / 60);

    return () => {
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerdown', onPointer);
      canvas.removeEventListener('touchmove', onTouch);
      canvas.removeEventListener('touchstart', onTouch);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      clearInterval(kbTimer);
    };
  }, [field.width, field.height, mySlot, onInput]);

  // Draw loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;

    const resize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const cssW = wrap.clientWidth;
      const cssH = (cssW * field.height) / field.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr * (cssW / field.width), 0, 0, dpr * (cssH / field.height), 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const lerp = (a, b, t) => a + (b - a) * t;

    const draw = () => {
      const s = latest.current;
      const r = render.current;
      if (s) {
        const t = 0.32;
        r.puck.x = lerp(r.puck.x, s.puck.x, t);
        r.puck.y = lerp(r.puck.y, s.puck.y, t);
        r.home.x = lerp(r.home.x, s.paddles.home.x, 0.45);
        r.home.y = lerp(r.home.y, s.paddles.home.y, 0.45);
        r.away.x = lerp(r.away.x, s.paddles.away.x, 0.45);
        r.away.y = lerp(r.away.y, s.paddles.away.y, 0.45);
      }

      const W = field.width;
      const H = field.height;
      const gh = field.goalHeight;

      // Ice
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#0d1730');
      grad.addColorStop(0.5, '#122142');
      grad.addColorStop(1, '#0d1730');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Center line + circle
      ctx.strokeStyle = 'rgba(140,180,255,0.22)';
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 12]);
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(W / 2, H / 2, 95, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(140,180,255,0.35)';
      ctx.fill();

      // Goal creases
      [0, W].forEach((gx, i) => {
        ctx.beginPath();
        ctx.arc(gx, H / 2, 130, i === 0 ? -Math.PI / 2 : Math.PI / 2, i === 0 ? Math.PI / 2 : -Math.PI / 2);
        ctx.strokeStyle = 'rgba(140,180,255,0.18)';
        ctx.stroke();
      });

      // Goal mouths
      const homeColor = players?.home?.color || '#22d3ee';
      const awayColor = players?.away?.color || '#ff3b6b';
      ctx.lineWidth = 8;
      ctx.strokeStyle = homeColor;
      ctx.shadowColor = homeColor;
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.moveTo(3, H / 2 - gh / 2);
      ctx.lineTo(3, H / 2 + gh / 2);
      ctx.stroke();

      ctx.strokeStyle = awayColor;
      ctx.shadowColor = awayColor;
      ctx.beginPath();
      ctx.moveTo(W - 3, H / 2 - gh / 2);
      ctx.lineTo(W - 3, H / 2 + gh / 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Border
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(150,190,255,0.28)';
      ctx.strokeRect(2.5, 2.5, W - 5, H - 5);

      const drawPaddle = (p, color, isMe) => {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 26;
        ctx.beginPath();
        ctx.arc(p.x, p.y, field.paddleRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, field.paddleRadius * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, field.paddleRadius, 0, Math.PI * 2);
        ctx.lineWidth = isMe ? 4 : 2;
        ctx.strokeStyle = isMe ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)';
        ctx.stroke();
        ctx.restore();
      };

      drawPaddle(r.home, homeColor, mySlot === 'home');
      drawPaddle(r.away, awayColor, mySlot === 'away');

      // Puck
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.85)';
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(r.puck.x, r.puck.y, field.puckRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fbff';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(r.puck.x, r.puck.y, field.puckRadius * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,160,220,0.5)';
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [field, players, mySlot]);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}
