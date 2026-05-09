import React, { useEffect, useRef, useState } from 'react';
import './AddressInput.css';

export default function AddressInput({ onSubmit, onReset, disabled }) {
  const inputRef = useRef(null);
  const [value, setValue] = useState('');
  const [predictions, setPredictions] = useState([]);
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);
  const submittedRef = useRef('');

  useEffect(() => {
    if (!value.trim() || disabled || value.trim() === submittedRef.current) {
      setPredictions([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const myId = ++reqIdRef.current;
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(value)}`);
        const data = await res.json();
        if (myId !== reqIdRef.current) return;
        setPredictions(data.predictions || []);
        setHighlight(0);
        setOpen(true);
      } catch {
        setPredictions([]);
      }
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [value, disabled]);

  function submitText(text) {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    submittedRef.current = trimmed;
    setOpen(false);
    setPredictions([]);
    onSubmit({ formatted_address: trimmed });
  }

  function handleSubmit() {
    if (open && predictions[highlight]) {
      const desc = predictions[highlight].description;
      setValue(desc);
      submitText(desc);
    } else {
      submitText(value);
    }
  }

  function handleKeyDown(e) {
    if (open && predictions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, predictions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  function selectPrediction(p) {
    setValue(p.description);
    submitText(p.description);
  }

  function handleClear() {
    setValue('');
    setPredictions([]);
    setOpen(false);
    submittedRef.current = '';
    if (onReset) onReset();
    inputRef.current?.focus();
  }

  return (
    <div className="address-input-wrapper">
      <div className="address-input-container">
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="address-input"
          placeholder="Enter a property address..."
          value={value}
          onChange={(e) => { setValue(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => predictions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          autoFocus
          autoComplete="off"
        />
        {disabled && <div className="input-spinner" />}
        {!disabled && value.trim() && (
          <>
            <button
              className="clear-btn"
              onClick={handleClear}
              type="button"
              aria-label="Clear address and start over"
              title="Clear"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
            <button className="submit-btn" onClick={handleSubmit} type="button">
              Go
            </button>
          </>
        )}
        {open && !disabled && predictions.length > 0 && (
          <ul className="predictions-list">
            {predictions.map((p, i) => (
              <li
                key={p.placeId}
                className={`prediction-item ${i === highlight ? 'highlighted' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); selectPrediction(p); }}
                onMouseEnter={() => setHighlight(i)}
              >
                {p.description}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
