import settings from '../../../../docs/site.json';
export const docsRepository = settings.repository;
export const docsSourceUrl = (source: string) => `${settings.repository}/blob/${settings.branch}/${source}`;
