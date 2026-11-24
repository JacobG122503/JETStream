// Runs the migrations from source where the development tools are installed, and otherwise
// (a production install) from the build.
let devTools = true
try {
  await import('tsx')
} catch {
  devTools = false
}
await import(devTools ? '../src/server/migrate.ts' : '../dist/server/migrate.js')
