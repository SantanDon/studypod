// Fixed service classes only; never retain arguments, IDs, environment or errors.
export function monitorLifecycle({ persist, interruptBrowser, now = () => new Date().toISOString() }) {
  let cleaning = false, browser = null, failure = null, pending = Promise.resolve(), persistenceFailed = false;
  const events = [];
  function snapshot() { return { schemaVersion: 1, failure, persistenceFailed, events: events.map(event => ({ ...event })) }; }
  function record(event) {
    events.push({ at: now(), ...event });
    const data = snapshot();
    pending = pending.then(() => persist(data)).catch(() => { persistenceFailed = true; });
  }
  function interrupt() { if (browser) { const target = browser; browser = null; interruptBrowser(target); } }
  return {
    watch(child, service) {
      if (!['backend', 'preview'].includes(service)) throw new Error('Unknown service class');
      record({ service, phase: 'start' });
      child.once('error', () => {
        const unexpected = !cleaning;
        record({ service, phase: 'spawn-error', unexpected });
        if (unexpected && !failure) { failure = { service, phase: 'spawn-error' }; record({ service, phase: 'failure' }); interrupt(); }
      });
      child.once('exit', (code, signal) => {
        const unexpected = !cleaning;
        record({ service, phase: 'exit', unexpected, code: Number.isInteger(code) ? code : null, signal: typeof signal === 'string' && /^SIG[A-Z0-9]+$/.test(signal) ? signal : null });
        if (unexpected && !failure) { failure = { service, phase: 'exit' }; record({ service, phase: 'failure' }); interrupt(); }
      });
    },
    trackBrowser(child) { browser = child; if (failure) interrupt(); },
    beginCleanup() { cleaning = true; record({ service: 'runner', phase: 'cleanup' }); },
    assertHealthy() { if (failure || persistenceFailed) throw new Error('Acceptance service lifecycle failed; inspect service-lifecycle.json'); },
    snapshot,
    async flush() { await pending; return snapshot(); },
  };
}
