import { useEffect, useRef } from "react";
import type { ThemeMode } from "../types/telemetry";

interface NodePoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  pulseOffset: number;
}

interface NetworkBackdropProps {
  theme: ThemeMode;
}

export function NetworkBackdrop({ theme }: NetworkBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let animationFrame = 0;
    let lastFrame = performance.now();
    let time = 0;
    let hidden = document.hidden;
    let nodes: NodePoint[] = [];

    const palette =
      theme === "dark"
        ? {
            line: "139, 92, 246",
            node: "196, 181, 253",
          }
        : {
            line: "139, 92, 246",
            node: "109, 40, 217",
          };

    const resizeCanvas = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      createNodes();
    };

    const createNodes = () => {
      const count = Math.max(10, Math.min(28, Math.round((width * height) / 78000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.14,
        vy: (Math.random() - 0.5) * 0.14,
        size: Math.random() * 1.2 + 0.6,
        pulseOffset: Math.random() * Math.PI * 2,
      }));
    };

    const handleVisibility = () => {
      hidden = document.hidden;
      if (!hidden) {
        lastFrame = performance.now();
      }
    };

    const animate = (now: number) => {
      const delta = Math.min(32, now - lastFrame) / 16.667;
      lastFrame = now;
      time += 0.006 * delta;

      context.clearRect(0, 0, width, height);

      if (!hidden) {
        for (const node of nodes) {
          node.x += node.vx * delta;
          node.y += node.vy * delta;

          if (node.x < -24 || node.x > width + 24) {
            node.vx *= -1;
          }

          if (node.y < -24 || node.y > height + 24) {
            node.vy *= -1;
          }

          node.x = Math.max(-10, Math.min(width + 10, node.x));
          node.y = Math.max(-10, Math.min(height + 10, node.y));
        }

        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index];

          for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
            const other = nodes[otherIndex];
            const distance = Math.hypot(other.x - node.x, other.y - node.y);
            const maxDistance = 180;

            if (distance > maxDistance) {
              continue;
            }

            const alpha = Math.pow(1 - distance / maxDistance, 1.45) * (theme === "dark" ? 0.12 : 0.09);

            context.beginPath();
            context.moveTo(node.x, node.y);
            context.lineTo(other.x, other.y);
            context.strokeStyle = `rgba(${palette.line}, ${alpha})`;
            context.lineWidth = 0.8;
            context.stroke();
          }
        }

        for (const node of nodes) {
          const radius = node.size + Math.sin(time + node.pulseOffset) * 0.15;

          context.beginPath();
          context.arc(node.x, node.y, Math.max(0.5, radius), 0, Math.PI * 2);
          context.fillStyle = `rgba(${palette.node}, ${theme === "dark" ? 0.5 : 0.3})`;
          context.fill();
        }
      }

      animationFrame = window.requestAnimationFrame(animate);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    document.addEventListener("visibilitychange", handleVisibility);
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resizeCanvas);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [theme]);

  return (
    <div className="network-backdrop" aria-hidden="true">
      <canvas ref={canvasRef} className="network-backdrop-canvas" />
    </div>
  );
}
