import React, { useEffect, useState } from 'react';
import './PipelineLoader.css';

const STEP_DEFS = [
  { id: 'imagery', label: 'Capture', sub: 'Satellite + street view' },
  { id: 'vision', label: 'AI Inspection', sub: 'Measurements + analysis' },
  { id: 'jobnimbus', label: 'JobNimbus', sub: 'Lead created' },
];

const STEP_MESSAGES = {
  imagery: [
    'Pinging Google’s satellites…',
    'Tracing every roof facet from above…',
    'Reading pitch off each plane…',
    'Snapping the property from the curb…',
    'Stitching the rooftop outline…',
    'Catching the imagery before clouds roll in…',
    'Measuring eaves, rakes, and ridgelines…',
    'Sizing up the lot…',
  ],
  vision: [
    'Waking up the AI inspector…',
    'Squinting at shingles for storm damage…',
    'Counting chimneys and skylights…',
    'Eyeballing the gutter run…',
    'Hunting for missing shingles…',
    'Rating the roof condition…',
    'Logging every penetration and obstacle…',
    'Cross-checking material from the curb…',
    'Estimating roof age from wear patterns…',
    'Running the line-item math…',
  ],
  jobnimbus: [
    'Filing paperwork…',
    'Creating a homeowner contact…',
    'Spinning up a new job record…',
    'Attaching measurements to the job description…',
    'Stamping the inspection notes…',
    'Hand-delivering it to your CRM…',
  ],
  idle: ['Warming up…'],
};

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
    setMessageIndex(0);
  }, [activeStep]);

  useEffect(() => {
    if (!activeStep) return;
    const id = setInterval(() => {
      setMessageIndex((i) => (i + 1) % messages.length);
    }, 1400);
    return () => clearInterval(id);
  }, [activeStep, messages.length]);

  const visionActive = activeStep === 'vision';
  const jnActive = activeStep === 'jobnimbus';

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
        {imagery ? (
          <div className="pl-preview">
            <PreviewTile
              src={imagery.streetView}
              label="STREET VIEW"
              scanning={visionActive}
              dimmed={jnActive}
            />
            <PreviewTile
              src={imagery.satellite}
              label="SATELLITE"
              scanning={visionActive}
              dimmed={jnActive}
              showGrid={visionActive}
            />
          </div>
        ) : (
          <div className="pl-skeleton">
            <SkeletonTile label="STREET VIEW" />
            <SkeletonTile label="SATELLITE" />
          </div>
        )}

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
      </div>

      {error && <div className="pl-error">{error}</div>}
    </div>
  );
}

function PreviewTile({ src, label, scanning, dimmed, showGrid }) {
  return (
    <div className={`pl-tile ${dimmed ? 'pl-tile--dimmed' : ''}`}>
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
  if (id === 'jobnimbus') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 9h8" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
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
