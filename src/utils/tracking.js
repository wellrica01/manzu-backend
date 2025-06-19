function generateTrackingCode(session, fallbackId) {
  const id = Number.isFinite(Number(session)) ? Number(session) :
             Number.isFinite(Number(fallbackId)) ? Number(fallbackId) : 0;
  const timestamp = Date.now();
  return `TRK-SESSION-${id}-${timestamp}`;
}

module.exports = { generateTrackingCode };