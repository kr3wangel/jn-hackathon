import React from 'react';
import './LineItems.css';

const ROWS = [
  { key: 'perimeterFeet', label: 'Perimeter', sourceKey: null },
  { key: 'eaveFeet', label: 'Eaves', sourceKey: 'eaveRake' },
  { key: 'rakeFeet', label: 'Rakes', sourceKey: 'eaveRake' },
  { key: 'gutterFeet', label: 'Gutter', sourceKey: 'gutter' },
  { key: 'ridgeFeet', label: 'Ridges', sourceKey: 'ridges' },
  { key: 'hipFeet', label: 'Hips', sourceKey: 'hips' },
  { key: 'valleyFeet', label: 'Valleys', sourceKey: 'valleys' },
  { key: 'wallFlashingFeet', label: 'Wall flashing', sourceKey: 'wallFlashing' },
  { key: 'stepFlashingFeet', label: 'Step flashing', sourceKey: 'stepFlashing' },
];

export default function LineItems({ data }) {
  if (!data) return null;

  return (
    <div className="line-items-section">
      <h3 className="section-title">Line Items</h3>
      <div className="line-items-card">
        <span className="card-label">LINEAR FEET FOR THE CONTRACTOR'S QUOTE</span>
        <table className="kv-table line-items-table">
          <tbody>
            {ROWS.map((row) => {
              const value = data[row.key];
              const source = row.sourceKey ? data.sources?.[row.sourceKey] : 'measured';
              const resolvedSource = value == null ? 'unmeasured' : source;
              return (
                <tr key={row.key} className={value == null ? 'is-missing' : ''}>
                  <th scope="row">{row.label}</th>
                  <td className="line-items-value">
                    {value == null ? (
                      <span className="value-empty">—</span>
                    ) : (
                      <>
                        <span className="value-num">{value.toLocaleString()}</span>
                        <span className="value-unit">ft</span>
                      </>
                    )}
                  </td>
                  <td className="line-items-source">
                    <SourceTag source={resolvedSource} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceTag({ source }) {
  if (source === 'measured') return <span className="source-tag measured">measured</span>;
  if (source === 'calibrated') return <span className="source-tag calibrated">calibrated</span>;
  if (source === 'estimated') return <span className="source-tag estimated">estimated</span>;
  return <span className="source-tag unmeasured">—</span>;
}
