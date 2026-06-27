// After electron-builder packages the macOS app, re-seal it with a valid
// ad-hoc signature. electron-builder skips signing when no Developer ID is
// present, which leaves the arm64 bundle with a broken seal — and a broken or
// absent signature on an arm64 app downloaded from the web is rejected by
// Gatekeeper as "damaged" (with no Open option at all).
//
// A valid ad-hoc signature downgrades that to the normal "unidentified
// developer" prompt, which the user clears once with right-click -> Open.
// The real fix for a friction-free install is a Developer ID + notarization;
// this is the best we can do while shipping unsigned.
const { execSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = `${context.appOutDir}/${appName}.app`
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
  console.log(`  • ad-hoc signed ${appPath}`)
}
