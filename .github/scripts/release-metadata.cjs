// Cargo parses Cargo.toml; this helper selects the root package, not a dependency.
const fs = require('node:fs');
const path = require('node:path');

function releaseMetadata(metadata, manifestPath) {
  const root = path.resolve(manifestPath);
  const pkg = metadata.packages?.find(p => path.resolve(p.manifest_path) === root);
  if (!pkg) throw Error('Root package was not found in cargo metadata.');
  // Cargo validates SemVer. Also bound values before writing workflow outputs or refs.
  if (typeof pkg.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw Error('Root package version is not a safe SemVer release identifier.');
  }
  return {
    version: pkg.version,
    tag: `v${pkg.version}`,
    prerelease: pkg.version.split('+')[0].includes('-'),
  };
}

if (require.main === module) {
  try {
    const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const result = releaseMetadata(metadata, process.argv[3] || 'Cargo.toml');
    if (!process.env.GITHUB_OUTPUT) throw Error('GITHUB_OUTPUT is required.');
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { releaseMetadata };
