import React, { useRef, useState } from 'react';
import AddressInput from './components/AddressInput';
import Timer from './components/Timer';
import PortalNav from './components/PortalNav';
import PageHeader from './components/PageHeader';
import PipelineLoader from './components/PipelineLoader';
import RoofStats from './components/RoofStats';
import VisionAnalysis from './components/VisionAnalysis';
import RoofOverlay from './components/RoofOverlay';
import LineItems from './components/LineItems';
import PricingEstimate from './components/PricingEstimate';
import './styles/app.css';

const STEPS = ['imagery', 'vision', 'measurements', 'pricing'];

export default function App() {
  const [pipelineState, setPipelineState] = useState('idle');
  const [steps, setSteps] = useState({});
  const [imagery, setImagery] = useState(null);
  const [roofData, setRoofData] = useState(null);
  const [roofOutline, setRoofOutline] = useState(null);
  const [lineItems, setLineItems] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [visionData, setVisionData] = useState(null);
  const [jnResult, setJnResult] = useState(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const stateRef = useRef('idle');

  function handleSubmit(place) {
    // Cancel any in-flight pipeline so a new submission doesn't tangle with it.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAddress(place.formatted_address);
    setPipelineState('running');
    stateRef.current = 'running';
    setSteps({});
    setImagery(null);
    setRoofData(null);
    setRoofOutline(null);
    setLineItems(null);
    setPricing(null);
    setVisionData(null);
    setJnResult(null);
    setError(null);

    const body = JSON.stringify({
      address: place.formatted_address,
      lat: place.lat,
      lng: place.lng,
      zip: place.zip,
    });

    fetch('/api/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    }).then(async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedDone = false;
      // Persisted across chunks: SSE events can be split mid-record when the
      // payload is large, so the event name from one chunk's `event:` line
      // must survive until the matching `data:` line arrives in a later chunk.
      let pendingEvent = null;

      const processLines = (lines) => {
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            pendingEvent = line.slice(7);
          } else if (line.startsWith('data: ') && pendingEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (pendingEvent === 'done') receivedDone = true;
              handleEvent(pendingEvent, data);
            } catch (e) {
              // Ignore malformed event; keep streaming.
            }
            pendingEvent = null;
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        processLines(lines);
      }

      // Flush any trailing event sitting in the buffer.
      buffer += decoder.decode();
      if (buffer.length > 0) {
        processLines(buffer.split('\n'));
      }

      // Safety net: if the stream closed without an explicit `done` event,
      // transition to done so the UI doesn't hang in `running` forever.
      if (!receivedDone && stateRef.current === 'running') {
        setPipelineState('done');
        stateRef.current = 'done';
      }
    }).catch((err) => {
      if (err.name === 'AbortError') return; // expected when superseded
      setError(err.message);
      setPipelineState('error');
      stateRef.current = 'error';
    });
  }

  function handleReset() {
    if (abortRef.current) abortRef.current.abort();
    setAddress('');
    setPipelineState('idle');
    stateRef.current = 'idle';
    setSteps({});
    setImagery(null);
    setRoofData(null);
    setRoofOutline(null);
    setLineItems(null);
    setPricing(null);
    setVisionData(null);
    setJnResult(null);
    setError(null);
  }

  async function imgToBase64(url) {
    try {
      const r = await fetch(url);
      const blob = await r.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function compositeSatelliteWithOverlay(url, polygon, sqft) {
    try {
      const img = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      if (Array.isArray(polygon) && polygon.length >= 3) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.beginPath();
        polygon.forEach((p, i) => {
          const x = p.x * w;
          const y = p.y * h;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 77, 46, 0.18)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 77, 46, 0.85)';
        ctx.lineWidth = Math.max(3, Math.round(w / 180));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        if (sqft) {
          const cx = polygon.reduce((a, p) => a + p.x, 0) / polygon.length * w;
          const cy = polygon.reduce((a, p) => a + p.y, 0) / polygon.length * h;
          const label = `${sqft.toLocaleString()} sqft`;
          const fontPx = Math.max(18, Math.round(w / 28));
          ctx.font = `700 ${fontPx}px -apple-system, "Segoe UI", Roboto, sans-serif`;
          const metrics = ctx.measureText(label);
          const padX = fontPx * 0.7;
          const padY = fontPx * 0.45;
          const boxW = metrics.width + padX * 2;
          const boxH = fontPx + padY * 2;
          const boxX = cx - boxW / 2;
          const boxY = cy - boxH / 2;
          ctx.fillStyle = 'rgba(31, 62, 122, 0.92)';
          const r = boxH / 2;
          ctx.beginPath();
          ctx.moveTo(boxX + r, boxY);
          ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
          ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
          ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r);
          ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, cx, cy);
        }
      }

      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  async function handleDownloadPdf() {
    try {
      const [satB64, svB64] = await Promise.all([
        imagery?.satellite
          ? compositeSatelliteWithOverlay(imagery.satellite, roofOutline?.polygon, roofData?.totalAreaSqft)
          : null,
        imagery?.streetView ? imgToBase64(imagery.streetView) : null,
      ]);
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address, roofData, visionData, lineItems, pricing,
          imageryBase64: { satellite: satB64, streetView: svB64 },
        }),
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.split('filename="')[1]?.replace('"', '') || 'roof-report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download failed:', err);
    }
  }

  function handleEvent(event, data) {
    if (event === 'step') {
      setSteps((prev) => ({ ...prev, [data.step]: data.status }));
      if (data.step === 'imagery' && data.data) {
        setImagery({ satellite: data.data.satellite, streetView: data.data.streetView });
        if (data.data.roofData) setRoofData(data.data.roofData);
        if (data.data.roofOutline) setRoofOutline(data.data.roofOutline);
      }
      if (data.step === 'vision' && data.data) {
        setVisionData(data.data);
      }
      if (data.step === 'jobnimbus' && data.data) {
        setJnResult(data.data);
      }
    } else if (event === 'done') {
      setPipelineState('done');
      stateRef.current = 'done';
      if (data.roofData) setRoofData(data.roofData);
      if (data.roofOutline) setRoofOutline(data.roofOutline);
      if (data.lineItems) setLineItems(data.lineItems);
      if (data.pricing) setPricing(data.pricing);
      if (data.visionData) setVisionData(data.visionData);
      if (data.jobnimbus) setJnResult(data.jobnimbus);
    } else if (event === 'error') {
      setError(data.message);
      setPipelineState('error');
      stateRef.current = 'error';
    }
  }

  return (
    <div className="app">
      <PortalNav />
      <PageHeader onBack={pipelineState !== 'idle' ? handleReset : undefined}>
        <Timer state={pipelineState} />
      </PageHeader>

      <main className="main">
        <div className="page-content">
        <div className={`address-input-area ${pipelineState !== 'idle' ? 'compact' : ''}`}>
          <AddressInput
            onSubmit={handleSubmit}
            onReset={handleReset}
            disabled={pipelineState === 'running'}
          />
        </div>

        {(pipelineState === 'running' || pipelineState === 'error') && (
          <PipelineLoader
            steps={STEPS}
            stepState={steps}
            pipelineState={pipelineState}
            imagery={imagery}
            error={error}
          />
        )}

        {(pipelineState === 'done' || pipelineState === 'error') && (
          <div className="results">
            {imagery && (
              <div className="imagery-row">
                <div className="streetview-card">
                  <span className="card-label">STREET VIEW</span>
                  <div className="streetview-canvas">
                    <img src={imagery.streetView} alt="Street view" />
                  </div>
                </div>
                <RoofOverlay
                  imageUrl={imagery.satellite}
                  polygon={roofOutline?.polygon}
                  sqft={roofData?.totalAreaSqft}
                  confidence={roofOutline?.confidence}
                  patioSqft={roofData?.patioSqft}
                  patioFallback={
                    (roofData?.patioSqft || 0) > 0 &&
                    roofOutline?.patioTrimApplied === false
                  }
                />
              </div>
            )}

            {roofData && <RoofStats data={roofData} visionData={visionData} />}

            {lineItems && <LineItems data={lineItems} />}

            {pricing && <PricingEstimate data={pricing} />}

            {visionData && <VisionAnalysis data={visionData} />}

            <button className="download-pdf-btn" onClick={handleDownloadPdf} type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
                <path d="M14 3v5h5" />
                <path d="M12 12v6" />
                <path d="M9 15l3 3 3-3" />
              </svg>
              Download Report PDF
            </button>

            {jnResult && !jnResult.skipped && (
              <div className="jn-success">
                <div className="jn-success-icon">✓</div>
                <div className="jn-success-text">
                  <strong>Pushed to JobNimbus</strong>
                  <span>Contact and job created — {jnResult.jobName}</span>
                </div>
              </div>
            )}

            {jnResult && jnResult.skipped && (
              <div className="jn-skipped">
                <div className="jn-skipped-icon">→</div>
                <div className="jn-skipped-text">
                  <strong>JobNimbus push skipped</strong>
                  <span>{jnResult.reason}</span>
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </main>

      <footer className="footer">
        <div className="footer-content">
          <div className="footer-tag">
            <span className="footer-eyebrow">Built by</span>
            <span className="footer-product">Angel Herrera</span>
          </div>
          <div className="footer-credits">
            <span>JN Hackathon</span>
            <span className="footer-dot" aria-hidden="true">·</span>
            <span>2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
