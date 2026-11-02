const { expect } = require('@playwright/test');

// Inspect emitted JSON and decoded wire streams independently. Searching JSON
// alone would miss a credential hidden inside the recording's base64 fields.
function expectPrivateArtifact(artifact, credentials) {
  const text = typeof artifact === 'string' ? artifact : JSON.stringify(artifact);
  for (const value of credentials.filter(Boolean)) {
    expect(text.toLowerCase()).not.toContain(value.toLowerCase());
  }
}

function expectPrivateRecording(recording, credentials) {
  expect(recording.meta.mode).toBe('debug');
  expect(recording.meta.redacted).toMatchObject({ ids: true, secrets: true });
  expect(recording.events.some(event => event.dir === 'recv')).toBe(true);
  expect(recording.events.some(event => event.dir === 'send')).toBe(true);
  expect(recording.events.some(event => event.tag === 'autoLogin.start')).toBe(true);
  expectPrivateArtifact(recording, credentials);
  const decode = value => Buffer.from(value || '', 'base64').toString('latin1');
  for (const direction of ['recv', 'send']) {
    const stream = recording.events.filter(event => event.dir === direction)
      .map(event => decode(event.data)).join('');
    expectPrivateArtifact(stream, credentials);
    if (direction === 'send') {
      // A recording of negotiation only would conceal a missing login capture.
      for (const value of credentials.slice(0, 2)) expect(stream).toContain('x'.repeat(value.length) + '\r');
    }
  }
  expect(recording.cassette.steps.length).toBeGreaterThan(0);
  for (const property of ['recv', 'send']) {
    expectPrivateArtifact(recording.cassette.steps.map(step => decode(step[property])).join(''), credentials);
  }
}

module.exports = { expectPrivateArtifact, expectPrivateRecording };
