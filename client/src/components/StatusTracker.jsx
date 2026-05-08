import React, { useEffect, useState } from 'react';
import './StatusTracker.css';

const STEP_LABELS = {
  imagery: 'Fetching Imagery',
  vision: 'AI Analysis',
  jobnimbus: 'Pushing to JobNimbus',
};

const STEP_MESSAGES = {
  imagery: [
    'Pinging Google’s satellites…',
    'Measuring rooftop facets…',
    'Counting valleys and ridges…',
    'Sizing up the property…',
    'Reading the pitch off every plane…',
  ],
  vision: [
    'Waking up the AI inspector…',
    'Looking for chimneys…',
    'Scanning for storm damage…',
    'Rating the shingles…',
    'Checking the gutters…',
    'Counting flashings…',
    'Sizing up obstacles…',
  ],
  jobnimbus: [
    'Filing paperwork…',
    'Creating the contact…',
    'Attaching the inspection notes…',
    'Waking up your CRM…',
  ],
  idle: [
    'Warming up…',
  ],
};

export default function StatusTracker({ steps, stepState, pipelineState, error }) {
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

  return (
    <div className="status-tracker">
      <div className="status-steps">
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
      </div>

      {pipelineState === 'running' && activeStep && (
        <div className="status-message">
          <span key={`${activeStep}-${messageIndex}`} className="status-message-text">
            {messages[messageIndex]}
          </span>
        </div>
      )}

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
