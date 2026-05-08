import React from 'react';
import './StatusTracker.css';

const STEP_LABELS = {
  imagery: 'Fetching Imagery',
  vision: 'AI Analysis',
  pricing: 'Generating Estimate',
  jobnimbus: 'Pushing to JobNimbus',
};

export default function StatusTracker({ steps, stepState, pipelineState, error }) {
  return (
    <div className="status-tracker">
      {steps.map((step) => {
        const state = stepState[step] || 'pending';
        return (
          <div key={step} className={`status-step ${state}`}>
            <div className="step-indicator">
              {state === 'done' && <CheckIcon />}
              {state === 'loading' && <div className="step-spinner" />}
              {state === 'pending' && <div className="step-dot" />}
            </div>
            <span className="step-label">{STEP_LABELS[step]}</span>
          </div>
        );
      })}
      {error && <div className="status-error">{error}</div>}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
