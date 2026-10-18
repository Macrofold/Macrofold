export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializePerformance } = await import('@platform/core/performance-composition');
    initializePerformance();
  }
}
