import React from 'react';
import './RoofStats.css';

const MATERIAL_LABELS = {
  '3-tab shingle': '3-Tab Shingle',
  'architectural shingle': 'Architectural',
  'metal': 'Metal',
  'tile': 'Tile',
  'slate': 'Slate',
  'wood shake': 'Wood Shake',
  'flat/rolled': 'Flat / Rolled',
  'unknown': '—',
};

export default function RoofStats({ data, visionData }) {
  const material = visionData?.streetView?.material;
  const age = visionData?.streetView?.estimatedAge;

  return (
    <div className="roof-stats">
      <div className="stat-card primary">
        <span className="stat-label">TOTAL ROOF AREA</span>
        <span className="stat-value">{data.totalAreaSqft.toLocaleString()} <small>sqft</small></span>
        {data.roofingSquares ? (
          <span className="stat-sub">{data.roofingSquares} squares</span>
        ) : null}
      </div>
      <div className="stat-card">
        <span className="stat-label">AVG PITCH</span>
        <span className="stat-value">{data.avgPitchRatio}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">MATERIAL</span>
        <span className="stat-value">{MATERIAL_LABELS[material] || '—'}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">EST. AGE</span>
        <span className="stat-value">
          {age ? age.replace(' years', ' yrs') : '—'}
        </span>
      </div>
    </div>
  );
}
