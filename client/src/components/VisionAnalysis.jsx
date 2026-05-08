import React from 'react';
import './VisionAnalysis.css';

export default function VisionAnalysis({ data }) {
  if (!data || data.skipped) return null;

  const sv = data.streetView || {};
  const sat = data.satellite || {};

  const conditionRows = [
    { label: 'Material', value: sv.material, tag: sv.materialConfidence },
    { label: 'Condition', value: sv.condition },
    { label: 'Est. Age', value: sv.estimatedAge },
    { label: 'Stories', value: sv.stories },
    { label: 'Roof Shape', value: sat.roofShape },
    { label: 'Tree Overhang', value: sat.treeOverhang },
  ];

  const featureRows = [
    ...Object.entries(sv.features || {}).map(([key, value]) => ({ label: formatKey(key), value })),
    ...Object.entries(sv.obstacles || {}).map(([key, value]) => ({ label: formatKey(key), value })),
  ];

  return (
    <div className="vision-section">
      <h3 className="section-title">AI Roof Analysis</h3>
      <div className="vision-grid">
        <div className="vision-card">
          <span className="card-label">MATERIAL & CONDITION</span>
          <KeyValueTable rows={conditionRows} />
          {sv.conditionNotes && (
            <p className="condition-notes">{sv.conditionNotes}</p>
          )}
        </div>

        <div className="vision-card">
          <span className="card-label">FEATURES & OBSTACLES</span>
          <KeyValueTable rows={featureRows} alignRight />
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

function KeyValueTable({ rows, alignRight }) {
  const visible = rows.filter((r) => r.value !== undefined && r.value !== null && r.value !== '');
  return (
    <table className={`kv-table ${alignRight ? 'align-right' : ''}`}>
      <tbody>
        {visible.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>
              {String(row.value)}
              {row.tag && row.tag !== 'high' && (
                <span className="confidence-tag">{row.tag}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}
