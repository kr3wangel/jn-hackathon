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
    <div className="line-items">
      <div className="line-items-header">
        <h3 className="section-title">Line Items</h3>
        <p className="line-items-sub">Linear feet for the contractor's quote</p>
      </div>
      <table className="line-items-table">
        <thead>
          <tr>
            <th className="col-label">Item</th>
            <th className="col-value">Linear feet</th>
            <th className="col-source">Source</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const value = data[row.key];
            const source = row.sourceKey ? data.sources?.[row.sourceKey] : 'measured';
            return (
              <tr key={row.key} className={value == null ? 'is-missing' : ''}>
                <th className="col-label" scope="row">{row.label}</th>
                <td className="col-value">
                  {value == null ? '—' : <><span className="value-num">{value.toLocaleString()}</span> <span className="value-unit">ft</span></>}
                </td>
                <td className="col-source">
                  <SourceTag source={value == null ? 'unmeasured' : source} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceTag({ source }) {
  if (source === 'measured') return <span className="source-tag measured">measured</span>;
  if (source === 'calibrated') return <span className="source-tag calibrated">calibrated</span>;
  if (source === 'estimated') return <span className="source-tag estimated">estimated</span>;
  return <span className="source-tag unmeasured">—</span>;
}
