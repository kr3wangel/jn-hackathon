import React from 'react';
import './RoofOverlay.css';

export default function RoofOverlay({ imageUrl, polygon, sqft, confidence, patioSqft, patioFallback }) {
  const hasPolygon = Array.isArray(polygon) && polygon.length >= 3;
  const points = hasPolygon ? polygon.map((p) => `${p.x},${p.y}`).join(' ') : '';
  const centroid = hasPolygon ? computeCentroid(polygon) : null;

  return (
    <div className="roof-overlay">
      <span className="card-label">SATELLITE VIEW · AI-DETECTED ROOF OUTLINE</span>
      <div className="roof-overlay-canvas">
        <img src={imageUrl} alt="Satellite view of roof" />
        {hasPolygon && (
          <svg
            className="roof-overlay-svg"
            viewBox="0 0 1 1"
            preserveAspectRatio="xMidYMid slice"
          >
            <polygon className="roof-polygon" points={points} />
          </svg>
        )}
        {hasPolygon && centroid && sqft && (
          <div
            className="roof-label"
            style={{ left: `${centroid.x * 100}%`, top: `${centroid.y * 100}%` }}
          >
            <span className="roof-label-value">{sqft.toLocaleString()}</span>
            <span className="roof-label-unit">sqft</span>
          </div>
        )}
      </div>
      {!hasPolygon && (
        <p className="roof-overlay-fallback">
          Could not auto-detect roof outline — measurements below come from Google Solar API.
        </p>
      )}
      {hasPolygon && confidence && confidence !== 'high' && (
        <p className="roof-overlay-disclaimer">
          AI outline · {confidence} confidence · verify on-site
        </p>
      )}
      {patioFallback && patioSqft > 0 && (
        <div className="roof-overlay-patio-note">
          <span className="patio-note-icon">⚐</span>
          <span>
            Outline includes attached patio cover / carport, but the
            <strong> {patioSqft.toLocaleString()} sqft</strong> low-pitch portion
            is excluded from the main-roof measurement.
          </span>
        </div>
      )}
    </div>
  );
}

function computeCentroid(points) {
  const x = points.reduce((a, p) => a + p.x, 0) / points.length;
  const y = points.reduce((a, p) => a + p.y, 0) / points.length;
  return { x, y };
}
