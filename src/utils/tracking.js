function generateTrackingCode(session, fallbackId) {
  const id = Number.isFinite(Number(session)) ? Number(session) :
             Number.isFinite(Number(fallbackId)) ? Number(fallbackId) : 0;

  // Encode session ID in Base36, fixed 4 chars
  const encodedId = Number(id).toString(36).toUpperCase().padStart(4, "0");

  // 6-char Base36 timestamp (last part of Date.now())
  const shortTime = Date.now().toString(36).toUpperCase().slice(-6);

  // 3-char random alphanumeric
  const randomPart = Math.random().toString(36).substring(2, 5).toUpperCase();

  // Format: TRK-XXXX-XXXXXX-XXX
  return `TRK-${encodedId}-${shortTime}-${randomPart}`;
}

module.exports = { generateTrackingCode };
