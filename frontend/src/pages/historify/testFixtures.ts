import type { DatasetCatalog, DatasetVersion } from '@/api/dataLibrary'
import { emptyDatasetContext } from './DataLibraryImport'

export function datasetVersion(changes: Partial<DatasetVersion> = {}): DatasetVersion {
  return {
    id: 'version-one',
    datasetId: 'dataset-one',
    name: 'EURUSD fixture',
    metadata: {
      ...emptyDatasetContext(),
      symbol: 'EURUSD',
      provider: 'fixture-csv',
      exchange: 'LOCAL',
    },
    checksum: 'content-checksum',
    sourceHash: 'source-checksum',
    rowCount: 3,
    start: 1793610000,
    end: 1793610120,
    sizeBytes: 16384,
    quality: { status: 'verified', summary: '3 structurally valid candles' },
    coverage: { volumeUnknownRows: 3 },
    createdAt: '2026-11-03T09:00:00Z',
    dependencies: [],
    ...changes,
  }
}
export function datasetCatalog(versions: DatasetVersion[] = []): DatasetCatalog {
  return {
    principalId: 'principal-one',
    revision: 1,
    versions,
    jobs: [],
    capabilities: { downloads: { available: false } },
    nextOffset: null,
  }
}
