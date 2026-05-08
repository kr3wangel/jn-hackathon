import React from 'react';
import './ProposalView.css';

export default function ProposalView({ estimate }) {
  if (!estimate?.tiers) return null;

  return (
    <div className="proposal-section">
      <h3 className="section-title">Three-Tier Estimate</h3>
      <div className="proposal-grid">
        {estimate.tiers.map((tier, i) => (
          <div key={tier.name} className={`proposal-card ${i === 1 ? 'recommended' : ''}`}>
            {i === 1 && <div className="recommended-badge">RECOMMENDED</div>}
            <div className="proposal-header">
              <span className="tier-label">{tier.label}</span>
              <h4 className="tier-name">{tier.name}</h4>
              <p className="tier-material">{tier.material}</p>
            </div>
            <div className="proposal-price">
              <span className="price-amount">${tier.total.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
            </div>
            <div className="proposal-items">
              {tier.items.map((item) => (
                <div key={item.name} className="line-item">
                  <span className="item-name">{item.name}</span>
                  <span className="item-total">${item.total.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                </div>
              ))}
              <div className="line-item subtotal">
                <span className="item-name">Subtotal</span>
                <span className="item-total">${tier.subtotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
              </div>
            </div>
            <div className="proposal-footer">
              <span className="warranty-label">{tier.warranty}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="pricing-source">Pricing based on {estimate.pricingSource} — {estimate.pricingRegion}</p>
    </div>
  );
}
