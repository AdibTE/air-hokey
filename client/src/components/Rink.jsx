import { useEffect, useRef } from 'react';
import { getGameSnapshot, onGameSnapshot } from '../lib/gameStream';

/**
 * Canvas renderer + input capture.
 * Own paddle is drawn from local input (no network wait).
 * Puck / opponent use server snapshots with light extrapolation.
 */
export default function Rink({ field, players, mySlot, onInput }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const localPad = useRef({
    x: mySlot === 'home' ? 120 : field.width - 120,
    y: field.height / 2,
  });
  const render = useRef({
    puck: { x: field.width / 2, y: field.height / 2 },
    home: { x: 120, y: field.height / 2 },
    away: { x: field.width - 120, y: field.height / 2 },
  });
  const lastSnap = useRef(null);
  const iceCache = useRef(null);

  useEffect(() => {
    localPad.current = {
      x: mySlot === 'home' ? 120 : field.width - 120,
      y: field.height / 2,
    };
  }, [mySlot, field.width, field.height]);

  useEffect(() => onGameSnapshot((s) => {
    lastSnap.current = s;
  }), []);

  // Pointer / touch / keyboard -> local paddle + server.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const clampPad = (x, y) => {
      const r = field.paddleRadius;
      const half = field.width / 2;
      const minX = mySlot === 'home' ? r : half + r * 0.05;
      const maxX = mySlot === 'home' ? half - r * 0.05 : field.width - r;
      return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(r, Math.min(field.height - r, y)),
      };
    };

    const apply = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * field.width;
      const y = ((clientY - rect.top) / rect.height) * field.height;
      const p = clampPad(x, y);
      localPad.current = p;
      onInput(p.x, p.y);
    };

    const onPointer = (e) => {
      e.preventDefault();
      apply(e.clientX, e.clientY);
    };
    const onTouch = (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) apply(t.clientX, t.clientY);
    };

    canvas.addEventListener('pointermove', onPointer, { passive: false });
    canvas.addEventListener('pointerdown', onPointer, { passive: false });
    canvas.addEventListener('touchmove', onTouch, { passive: false });
    canvas.addEventListener('touchstart', onTouch, { passive: false });

    const keys = new Set();
    const kd = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      keys.add(e.key.toLowerCase());
    };
    const ku = (e) => keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    const kbTimer = setInterval(() => {
      if (keys.size === 0) return;
      const sp = 16;
      let { x, y } = localPad.current;
      if (keys.has('arrowup') || keys.has('w')) y -= sp;
      if (keys.has('arrowdown') || keys.has('s')) y += sp;
      if (keys.has('arrowleft') || keys.has('a')) x -= sp;
      if (keys.has('arrowright') || keys.has('d')) x += sp;
      const p = clampPad(x, y);
      localPad.current = p;
      onInput(p.x, p.y);
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
  }, [field, mySlot, onInput]);

  // Draw loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    let raf;
    let lastTs = performance.now();

    const paintIce = (c, W, H, gh, homeColor, awayColor) => {
      const grad = c.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#0d1730');
      grad.addColorStop(0.5, '#122142');
      grad.addColorStop(1, '#0d1730');
      c.fillStyle = grad;
      c.fillRect(0, 0, W, H);

      c.strokeStyle = 'rgba(140,180,255,0.22)';
      c.lineWidth = 3;
      c.setLineDash([14, 12]);
      c.beginPath();
      c.moveTo(W / 2, 0);
      c.lineTo(W / 2, H);
      c.stroke();
      c.setLineDash([]);

      c.beginPath();
      c.arc(W / 2, H / 2, 95, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(W / 2, H / 2, 8, 0, Math.PI * 2);
      c.fillStyle = 'rgba(140,180,255,0.35)';
      c.fill();

      [0, W].forEach((gx, i) => {
        c.beginPath();
        c.arc(gx, H / 2, 130, i === 0 ? -Math.PI / 2 : Math.PI / 2, i === 0 ? Math.PI / 2 : -Math.PI / 2);
        c.strokeStyle = 'rgba(140,180,255,0.18)';
        c.stroke();
      });

      c.lineWidth = 8;
      c.strokeStyle = homeColor;
      c.beginPath();
      c.moveTo(3, H / 2 - gh / 2);
      c.lineTo(3, H / 2 + gh / 2);
      c.stroke();

      c.strokeStyle = awayColor;
      c.beginPath();
      c.moveTo(W - 3, H / 2 - gh / 2);
      c.lineTo(W - 3, H / 2 + gh / 2);
      c.stroke();

      c.lineWidth = 5;
      c.strokeStyle = 'rgba(150,190,255,0.28)';
      c.strokeRect(2.5, 2.5, W - 5, H - 5);
    };

    const rebuildIce = () => {
      const W = field.width;
      const H = field.height;
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const c = off.getContext('2d');
      paintIce(
        c,
        W,
        H,
        field.goalHeight,
        players?.home?.color || '#22d3ee',
        players?.away?.color || '#ff3b6b'
      );
      iceCache.current = off;
    };

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
      rebuildIce();
    };

    resize();
    window.addEventListener('resize', resize);

    const lerp = (a, b, t) => a + (b - a) * t;

    // Seed from any snapshot already received.
    const seed = getGameSnapshot();
    if (seed) lastSnap.current = seed;

    const draw = (ts) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      const s = lastSnap.current;
      const r = render.current;
      const oppSlot = mySlot === 'home' ? 'away' : 'home';

      if (s) {
        // Extrapolate puck a little using velocity, then ease toward it.
        const lead = 0.04;
        const tx = s.puck.x + (s.puck.vx || 0) * lead;
        const ty = s.puck.y + (s.puck.vy || 0) * lead;
        const puckT = 1 - Math.exp(-14 * dt);
        r.puck.x = lerp(r.puck.x, tx, puckT);
        r.puck.y = lerp(r.puck.y, ty, puckT);

        const opp = s.paddles[oppSlot];
        const padT = 1 - Math.exp(-18 * dt);
        if (oppSlot === 'home') {
          r.home.x = lerp(r.home.x, opp.x + (opp.vx || 0) * lead, padT);
          r.home.y = lerp(r.home.y, opp.y + (opp.vy || 0) * lead, padT);
        } else {
          r.away.x = lerp(r.away.x, opp.x + (opp.vx || 0) * lead, padT);
          r.away.y = lerp(r.away.y, opp.y + (opp.vy || 0) * lead, padT);
        }
      }

      // Own paddle is always the local predicted position.
      if (mySlot === 'home') {
        r.home.x = localPad.current.x;
        r.home.y = localPad.current.y;
      } else {
        r.away.x = localPad.current.x;
        r.away.y = localPad.current.y;
      }

      const W = field.width;
      const H = field.height;
      const homeColor = players?.home?.color || '#22d3ee';
      const awayColor = players?.away?.color || '#ff3b6b';

      if (iceCache.current) ctx.drawImage(iceCache.current, 0, 0);
      else {
        paintIce(ctx, W, H, field.goalHeight, homeColor, awayColor);
      }

      const drawPaddle = (p, color, isMe) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, field.paddleRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, field.paddleRadius * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, field.paddleRadius, 0, Math.PI * 2);
        ctx.lineWidth = isMe ? 4 : 2;
        ctx.strokeStyle = isMe ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)';
        ctx.stroke();
      };

      drawPaddle(r.home, homeColor, mySlot === 'home');
      drawPaddle(r.away, awayColor, mySlot === 'away');

      ctx.beginPath();
      ctx.arc(r.puck.x, r.puck.y, field.puckRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fbff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r.puck.x, r.puck.y, field.puckRadius * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,160,220,0.5)';
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
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
