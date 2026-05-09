import React from 'react';
import './PricingEstimate.css';

const formatCurrency = (n) =>
  '$' + Math.round(n || 0).toLocaleString('en-US');

export default function PricingEstimate({ data }) {
  if (!data || !Array.isArray(data.tiers) || data.tiers.length === 0) return null;

  return (
    <section className="pricing">
      <div className="pricing-header">
        <h3>Estimate</h3>
        <span className="pricing-caption">Using your configured rates</span>
      </div>

      <div className="pricing-tiers">
        {data.tiers.map((tier) => (
          <article
            key={tier.id}
            className={`pricing-tier ${tier.recommended ? 'pricing-tier--recommended' : ''}`}
          >
            {tier.recommended && (
              <span className="pricing-tier-badge">Most Selected</span>
            )}
            <div className="pricing-tier-name">{tier.name}</div>
            <div className="pricing-tier-material">{tier.material}</div>

            <div className="pricing-tier-total">
              {formatCurrency(tier.total)}
            </div>

            <div className="pricing-tier-warranty">
              {tier.warrantyYears}-year warranty
            </div>

            <ul className="pricing-tier-highlights">
              {tier.highlights.map((h, i) => (
                <li key={i}>
                  <CheckIcon />
                  <span>{h}</span>
                </li>
              ))}
            </ul>

            <dl className="pricing-tier-breakdown">
              <div>
                <dt>{data.inputs.squares} squares</dt>
                <dd>{formatCurrency(tier.subtotalSquares)}</dd>
              </div>
              {tier.subtotalFlashing > 0 && (
                <div>
                  <dt>Flashing ({data.inputs.flashingFeet} ft)</dt>
                  <dd>{formatCurrency(tier.subtotalFlashing)}</dd>
                </div>
              )}
              <div>
                <dt>Permits + cleanup</dt>
                <dd>{formatCurrency(tier.subtotalFlat)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
