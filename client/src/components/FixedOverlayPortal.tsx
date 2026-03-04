import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSidebarSafe } from "@/hooks/useSidebar";

interface FixedOverlayPortalProps {
  children: ReactNode;
  active?: boolean;
}

export function FixedOverlayPortal({ children, active = true }: FixedOverlayPortalProps) {
  const [mounted, setMounted] = useState(false);
  const { isOpen: sidebarOpen } = useSidebarSafe();

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!active) return;

    const sync = () => {
      const vv = window.visualViewport;
      const h = vv ? vv.height : window.innerHeight;
      const o = vv ? vv.offsetTop : 0;
      document.documentElement.style.setProperty('--vvh', `${h}px`);
      document.documentElement.style.setProperty('--vvo', `${o}px`);
    };

    sync();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', sync);
      vv.addEventListener('scroll', sync);
    }
    window.addEventListener('resize', sync);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', sync);
        vv.removeEventListener('scroll', sync);
      }
      window.removeEventListener('resize', sync);
    };
  }, [active]);

  if (!mounted || !active) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 'var(--vvo, 0px)',
        width: '100vw',
        height: 'var(--vvh, 100vh)',
        pointerEvents: 'none',
        zIndex: sidebarOpen ? 1 : 9999,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  );
}
