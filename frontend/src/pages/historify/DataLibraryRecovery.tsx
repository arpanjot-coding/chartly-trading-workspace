import { useEffect, useRef, useState } from 'react'
import {
  type DatasetCatalog,
  type DatasetPreview,
  type DatasetVersion,
  dataLibrary,
} from '@/api/dataLibrary'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { dataLibraryDrafts } from '@/lib/historify/dataLibraryDrafts'
import { DataQuality } from './DataLibraryImport'

interface BundleDraft {
  id: string
  expectedRevision: number
  requestId?: string
}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () =>
      reject(new Error('The dataset backup could not be read. Keep the original file.'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}
export default function DataLibraryRecovery({
  principalId,
  catalog,
  resumeId,
  onCatalog,
  onVersion,
}: {
  principalId: string
  catalog: DatasetCatalog
  resumeId?: string
  onCatalog: (catalog: DatasetCatalog) => void
  onVersion: (version: DatasetVersion) => void
}) {
  const [base64, setBase64] = useState('')
  const [filename, setFilename] = useState('')
  const [preview, setPreview] = useState<DatasetPreview | null>(null)
  const [draft, setDraft] = useState<BundleDraft | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setReady(false)
    setBase64('')
    setFilename('')
    setPreview(null)
    setDraft(null)
    setError('')
    void (async () => {
      const stored = await dataLibraryDrafts.bundleGet<BundleDraft>(principalId)
      const id = resumeId ?? stored?.value.id
      if (!id || current !== generation.current) return
      const job = await dataLibrary.bundleJob(id)
      if (current !== generation.current) return
      setPreview(job)
      setDraft(
        stored?.value.id === id ? stored.value : { id, expectedRevision: job.expectedRevision }
      )
    })()
      .catch((cause) => {
        if (current === generation.current)
          setError(
            cause instanceof Error
              ? cause.message
              : 'The retained backup review could not be opened.'
          )
      })
      .finally(() => {
        if (current === generation.current) setReady(true)
      })
    return () => {
      generation.current++
    }
  }, [principalId, resumeId])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The backup request failed. Keep its original file and review.'
      )
    } finally {
      setBusy(false)
    }
  }
  async function stage() {
    const result = await dataLibrary.previewBundle(catalog.revision, base64)
    const next = { id: result.id, expectedRevision: result.expectedRevision }
    await dataLibraryDrafts.bundleSave(principalId, next)
    setPreview(result)
    setDraft(next)
  }
  async function commit() {
    if (!preview || !draft) return
    const retained = { ...draft, requestId: draft.requestId ?? crypto.randomUUID() }
    setDraft(retained)
    await dataLibraryDrafts.bundleSave(principalId, retained)
    const result = await dataLibrary.commitBundle(
      retained.id,
      retained.expectedRevision,
      retained.requestId
    )
    onCatalog(result.catalog)
    await dataLibraryDrafts.bundleDelete(principalId)
    onVersion(result.version)
  }
  const stale = preview && preview.expectedRevision !== catalog.revision
  return (
    <Card>
      <CardHeader>
        <CardTitle>Restore a dataset backup</CardTitle>
        <CardDescription>
          This imports candle history into your private library after validation. Journal workspace
          backups are restored in Storage & recovery.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="dataset-bundle">Dataset backup ZIP (up to 32 MiB)</Label>
          <Input
            id="dataset-bundle"
            type="file"
            accept=".zip,application/zip"
            disabled={busy || !ready}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              if (file.size > 32 * 1024 * 1024) {
                setError('Choose a dataset backup no larger than 32 MiB.')
                return
              }
              void run(async () => {
                setBase64(await readFile(file))
                setFilename(file.name)
                setPreview(null)
                setDraft(null)
              })
            }}
          />
          {filename && <p className="text-xs">Selected: {filename}</p>}
          <p className="text-xs text-muted-foreground">
            Keep the original file until its local preview completes. A retained preview and exact
            retry identity can be reopened after reload.
          </p>
        </div>
        <Button disabled={busy || !ready || !base64} onClick={() => void run(stage)}>
          Validate dataset backup
        </Button>
        {preview && (
          <section className="space-y-3 border-t pt-4" aria-label="Dataset backup preview">
            {preview.quarantine && (
              <div role="note" className="space-y-1 rounded border p-3 text-sm">
                <p className="font-medium">Time verification required</p>
                <p>{preview.quarantine.message}</p>
                <p>Restoring this backup retains its time verification requirement.</p>
              </div>
            )}
            <DataQuality preview={preview.preview} />
            {preview.status === 'completed' ? (
              <>
                <p>
                  This backup review has already been saved. Refresh the catalog to inspect the
                  retained version.
                </p>
                <Button
                  variant="outline"
                  onClick={() => void run(async () => onCatalog(await dataLibrary.catalog()))}
                >
                  Refresh catalog
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm">
                  {stale
                    ? 'The catalog changed. Re-preview the retained backup before restoring.'
                    : 'Checksums, dataset metadata and candle quality were reviewed against this catalog revision.'}
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await dataLibrary.repreviewBundle(preview.id, catalog.revision)
                      const next = { id: result.id, expectedRevision: result.expectedRevision }
                      await dataLibraryDrafts.bundleSave(principalId, next)
                      setPreview(result)
                      setDraft(next)
                    })
                  }
                >
                  Re-preview retained backup
                </Button>
                <Button
                  disabled={busy || !!stale || preview.preview.canCommit === false}
                  onClick={() => void run(commit)}
                >
                  {draft?.requestId ? 'Retry the same restore' : 'Restore reviewed dataset'}
                </Button>
              </>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  )
}
