export const meta = {
  name: 'ship',
  description: 'Gate, review, verify, fix, style and look at a Ashfolk branch before its pull request',
  whenToUse:
    'After a feature, fix or refactor is committed on its own branch in its own worktree, before opening the pull request. Args: "<worktree path> [auto|light|full]".',
  phases: [
    { title: 'Gate', detail: 'check, typecheck, test, build, knip, and the size of the change' },
    { title: 'Review', detail: 'read-only reviewers, one lens each' },
    { title: 'Verify', detail: 'one verifier per finding, two for high severity' },
    { title: 'Fix', detail: 'one fixer applies confirmed findings' },
    { title: 'Recheck', detail: 'bugs lens on the fixes only, in full mode' },
    { title: 'Style', detail: 'code-style agent on the branch' },
    { title: 'Look', detail: 'screenshots before and after for rendering and interface changes' },
    { title: 'Final gate', detail: 'all checks once more' },
  ],
}

const BASE = 'origin/main'
const MODES = ['auto', 'light', 'full']
const FIRST_PORT = 5300
const PORT_PAIRS = 300
const LARGE_CHANGE_LINES = 200
const MOST_FINDINGS_PER_LENS = 6

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    flaky: { type: 'array', items: { type: 'string' } },
    root: { type: 'string' },
    base: { type: 'string' },
    branch: { type: 'string' },
    head: { type: 'string' },
    changedLines: { type: 'number' },
    files: { type: 'array', items: { type: 'string' } },
    touchesCore: { type: 'boolean' },
    hasRuntimeCode: { type: 'boolean' },
    touchesLook: { type: 'boolean' },
  },
  required: ['passed', 'failures', 'flaky', 'root', 'base', 'branch', 'head', 'changedLines', 'files', 'touchesCore', 'hasRuntimeCode', 'touchesLook'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          summary: { type: 'string' },
          scenario: { type: 'string' },
        },
        required: ['file', 'line', 'severity', 'summary', 'scenario'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['real', 'not real', 'unsure'] },
    evidence: { type: 'string' },
  },
  required: ['verdict', 'evidence'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    left: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    checksPassed: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    flaky: { type: 'array', items: { type: 'string' } },
  },
  required: ['fixed', 'left', 'commits', 'checksPassed', 'failures', 'flaky'],
}

const STYLE_SCHEMA = {
  type: 'object',
  properties: {
    changes: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    left: { type: 'array', items: { type: 'string' } },
  },
  required: ['changes', 'commits', 'left'],
}

const LOOK_SCHEMA = {
  type: 'object',
  properties: {
    adapter: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          before: { type: 'string' },
          after: { type: 'string' },
          differences: { type: 'string' },
          looksWrong: { type: 'boolean' },
        },
        required: ['name', 'before', 'after', 'differences', 'looksWrong'],
      },
    },
  },
  required: ['adapter', 'scenes'],
}

function inputOf(raw) {
  const given = typeof raw === 'string' ? raw.trim().split(/\s+/) : [raw && raw.path, raw && raw.mode]
  const path = given[0] || '.'
  const mode = (given[1] || 'auto').toLowerCase()

  if (!MODES.includes(mode)) {
    throw new Error(`Unknown mode "${mode}"; use ${MODES.join(', ')}`)
  }

  return { path, mode }
}

function portsFor(branch) {
  let hash = 0

  for (const character of branch) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1_000_003
  }

  const first = FIRST_PORT + (hash % PORT_PAIRS) * 2

  return [first, first + 1]
}

function gatePrompt(path, base) {
  const fetch = base === BASE ? '\`git fetch -q origin\`, then ' : ''

  return `Run the Ashfolk checks in the worktree at ${path} (cd there first) and measure its change against ${base}. Don't edit, commit or push.

1. Run ${fetch} \`bun run check\`, \`bun run typecheck\`, \`bun run test\`, \`bun run build\` and \`bun run knip\`. If Playwright's own Chromium is missing, set CHROMIUM_EXECUTABLE_PATH to system Chrome as CONTRIBUTING.md describes. When a browser test fails, run its file once more alone; if it passes then, list it under flaky instead of failures.
2. passed is true only when every command succeeds apart from flaky tests. Put each failure as one line with the command and the first error.
3. Report root as the absolute path from \`git rev-parse --show-toplevel\`, base as the commit of \`git merge-base ${base} HEAD\`, and from \`git diff --numstat ${base}...HEAD\` and \`git diff --name-only ${base}...HEAD\` the branch, the HEAD commit, changedLines (added plus removed), and files.
4. touchesCore: true when the change touches src/world, src/simulation, src/generation or src/game, anything saves store, or shader code (files importing three/tsl).
5. hasRuntimeCode: true when any changed file under src is not a test, story or asset.
6. touchesLook: true when the change touches src/rendering, src/models, src/design, src/features, src/app or styles.`
}

