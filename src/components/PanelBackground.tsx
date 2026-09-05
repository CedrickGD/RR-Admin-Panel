import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAppearance } from "../hooks/useAppearance";

export function PanelBackground() {
  const { appearance: a } = useAppearance();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (a.background !== "network" || !canvas.current) return;
    const el = canvas.current,
      ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0,
      previous = 0,
      width = 0,
      height = 0;
    let nodes: Array<{ x: number; y: number; vx: number; vy: number; phase: number }> = [];
    const mouse = { x: -1000, y: -1000 };
    const moving = a.motion && !reduced && a.speed > 0;
    const resize = () => {
      width = innerWidth;
      height = innerHeight;
      const dpr = Math.min(devicePixelRatio, 1.5);
      el.width = width * dpr;
      el.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(
        145,
        Math.max(15, Math.round((((width * height) / 20000) * a.density) / 50)),
      );
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        phase: Math.random() * 6,
      }));
      cancelAnimationFrame(frame);
      draw(0);
    };
    const draw = (now: number) => {
      const delta = previous ? Math.min((now - previous) / 16.67, 2) : 1;
      previous = now;
      ctx.clearRect(0, 0, width, height);
      const color = `hsl(${a.hue} 70% ${a.theme === "dark" ? 73 : 37}%)`;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 0.65;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (moving) {
          const dx = mouse.x - n.x,
            dy = mouse.y - n.y,
            distance = Math.hypot(dx, dy);
          if (distance > 1 && distance < 150) {
            n.vx += (dx / distance) * 0.003;
            n.vy += (dy / distance) * 0.003;
          }
          n.vx = Math.max(-0.6, Math.min(0.6, n.vx));
          n.vy = Math.max(-0.6, Math.min(0.6, n.vy));
          n.x += (n.vx * delta * a.speed) / 30;
          n.y += (n.vy * delta * a.speed) / 30;
          if (n.x < 0 || n.x > width) n.vx *= -1;
          if (n.y < 0 || n.y > height) n.vy *= -1;
        }
        const x = n.x + (a.offsetX * width) / 200,
          y = n.y + (a.offsetY * height) / 200;
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.arc(x, y, 1.1 + Math.sin(now / 1000 + n.phase) * 0.25, 0, Math.PI * 2);
        ctx.fill();
        for (let j = i + 1; j < nodes.length; j++) {
          const other = nodes[j],
            d = Math.hypot(n.x - other.x, n.y - other.y);
          if (d > a.distance) continue;
          ctx.globalAlpha = (1 - d / a.distance) * 0.5;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(other.x + (a.offsetX * width) / 200, other.y + (a.offsetY * height) / 200);
          ctx.stroke();
        }
      }
      if (moving && document.visibilityState === "visible") frame = requestAnimationFrame(draw);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (moving && document.visibilityState === "visible") frame = requestAnimationFrame(draw);
    };
    const pointer = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointermove", pointer, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointermove", pointer);
    };
  }, [a, reduced]);
  const style = {
    "--ambient-speed": `${Math.max(5, 100 - a.speed)}s`,
    "--ambient-opacity": a.intensity / 100,
    "--image-dim": a.dim / 100,
    "--image-blur": `${a.blur}px`,
    "--image-position": `${50 + a.offsetX / 2}% ${50 + a.offsetY / 2}%`,
  } as CSSProperties;
  return (
    <div
      className={`panel-background background-${a.background}${!a.motion || reduced ? " is-paused" : ""}`}
      style={style}
      aria-hidden="true"
    >
      {a.background === "aurora" && <div className="ambient-colors" />}
      {a.background === "network" && <canvas ref={canvas} />}
      {a.background === "image" && a.image && (
        <>
          <img src={a.image} alt="" />
          <div className="image-shade" />
        </>
      )}
    </div>
  );
}
