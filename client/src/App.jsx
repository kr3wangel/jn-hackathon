import React, { useState } from 'react';
import AddressInput from './components/AddressInput';
import Timer from './components/Timer';
import StatusTracker from './components/StatusTracker';
import RoofStats from './components/RoofStats';
import VisionAnalysis from './components/VisionAnalysis';
import ProposalView from './components/ProposalView';
import './styles/app.css';

const STEPS = ['imagery', 'vision', 'pricing', 'jobnimbus'];

export default function App() {
  const [pipelineState, setPipelineState] = useState('idle');
  const [steps, setSteps] = useState({});
  const [imagery, setImagery] = useState(null);
  const [roofData, setRoofData] = useState(null);
  const [visionData, setVisionData] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [jnResult, setJnResult] = useState(null);
  const [error, setError] = useState(null);

  function handleSubmit(place) {
    setPipelineState('running');
    setSteps({});
    setImagery(null);
    setRoofData(null);
    setVisionData(null);
    setEstimate(null);
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
    }).then(async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        let eventName = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7);
          } else if (line.startsWith('data: ') && eventName) {
            const data = JSON.parse(line.slice(6));
            handleEvent(eventName, data);
            eventName = null;
          }
        }
      }
    }).catch((err) => {
      setError(err.message);
      setPipelineState('error');
    });
  }

  function handleEvent(event, data) {
    if (event === 'step') {
      setSteps((prev) => ({ ...prev, [data.step]: data.status }));
      if (data.step === 'imagery' && data.data) {
        setImagery({ satellite: data.data.satellite, streetView: data.data.streetView });
        if (data.data.roofData) setRoofData(data.data.roofData);
      }
      if (data.step === 'vision' && data.data) {
        setVisionData(data.data);
      }
      if (data.step === 'pricing' && data.data) {
        setEstimate(data.data);
      }
      if (data.step === 'jobnimbus' && data.data) {
        setJnResult(data.data);
      }
    } else if (event === 'done') {
      setPipelineState('done');
      if (data.roofData) setRoofData(data.roofData);
      if (data.visionData) setVisionData(data.visionData);
      if (data.estimate) setEstimate(data.estimate);
      if (data.jobnimbus) setJnResult(data.jobnimbus);
    } else if (event === 'error') {
      setError(data.message);
      setPipelineState('error');
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
        <div className="hero">
          <span className="eyebrow">AI-POWERED ROOF ESTIMATOR</span>
          <h2>Instant roofing estimates,<br />delivered to JobNimbus</h2>
          <p className="subtitle">Enter a property address to generate a professional three-tier estimate in seconds.</p>
        </div>

        <AddressInput onSubmit={handleSubmit} disabled={pipelineState === 'running'} />

        {pipelineState !== 'idle' && (
          <StatusTracker steps={STEPS} stepState={steps} pipelineState={pipelineState} error={error} />
        )}

        {roofData && <RoofStats data={roofData} />}

        {imagery && (
          <div className="imagery-grid">
            <div className="imagery-card">
              <span className="card-label">SATELLITE VIEW</span>
              <img src={imagery.satellite} alt="Satellite view" />
            </div>
            <div className="imagery-card">
              <span className="card-label">STREET VIEW</span>
              <img src={imagery.streetView} alt="Street view" />
            </div>
          </div>
        )}

        {visionData && <VisionAnalysis data={visionData} />}

        {estimate && <ProposalView estimate={estimate} />}

        {jnResult && !jnResult.skipped && (
          <div className="jn-success">
            <div className="jn-success-icon">✓</div>
            <div className="jn-success-text">
              <strong>Pushed to JobNimbus</strong>
              <span>Contact, job, and {jnResult.tier} estimate created — ${jnResult.total?.toLocaleString()}</span>
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
      </main>
    </div>
  );
}
