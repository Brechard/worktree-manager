# Releasing Worktree Manager

The [Release workflow](../.github/workflows/release.yml) builds macOS (Apple silicon and
Intel), Windows x64, and Linux x64 installers and ZIPs. It stages a **draft** GitHub
release with `SHA256SUMS`; publishing is a separate maintainer decision. Never describe a
draft or a workflow artifact as a public download.

## Apple credentials

For downloads outside the Mac App Store, sign the app with a **Developer ID Application**
certificate from the ClubTidy Apple Developer team. A **Mac App Distribution** or **Apple
Distribution** certificate is for the Mac App Store and cannot replace Developer ID for
this release. The `publish@clubtidy.fr` Apple account can be used for the Apple ID
notarization route, but an account login alone does not provide a signing identity: the
certificate and its private key must be exported together as a password-protected `.p12`.

Store credentials as GitHub Actions secrets, never in the repository:

| Secret                                                     | Value                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `MAC_CSC_LINK`                                             | Base64-encoded `.p12` with the Developer ID Application certificate and private key. |
| `MAC_CSC_KEY_PASSWORD`                                     | Export password for the `.p12`.                                                      |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`    | Base64-encoded App Store Connect `.p8` file, key ID, and issuer ID.                  |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Apple ID, app-specific password, and Developer team ID.                              |

Configure one complete notarization route; the API key route is preferred. For that
route, the workflow decodes the `.p8` secret into a private temporary file and passes its
path to electron-builder. The `.p8` key is distinct from the `.p12` signing
certificate. Do not paste either private key into workflow YAML, release notes, issues,
or logs. Windows signing is separate and is not supplied by Apple credentials.

## Prepare and stage a release

1. Confirm the root package, desktop package, and lockfile versions match the proposed
   stable tag (for example `v0.2.0`). Run the formatting, typecheck, build, test, and
   React Doctor checks. Create the tag only after the release commit is ready.
2. Run the release workflow from the tag, or dispatch it with an existing tag. The
   workflow must finish its quality gate and platform builds before it can assemble the
   exact assets and checksum file in a draft release.
3. Check the draft's filenames and `SHA256SUMS`. For `v0.2.0`, the expected downloads are
   `Worktree-Manager-0.2.0-macos-{arm64,x64}.{dmg,zip}`,
   `Worktree-Manager-0.2.0-windows-x64.{exe,zip}`, and
   `Worktree-Manager-0.2.0-linux-x64.{AppImage,zip}`. Verify checksums against the
   downloaded files, not only the workflow's staging directory.
4. Install and launch the actual downloaded DMG and Windows installer on their target
   systems. On macOS, confirm the app has a Developer ID Application signature, its
   notarization ticket is stapled, and Gatekeeper accepts it. For the installed app,
   run `codesign --verify --deep --strict`, `xcrun stapler validate`, and
   `spctl --assess --type exec` with the app path. Confirm the app can find Git and open
   a repository. Publish the draft only after these checks pass.

Full releases require all four platform builds. To test the Windows installer while
Apple credentials are being configured, dispatch the workflow from `main` with
`platform=windows` and the matching version (for example `tag=v0.2.0`). This preview
does not require an existing tag and uploads CI artifacts without creating a release.
A Windows download remains unsigned until a separate Windows code-signing certificate
or signing service is configured, and SmartScreen can still warn while publisher
reputation develops.

See [Apple's Developer ID certificate guidance](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
and [electron-builder's signing guide](https://www.electron.build/docs/features/code-signing/)
for certificate types and signing requirements.
