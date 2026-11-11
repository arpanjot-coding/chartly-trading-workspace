export function notifyPreferenceChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('chartly:preferences-changed'))
}
