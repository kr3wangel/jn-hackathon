import React from 'react';
import './LineItems.css';

const PERIMETER_ROWS = [
  { key: 'perimeterFeet', label: 'Perimeter' },
  { key: 'eaveFeet', label: 'Eaves' },
  { key: 'rakeFeet', label: 'Rakes' },
  { key: 'gutterFeet', label: 'Gutter' },
];

const INTERIOR_ROWS = [
  { key: 'ridgeFeet', label: 'Ridges' },
  { key: 'hipFeet', label: 'Hips' },
  { key: 'valleyFeet', label: 'Valleys' },
  { key: 'wallFlashingFeet', label: 'Wall flashing' },
  { key: 'stepFlashingFeet', label: 'Step flashing' },
];

export default function LineItems({ data }) {
  if (!data) return null;

  return (
    <div className="line-items-section">
      <h3 className="section-title">Line Items</h3>
      <div className="line-items-grid">
        <div className="line-items-card">
          <span className="card-label">PERIMETER &amp; EDGES</span>
          <FeetTable rows={PERIMETER_ROWS} data={data} />
        </div>
        <div className="line-items-card">
          <span className="card-label">INTERIOR LINES &amp; FLASHING</span>
          <FeetTable rows={INTERIOR_ROWS} data={data} />
        </div>
      </div>
    </div>
  );
}

function FeetTable({ rows, data }) {
  return (
    <table className="kv-table align-right">
      <tbody>
        {rows.map((row) => {
          const value = data[row.key];
          return (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>
                {value == null ? (
                  <span className="value-empty">—</span>
                ) : (
                  <>
                    {value.toLocaleString()}
                    <span className="value-unit">ft</span>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
