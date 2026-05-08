import React, { useEffect, useRef, useState } from 'react';
import './Timer.css';

export default function Timer({ state }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (state === 'running') {
      startRef.current = performance.now();
      setElapsed(0);

      const tick = () => {
        setElapsed(performance.now() - startRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    if (state === 'done' || state === 'error') {
      cancelAnimationFrame(rafRef.current);
      if (startRef.current) {
        setElapsed(performance.now() - startRef.current);
      }
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [state]);

  if (state === 'idle') return null;

  const seconds = (elapsed / 1000).toFixed(1);

  return (
    <div className={`timer ${state}`}>
      <span className="timer-value">{seconds}s</span>
      <span className="timer-label">
        {state === 'running' ? 'ELAPSED' : state === 'done' ? 'TOTAL' : 'FAILED'}
      </span>
    </div>
  );
}