function reviewPrompt(path, lens, range, known) {
  const repeats = known.length === 0 ? '' : `\n\nThese were already judged; don't report them again:\n${known.map((finding) => `- ${finding.file}: ${finding.summary}`).join('\n')}`

  return `Review the change \`git diff ${range}\` in the worktree at ${path} (cd there first) through your lens, ${lens}. Report at most ${MOST_FINDINGS_PER_LENS} findings with file (repository path), line, severity, a one-sentence summary and a concrete scenario. Return an empty list when you find nothing worth a fix.${repeats}`
}

function verifyPrompt(path, base, finding) {
  return `In the worktree at ${path} (cd there first), decide whether this finding about the change \`git diff ${base}...HEAD\` is real.

File: ${finding.file}
Line: ${finding.line}
Claim: ${finding.summary}
Scenario: ${finding.scenario}

Give your verdict and the evidence: the lines and steps that produce the problem, or the line that prevents it.`
}

function keyOf(finding) {
  return `${finding.file}:${finding.line}`
}

async function verify(path, base, finding) {
  const votes = finding.severity === 'high' ? 2 : 1

  const verdicts = (
    await parallel(
      Array.from({ length: votes }, (_, index) => () =>
        agent(verifyPrompt(path, base, finding), {
          agentType: 'ship-verifier',
          label: `verify ${index + 1}: ${keyOf(finding)}`,
          phase: 'Verify',
          schema: VERDICT_SCHEMA,
        })
      )
    )
  ).filter(Boolean)

  const isReal = verdicts.length === votes && verdicts.every((verdict) => verdict.verdict === 'real')

  return { ...finding, isReal, evidence: verdicts.map((verdict) => `${verdict.verdict}: ${verdict.evidence}`) }
}

async function reviewAndVerify(path, base, lenses, range, known, phaseTitle) {
  const failedLenses = []

  const results = await pipeline(
    lenses,
    (lens) =>
      agent(reviewPrompt(path, lens, range, known), { agentType: lens, label: lens, phase: phaseTitle, schema: FINDINGS_SCHEMA }),
    (review, lens) => {
      if (review === null) {
        failedLenses.push(lens)
        log(`${lens} did not finish; its lens is not covered`)

        return []
      }

      return parallel(
        review.findings.slice(0, MOST_FINDINGS_PER_LENS).map((finding) => () => verify(path, base, { ...finding, lens }))
      )
    }
  )

  return { failedLenses, findings: results.flat().filter(Boolean) }
}

function fixPrompt(path, findings, failures) {
  const list = findings
    .map((finding, index) => `${index + 1}. ${finding.file}:${finding.line} (${finding.severity}, ${finding.lens}) ${finding.summary}\n   Scenario: ${finding.scenario}\n   Evidence: ${finding.evidence.join(' / ')}`)
    .join('\n')
  const retry = failures.length === 0 ? '' : `\n\nYour last attempt committed, but these checks still fail; fix them first without undoing the fixes:\n${failures.join('\n')}`

  return `In the worktree at ${path} (cd there first), fix these confirmed findings on the current branch and commit:\n\n${list}${retry}`
}

async function fix(path, findings) {
  const first = await agent(fixPrompt(path, findings, []), { agentType: 'ship-fixer', label: 'fixer', phase: 'Fix', schema: FIX_SCHEMA })

  if (first === null || first.checksPassed) {
    return first
  }

  log('Checks failed after the fixes; the fixer gets one more try')

  const retry = await agent(fixPrompt(path, findings, first.failures), {
    agentType: 'ship-fixer',
    label: 'fixer retry',
    phase: 'Fix',
    schema: FIX_SCHEMA,
  })

  if (retry === null) {
    return first
  }

  return {
    ...retry,
    commits: [...first.commits, ...retry.commits],
    fixed: [...new Set([...first.fixed, ...retry.fixed])],
  }
}

