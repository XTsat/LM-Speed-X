// Copy text to the clipboard.
// `navigator.clipboard` is only available in secure contexts (HTTPS or
// localhost). On plain HTTP it is `undefined`, so we fall back to the legacy
// `document.execCommand('copy')` approach to avoid crashing.
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some browsers reject the promise (e.g. permissions) - fall back below.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!ok) {
    throw new Error('Copy failed')
  }
}
