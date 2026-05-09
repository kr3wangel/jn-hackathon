import React, { useRef, useState } from 'react';
import AddressInput from './components/AddressInput';
import Timer from './components/Timer';
import StatusTracker from './components/StatusTracker';
import RoofStats from './components/RoofStats';
import VisionAnalysis from './components/VisionAnalysis';
import RoofOverlay from './components/RoofOverlay';
import LineItems from './components/LineItems';
import './styles/app.css';

const STEPS = ['imagery', 'vision', 'jobnimbus'];

export default function App() {
  const [pipelineState, setPipelineState] = useState('idle');
  const [steps, setSteps] = useState({});
  const [imagery, setImagery] = useState(null);
  const [roofData, setRoofData] = useState(null);
  const [roofOutline, setRoofOutline] = useState(null);
  const [lineItems, setLineItems] = useState(null);
  const [visionData, setVisionData] = useState(null);
  const [jnResult, setJnResult] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const stateRef = useRef('idle');

  function handleSubmit(place) {
    // Cancel any in-flight pipeline so a new submission doesn't tangle with it.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPipelineState('running');
    stateRef.current = 'running';
    setSteps({});
    setImagery(null);
    setRoofData(null);
    setRoofOutline(null);
    setLineItems(null);
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

      const processLines = (lines) => {
        let eventName = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7);
          } else if (line.startsWith('data: ') && eventName) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventName === 'done') receivedDone = true;
              handleEvent(eventName, data);
            } catch (e) {
              // Ignore malformed event; keep streaming.
            }
            eventName = null;
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
      <header className="header">
        <div className="container">
          <div className="header-content">
            <h1 className="logo">
              JobNimbus Roofing Estimator
            </h1>
            <Timer state={pipelineState} />
          </div>
        </div>
      </header>

      <main className="container main">
        {pipelineState === 'idle' && (
          <div className="hero">
            <span className="eyebrow">AI-POWERED ROOF INSPECTION</span>
            <h2>Instant roof inspections,<br />delivered to JobNimbus</h2>
            <p className="subtitle">Enter a property address to capture roof measurements, AI analysis, and a JobNimbus job in seconds.</p>
          </div>
        )}

        <div className={`address-input-area ${pipelineState !== 'idle' ? 'compact' : ''}`}>
          <AddressInput onSubmit={handleSubmit} disabled={pipelineState === 'running'} />
        </div>

        {pipelineState !== 'idle' && (
          <StatusTracker steps={STEPS} stepState={steps} pipelineState={pipelineState} error={error} />
        )}

        {(pipelineState === 'done' || pipelineState === 'error') && (
          <div className="results">
            {imagery && (
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
            )}

            {roofData && <RoofStats data={roofData} />}

            {lineItems && <LineItems data={lineItems} />}

            {imagery && (
              <div className="imagery-grid single">
                <div className="imagery-card">
                  <span className="card-label">STREET VIEW</span>
                  <img src={imagery.streetView} alt="Street view" />
                </div>
              </div>
            )}

            {visionData && <VisionAnalysis data={visionData} />}

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
      </main>
    </div>
  );
}
