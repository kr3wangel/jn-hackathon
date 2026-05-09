import React from 'react';
import './PageHeader.css';

export default function PageHeader({ children, onBack }) {
  return (
    <div className="page-header">
      <div className="page-header-inner">
        <button
          type="button"
          className="page-header-back"
          onClick={onBack}
          aria-label="Back"
          tabIndex={onBack ? 0 : -1}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="page-header-title">Roofing Estimator</h1>
        <span className="page-header-badge">Beta</span>
        {children && <div className="page-header-actions">{children}</div>}
      </div>
    </div>
  );
}
