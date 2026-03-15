import { useEffect, useRef } from "react";
import type { ThemeMode } from "../types/telemetry";

interface NodePoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  pulseOffset: number;
  tone: number;
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

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionFactor = prefersReducedMotion ? 0.45 : 1;

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
        ? [
            { line: "102, 118, 150", node: "167, 182, 204", glow: "93, 109, 139" },
            { line: "100, 139, 153", node: "163, 194, 201", glow: "90, 129, 148" },
            { line: "151, 121, 112", node: "197, 173, 163", glow: "136, 110, 101" },
          ]
        : [
            { line: "122, 141, 171", node: "96, 118, 156", glow: "112, 130, 160" },
            { line: "118, 153, 166", node: "90, 129, 148", glow: "118, 153, 166" },
          ];

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
      const baseCount = Math.round((width * height) / 62000);
      const count = Math.max(18, Math.min(52, Math.round(baseCount * (prefersReducedMotion ? 0.75 : 1))));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.24 * motionFactor,
        vy: (Math.random() - 0.5) * 0.24 * motionFactor,
        size: Math.random() * 1.4 + 0.7,
        pulseOffset: Math.random() * Math.PI * 2,
        tone: Math.floor(Math.random() * palette.length),
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
      time += 0.0075 * delta * motionFactor;

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
            const maxDistance = 210;

            if (distance > maxDistance) {
              continue;
            }

            const alpha = Math.pow(1 - distance / maxDistance, 1.45) * (theme === "dark" ? 0.16 : 0.1);
            const gradient = context.createLinearGradient(node.x, node.y, other.x, other.y);
            gradient.addColorStop(0, `rgba(${palette[node.tone].line}, ${alpha})`);
            gradient.addColorStop(1, `rgba(${palette[other.tone].line}, ${alpha * 0.72})`);

            context.beginPath();
            context.moveTo(node.x, node.y);
            context.lineTo(other.x, other.y);
            context.strokeStyle = gradient;
            context.lineWidth = theme === "dark" ? 0.9 : 0.8;
            context.stroke();
          }
        }

        for (const node of nodes) {
          const radius = node.size + Math.sin(time + node.pulseOffset) * 0.15;
          const tone = palette[node.tone];

          context.beginPath();
          context.arc(node.x, node.y, Math.max(2.2, radius * 4), 0, Math.PI * 2);
          context.fillStyle = `rgba(${tone.glow}, ${theme === "dark" ? 0.04 : 0.025})`;
          context.fill();

          context.beginPath();
          context.arc(node.x, node.y, Math.max(0.55, radius), 0, Math.PI * 2);
          context.shadowBlur = theme === "dark" ? 12 : 8;
          context.shadowColor = `rgba(${tone.glow}, ${theme === "dark" ? 0.22 : 0.14})`;
          context.fillStyle = `rgba(${tone.node}, ${theme === "dark" ? 0.58 : 0.42})`;
          context.fill();
          context.shadowBlur = 0;
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
