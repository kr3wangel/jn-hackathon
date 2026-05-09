import React, { useEffect, useState } from 'react';
import './PipelineLoader.css';
import { STEP_MESSAGES } from './pipelineMessages.js';

const STEP_DEFS = [
  { id: 'imagery', label: 'Capture', sub: 'Satellite + street view' },
  { id: 'vision', label: 'AI Inspection', sub: 'Analyzing property' },
  { id: 'measurements', label: 'Measurements', sub: 'Line items + geometry' },
  { id: 'pricing', label: 'Estimate', sub: 'Tiered pricing' },
];


export default function PipelineLoader({
  steps,
  stepState,
  pipelineState,
  imagery,
  error,
}) {
  const activeStep = steps.find((s) => stepState[s] === 'loading');
  const messages = STEP_MESSAGES[activeStep] || STEP_MESSAGES.idle;

  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    setMessageIndex(Math.floor(Math.random() * (STEP_MESSAGES[activeStep]?.length || 1)));
  }, [activeStep]);

  useEffect(() => {
    if (!activeStep) return;
    const id = setInterval(() => {
      setMessageIndex((i) => (i + 1) % messages.length);
    }, 1400);
    return () => clearInterval(id);
  }, [activeStep, messages.length]);

  const visionActive = activeStep === 'vision';

  return (
    <div className="pipeline-loader">
      <div className="pl-steps">
        {STEP_DEFS.map((def, idx) => {
          const state = stepState[def.id] || 'pending';
          return (
            <React.Fragment key={def.id}>
              <div className={`pl-step pl-step--${state}`}>
                <div className="pl-step-icon">
                  {state === 'done' ? (
                    <CheckIcon />
                  ) : state === 'loading' ? (
                    <StepIcon id={def.id} />
                  ) : (
                    <StepIcon id={def.id} muted />
                  )}
                  {state === 'loading' && <span className="pl-step-pulse" />}
                </div>
                <div className="pl-step-text">
                  <div className="pl-step-label">{def.label}</div>
                  <div className="pl-step-sub">{def.sub}</div>
                </div>
              </div>
              {idx < STEP_DEFS.length - 1 && (
                <div
                  className={`pl-connector ${
                    stepState[def.id] === 'done' ? 'pl-connector--done' : ''
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="pl-stage">
        {pipelineState === 'running' && activeStep && (
          <div className="pl-status">
            <span className="pl-status-dot" />
            <span
              key={`${activeStep}-${messageIndex}`}
              className="pl-status-text"
            >
              {messages[messageIndex]}
            </span>
          </div>
        )}

        {imagery ? (
          <div className="pl-preview">
            <PreviewTile
              src={imagery.streetView}
              label="STREET VIEW"
              scanning={visionActive}
            />
            <PreviewTile
              src={imagery.satellite}
              label="SATELLITE"
              scanning={visionActive}
              showGrid={visionActive}
            />
          </div>
        ) : (
          <div className="pl-skeleton">
            <SkeletonTile label="STREET VIEW" />
            <SkeletonTile label="SATELLITE" />
          </div>
        )}
      </div>

      {error && <div className="pl-error">{error}</div>}
    </div>
  );
}

function PreviewTile({ src, label, scanning, showGrid }) {
  return (
    <div className="pl-tile">
      <span className="pl-tile-label">{label}</span>
      <div className="pl-tile-canvas">
        <img src={src} alt={label} />
        {showGrid && <div className="pl-grid" />}
        {scanning && <div className="pl-scan" />}
      </div>
    </div>
  );
}

function SkeletonTile({ label }) {
  return (
    <div className="pl-tile">
      <span className="pl-tile-label">{label}</span>
      <div className="pl-tile-canvas pl-tile-canvas--skeleton">
        <div className="pl-shimmer" />
      </div>
    </div>
  );
}

function StepIcon({ id, muted }) {
  const color = muted ? 'currentColor' : 'currentColor';
  if (id === 'imagery') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18" />
        <path d="M12 3a14 14 0 0 0 0 18" />
      </svg>
    );
  }
  if (id === 'vision') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (id === 'measurements') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z" />
        <path d="M14.5 12.5l2-2" />
        <path d="M11.5 9.5l2-2" />
        <path d="M8.5 6.5l2-2" />
        <path d="M17.5 15.5l2-2" />
      </svg>
    );
  }
  if (id === 'pricing') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    );
  }
  return null;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
