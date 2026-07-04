// Provider selection + the fail-safe fallback wrapper.
//
//   DEMO_MODE=true  or  no GEMINI_API_KEY  ->  demo (canned results)
//   otherwise                              ->  gemini, but any error falls back
//                                              to demo for the SAME request so a
//                                              live demo can never hard-fail.
const demo = require('./demo');

function pickProvider() {
  const hasKey = !!process.env.GEMINI_API_KEY;
  const forced = process.env.DEMO_MODE === 'true';
  if (forced || !hasKey) return demo;

  const gemini = require('./gemini');
  return {
    name: 'gemini',
    async tryOn(args) {
      try {
        return await gemini.tryOn(args);
      } catch (err) {
        console.warn('[gemini] tryOn failed, falling back to demo:', err.code || err.message);
        const fallback = await demo.tryOn(args);
        return { ...fallback, demoFallback: true };
      }
    },
    async suggest(args) {
      try {
        return await gemini.suggest(args);
      } catch (err) {
        console.warn('[gemini] suggest failed, falling back to demo:', err.code || err.message);
        const fallback = await demo.suggest(args);
        return { ...fallback, demoFallback: true };
      }
    },
  };
}

module.exports = pickProvider();
