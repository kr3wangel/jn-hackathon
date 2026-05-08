import React from 'react';
import './VisionAnalysis.css';

export default function VisionAnalysis({ data }) {
  if (!data || data.skipped) return null;

  const sv = data.streetView || {};
  const sat = data.satellite || {};

  return (
    <div className="vision-section">
      <h3 className="section-title">AI Roof Analysis</h3>
      <div className="vision-grid">
        <div className="vision-card">
          <span className="card-label">MATERIAL & CONDITION</span>
          <div className="vision-detail-grid">
            <Detail label="Material" value={sv.material} confidence={sv.materialConfidence} />
            <Detail label="Condition" value={sv.condition} />
            <Detail label="Est. Age" value={sv.estimatedAge} />
            <Detail label="Stories" value={sv.stories} />
            <Detail label="Roof Shape" value={sat.roofShape} />
            <Detail label="Tree Overhang" value={sat.treeOverhang} />
          </div>
          {sv.conditionNotes && (
            <p className="condition-notes">{sv.conditionNotes}</p>
          )}
        </div>

        <div className="vision-card">
          <span className="card-label">ROOF FEATURES</span>
          <div className="vision-detail-grid">
            {sv.features && Object.entries(sv.features).map(([key, val]) => (
              <Detail key={key} label={key} value={val} />
            ))}
          </div>
          {sv.obstacles && (
            <>
              <span className="card-label" style={{ marginTop: 12, display: 'block' }}>OBSTACLES</span>
              <div className="vision-detail-grid">
                {Object.entries(sv.obstacles).map(([key, val]) => (
                  <Detail key={key} label={formatKey(key)} value={val} />
                ))}
              </div>
            </>
          )}
        </div>

        {sv.damage && sv.damage.length > 0 && (
          <div className="vision-card damage-card">
            <span className="card-label">DAMAGE DETECTED</span>
            <div className="damage-list">
              {sv.damage.map((d, i) => (
                <div key={i} className={`damage-item severity-${d.severity}`}>
                  <span className="damage-type">{d.type}</span>
                  <span className="damage-severity">{d.severity}</span>
                  {d.description && <p className="damage-desc">{d.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value, confidence }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="vision-detail">
      <span className="detail-label">{label}</span>
      <span className="detail-value">
        {String(value)}
        {confidence && confidence !== 'high' && (
          <span className="confidence-tag">{confidence}</span>
        )}
      </span>
    </div>
  );
}

function formatKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}
