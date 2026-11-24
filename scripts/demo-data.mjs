// Seeds or resets demo data, from source where the development tools are installed, and otherwise
// (a production install) from the build.
let devTools = true
try {
  await import('tsx')
} catch {
  devTools = false
}
await import(devTools ? '../src/server/demoData.ts' : '../dist/server/demoData.js')
