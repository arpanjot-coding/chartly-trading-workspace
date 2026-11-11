export function libraryReturn(value: string | null): string {
  if (!value || value.length > 2000 || value.includes('\\') || value.startsWith('//'))
    return '/workspace'
  try {
    const url = new URL(value, 'http://local.invalid')
    if (url.origin !== 'http://local.invalid') return '/workspace'
    if (
      !/^(?:\/workspace(?:\/profiles\/[1-9]\d*(?:\/(?:replay|journal|connections))?)?|\/trading|\/settings\/connections)$/.test(
        url.pathname
      )
    )
      return '/workspace'
    if (url.pathname === '/settings/connections') {
      if ([...url.searchParams.keys()].some((key) => key !== 'profileId')) return '/workspace'
      const profiles = url.searchParams.getAll('profileId')
      if (profiles.length > 1 || (profiles.length === 1 && !/^[1-9]\d*$/.test(profiles[0])))
        return '/workspace'
    }
    return `${url.pathname}${url.search}`
  } catch {
    return '/workspace'
  }
}
export function datasetChartHref(id: string, returnTo: string): string {
  return `/trading?${new URLSearchParams({ datasetVersionId: id, returnTo })}`
}
export function datasetLibraryHref(returnTo: string, versionId?: string): string {
  const params = new URLSearchParams({ returnTo: libraryReturn(returnTo) })
  if (versionId) params.set('version', versionId)
  return `/historify?${params}`
}
