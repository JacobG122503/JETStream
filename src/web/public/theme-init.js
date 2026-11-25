// Applies the chosen appearance before the first paint. It is a file of its own, not inline, so
// that it also runs under Content-Security-Policy: script-src 'self'. The key and the values are
// those of theme/theme.ts; theme.test.tsx checks that they agree.
;(function () {
  try {
    var choice = window.localStorage.getItem('jetstream.theme')
    if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice)
  } catch {
    // Storage is blocked: follow the operating system.
  }
})()
