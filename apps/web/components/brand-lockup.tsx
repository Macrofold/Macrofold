/** Public presentation only; configured deployment names never change domain keys. */
export function publicProductName(name: string) {
  return ['macrofold', 'platform'].includes(name.toLowerCase()) ? 'Macrofold' : name;
}

/** Use the supplied outlined lettering, never a font approximation of the wordmark. */
export function BrandLockup({ name }: { name: string }) {
  const displayName = publicProductName(name);
  return displayName === 'Macrofold' ? (
    <img src="/brands/macrofold/lockup.svg" width={194} height={45} alt="Macrofold" />
  ) : (
    <>
      <img src="/brands/macrofold/mark.svg" width={32} height={32} alt="" />
      {displayName}
    </>
  );
}
