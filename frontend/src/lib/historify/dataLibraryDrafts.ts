import { journalDrafts } from '@/lib/trader/journalDrafts'

export function datasetDraftScope(principalId: string) {
  return { principalId, originId: 'private-dataset-library', bookId: 'private-dataset-library' }
}
/** Reuse the bounded local draft store; this scope never overlaps a journal book. */
export const dataLibraryDrafts = {
  get: <T>(principalId: string) => journalDrafts.get<T>(datasetDraftScope(principalId), 'import'),
  save: <T>(principalId: string, value: T) =>
    journalDrafts.save(datasetDraftScope(principalId), 'import', value),
  delete: (principalId: string) => journalDrafts.delete(datasetDraftScope(principalId), 'import'),
  bundleGet: <T>(principalId: string) =>
    journalDrafts.get<T>(datasetDraftScope(principalId), 'dataset-bundle'),
  bundleSave: <T>(principalId: string, value: T) =>
    journalDrafts.save(datasetDraftScope(principalId), 'dataset-bundle', value),
  bundleDelete: (principalId: string) =>
    journalDrafts.delete(datasetDraftScope(principalId), 'dataset-bundle'),
}
