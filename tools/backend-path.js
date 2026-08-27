// Resolve the student-portal-backend checkout.
//
// The Supabase backend (migrations, edge functions) lives in a SEPARATE PRIVATE
// repo: rivertechschool-org/student-portal-backend. This repo is public and
// GitHub Pages publishes every file in it, which is why the schema is not here.
//
// The curriculum pipeline spans both repos: it reads Trees/master_tree.csv from
// THIS repo and writes seed SQL into supabase/migrations/ in the BACKEND repo.
// So the compile tools need to know where your backend checkout is.
//
// Resolution order:
//   1. $BACKEND_REPO           — explicit path, wins if set
//   2. ../student-portal-backend  — the sibling-checkout convention
//   3. this repo               — only if supabase/ is still here (old checkout)
//
// Clone them side by side and everything just works:
//   <somewhere>/student-portal/
//   <somewhere>/student-portal-backend/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function looksLikeBackend(dir) {
  return !!dir && fs.existsSync(path.join(dir, 'supabase', 'migrations'));
}

function resolveBackend() {
  const fromEnv = process.env.BACKEND_REPO;
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    if (looksLikeBackend(abs)) return abs;
    throw new Error(
      'BACKEND_REPO is set to "' + fromEnv + '" but there is no supabase/migrations/ there.\n' +
      'Point it at a checkout of rivertechschool-org/student-portal-backend.'
    );
  }

  const sibling = path.resolve(ROOT, '..', 'student-portal-backend');
  if (looksLikeBackend(sibling)) return sibling;

  // Pre-split checkouts still have supabase/ in this repo.
  if (looksLikeBackend(ROOT)) return ROOT;

  throw new Error(
    'Cannot find the backend repo.\n\n' +
    'The Supabase migrations moved to the private repo\n' +
    '  rivertechschool-org/student-portal-backend\n' +
    'because this repo is public and Pages serves every file in it.\n\n' +
    'Clone it next to this one:\n' +
    '  git clone https://github.com/rivertechschool-org/student-portal-backend.git ' +
    path.resolve(ROOT, '..', 'student-portal-backend') + '\n\n' +
    'Or point BACKEND_REPO at an existing checkout:\n' +
    '  BACKEND_REPO=/path/to/student-portal-backend node tools/<script>.js\n'
  );
}

module.exports = resolveBackend();
