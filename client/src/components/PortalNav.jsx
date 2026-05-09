import React from 'react';
import './PortalNav.css';

/* ------- Icons ------- */
function svgProps() {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
}
function HomeIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}
function JobsIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  );
}
function InsightsIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M4 19h16" />
      <path d="M7 16V9" />
      <path d="M12 16V5" />
      <path d="M17 16v-5" />
    </svg>
  );
}
function EngageIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />
    </svg>
  );
}
function PaymentsIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 11h18" />
      <path d="M7 16h3" />
    </svg>
  );
}
function PdfIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'jobs', label: 'Jobs', icon: JobsIcon },
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { id: 'insights', label: 'Insights', icon: InsightsIcon },
  { id: 'engage', label: 'Engage', icon: EngageIcon },
  { id: 'payments', label: 'Payments', icon: PaymentsIcon },
  { id: 'roofing-estimator', label: 'Roofing Estimator', icon: PdfIcon, active: true },
];

export default function PortalNav() {
  return (
    <nav className="portal-nav">
      <div className="portal-nav-inner">
        <a className="portal-brand" href="/" aria-label="JobNimbus">
          <img src="/jn-logo.svg" alt="JobNimbus" />
        </a>

        <ul className="portal-nav-items">
          {NAV_ITEMS.map(({ id, label, icon: Icon, active }) => (
            <li key={id} className={`portal-nav-item ${active ? 'portal-nav-item--active' : ''}`}>
              <button type="button" className="portal-nav-button" tabIndex={active ? 0 : -1}>
                <Icon />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="portal-nav-actions">
          <button type="button" className="portal-create" tabIndex={-1}>
            <span>Create</span>
            <PlusIcon />
          </button>

          <div className="portal-search" aria-hidden="true">
            <SearchIcon />
            <span className="portal-search-placeholder">Search jobs, contacts…</span>
          </div>

          <div className="portal-avatar" aria-hidden="true">AH</div>
        </div>
      </div>
    </nav>
  );
}
