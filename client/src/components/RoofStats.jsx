import React from 'react';
import './RoofStats.css';

export default function RoofStats({ data }) {
  return (
    <div className="roof-stats">
      <div className="stat-card primary">
        <span className="stat-label">TOTAL ROOF AREA</span>
        <span className="stat-value">{data.totalAreaSqft.toLocaleString()} <small>sqft</small></span>
      </div>
      <div className="stat-card">
        <span className="stat-label">AVG PITCH</span>
        <span className="stat-value">{data.avgPitchRatio}</span>
      </div>
    </div>
  );
}