const input = inputOf(args)

phase('Gate')

const gate = await agent(gatePrompt(input.path, BASE), { label: 'gate', phase: 'Gate', schema: GATE_SCHEMA, effort: 'low' })

if (gate === null || !gate.passed) {
  return { stopped: 'gate', failures: gate === null ? ['gate agent did not finish'] : gate.failures }
}

const { mode } = input
const path = gate.root
const base = gate.base

const isFull = mode === 'full' || (mode === 'auto' && (gate.changedLines > LARGE_CHANGE_LINES || gate.touchesCore))
const lenses = isFull
  ? ['review-bugs', 'review-rules', ...(gate.hasRuntimeCode ? ['review-tests', 'review-performance'] : []), 'review-simplicity']
  : ['review-bugs']

log(`${gate.branch}: ${gate.changedLines} lines in ${gate.files.length} files, ${isFull ? 'full' : 'light'} mode, lenses ${lenses.join(', ')}`)

phase('Review')

const review = await reviewAndVerify(path, base, lenses, `${base}...HEAD`, [], 'Review')
const failedLenses = [...review.failedLenses]
const confirmed = review.findings.filter((finding) => finding.isReal)
const rejected = review.findings.filter((finding) => !finding.isReal)

log(`${confirmed.length} findings confirmed, ${rejected.length} rejected`)

const fixes = []

if (confirmed.length > 0) {
  phase('Fix')

  const result = await fix(path, confirmed)

  if (result !== null) {
    fixes.push(result)
  }

  if (isFull && result !== null && result.commits.length > 0) {
    phase('Recheck')

    const recheck = await reviewAndVerify(path, base, ['review-bugs'], `${gate.head}..HEAD`, review.findings, 'Recheck')
    const newlyConfirmed = recheck.findings.filter((finding) => finding.isReal)

    failedLenses.push(...recheck.failedLenses.map((lens) => `${lens} (recheck)`))
    rejected.push(...recheck.findings.filter((finding) => !finding.isReal))

    if (newlyConfirmed.length > 0) {
      confirmed.push(...newlyConfirmed)

      const second = await fix(path, newlyConfirmed)

      if (second !== null) {
        fixes.push(second)
      }
    }
  }
}

phase('Style')

const style = await agent(
  `Review the branch in the worktree at ${path} (cd there and work only there) against ${base}. Commit your fixes on its current branch as style(...) or refactor(...); don't create a branch, don't push and don't open a pull request. Run bun run check, bun run typecheck and bun run test before you commit.`,
  { agentType: 'code-style', label: 'code-style', phase: 'Style', schema: STYLE_SCHEMA }
)

let look = null

if (gate.touchesLook) {
  phase('Look')

  const branchSlug = gate.branch.replace(/[^a-zA-Z0-9-]/g, '-')
  const [beforePort, afterPort] = portsFor(gate.branch)
  const beforePath = `${path}-ship-main`

  look = await agent(
    `Compare the branch in the worktree at ${path} with the commit ${base}. If ${beforePath} already exists, remove it first with git worktree remove --force by that exact path. Create the worktree for ${base} at exactly ${beforePath} and remove it by that path when done. Use port ${beforePort} for ${base} and ${afterPort} for the branch. Write shots under "$TMPDIR/ashfolk-ship-shots/${branchSlug}/before" and ".../after". Changed files: ${gate.files.join(', ')}.`,
    { agentType: 'ship-visual', label: 'look', phase: 'Look', schema: LOOK_SCHEMA }
  )
}

phase('Final gate')

const finalGate = await agent(gatePrompt(path, base), { label: 'final gate', phase: 'Final gate', schema: GATE_SCHEMA, effort: 'low' })

return {
  branch: gate.branch,
  mode: isFull ? 'full' : 'light',
  lenses,
  failedLenses,
  confirmed: confirmed.map((finding) => ({ where: keyOf(finding), lens: finding.lens, severity: finding.severity, summary: finding.summary })),
  rejected: rejected.map((finding) => ({ where: keyOf(finding), lens: finding.lens, summary: finding.summary, evidence: finding.evidence })),
  fixes,
  style,
  look,
  finalGate: finalGate === null ? null : { passed: finalGate.passed, failures: finalGate.failures, flaky: finalGate.flaky },
}
