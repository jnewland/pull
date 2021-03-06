/* eslint-env node, jest */

process.env.LOG_LEVEL = 'fatal'

const { createRobot } = require('probot')
const Pull = require('../lib/pull')
const helper = require('../lib/helper')

let robot
let github

beforeEach(() => {
  robot = createRobot()

  // Mock out the GitHub API
  github = {
    repos: {
      compareCommits: jest.fn()
    },
    pullRequests: {
      create: jest.fn(),
      get: jest.fn(),
      createReviewRequest: jest.fn(),
      merge: jest.fn()
    },
    issues: {
      edit: jest.fn()
    },
    gitdata: {
      updateReference: jest.fn()
    },
    search: {
      issues: jest.fn()
    }
  }

  // Mock out GitHub client
  robot.auth = () => Promise.resolve(github)

  // TODO
  // robot.log = console
})

const goodConfig = {
  version: '1',
  rules: [
    {
      base: 'master',
      upstream: 'upstream:master',
      autoMerge: false,
      assignees: [],
      reviewers: []
    },
    {
      base: 'feature/new-1',
      upstream: 'upstream:dev',
      autoMerge: true,
      autoMergeHardReset: false,
      assignees: ['tom'],
      reviewers: ['jerry']
    },
    {
      base: 'hotfix/bug-1',
      upstream: 'upstream:dev',
      autoMerge: true,
      autoMergeHardReset: true,
      assignees: ['wei'],
      reviewers: ['wei']
    }
  ],
  label: 'pull'
}
const getPull = () => new Pull(github, { owner: 'wei', repo: 'fork', logger: robot.log }, goodConfig)

describe('pull - routineCheck', () => {
  test('bad config', async () => {
    try {
      new Pull(github, { owner: 'wei', repo: 'fork', logger: robot.log })  // eslint-disable-line
      throw Error('Should throw error and go to catch')
    } catch (err) {
      expect(err.message).toEqual('Invalid config')
    }
  })

  test('logger fall back to console', async () => {
    const pull = new Pull(github, { owner: 'wei', repo: 'fork' }, goodConfig)
    expect(pull.logger).toBe(console)
  })

  test('same branch', async () => {
    const configs = [
      { version: '1', rules: [{ base: 'master', upstream: 'master' }] },
      { version: '1', rules: [{ base: 'master', upstream: 'wei:master' }] }
    ]

    for (let i = 0; i < configs.length; i++) {
      const pull = new Pull(github, { owner: 'wei', repo: 'fork', logger: robot.log }, configs[i])
      await pull.routineCheck()
      expect(github.repos.compareCommits).not.toHaveBeenCalled()
      expect(github.search.issues).not.toHaveBeenCalled()
      expect(github.pullRequests.create).not.toHaveBeenCalled()
      expect(github.issues.edit).not.toHaveBeenCalled()
    }
  })

  test('no diff', async () => {
    github.repos.compareCommits.mockResolvedValue({ data: { total_commits: 0 } })

    const pull = getPull()
    await pull.routineCheck()
    expect(github.repos.compareCommits).nthCalledWith(1, {
      owner: 'wei', repo: 'fork', base: 'master', head: 'upstream:master'
    })
    expect(github.repos.compareCommits).nthCalledWith(3, {
      owner: 'wei', repo: 'fork', base: 'hotfix/bug-1', head: 'upstream:dev'
    })
    expect(github.repos.compareCommits).nthCalledWith(2, {
      owner: 'wei', repo: 'fork', base: 'feature/new-1', head: 'upstream:dev'
    })
    expect(github.search.issues).not.toHaveBeenCalled()
    expect(github.pullRequests.create).not.toHaveBeenCalled()
    expect(github.issues.edit).not.toHaveBeenCalled()
  })

  test('yes diff, already has PR', async () => {
    github.repos.compareCommits.mockResolvedValue({ data: { total_commits: 1 } })
    github.search.issues.mockResolvedValue({ data: { total_count: 1 } })

    const pull = getPull()
    await pull.routineCheck()
    expect(github.repos.compareCommits).nthCalledWith(1, {
      owner: 'wei', repo: 'fork', base: 'master', head: 'upstream:master'
    })
    expect(github.repos.compareCommits).nthCalledWith(2, {
      owner: 'wei', repo: 'fork', base: 'feature/new-1', head: 'upstream:dev'
    })
    expect(github.repos.compareCommits).nthCalledWith(3, {
      owner: 'wei', repo: 'fork', base: 'hotfix/bug-1', head: 'upstream:dev'
    })
    expect(github.search.issues).toHaveBeenCalled()
    expect(github.pullRequests.create).not.toHaveBeenCalled()
    expect(github.issues.edit).not.toHaveBeenCalled()
  })

  test('yes diff, no PR, create PR', async () => {
    github.repos.compareCommits.mockResolvedValue({ data: { total_commits: 1 } })
    github.search.issues
      .mockResolvedValueOnce({ data: { total_count: 1 } })
      .mockResolvedValueOnce({ data: { total_count: 0 } })
      .mockResolvedValueOnce({ data: { total_count: 0 } })
    github.pullRequests.create
      .mockResolvedValueOnce({ data: { number: 12 } })
      .mockResolvedValueOnce({ data: { number: 16 } })

    const pull = getPull()
    await pull.routineCheck()
    expect(github.repos.compareCommits).nthCalledWith(1, {
      owner: 'wei', repo: 'fork', base: 'master', head: 'upstream:master'
    })
    expect(github.repos.compareCommits).nthCalledWith(2, {
      owner: 'wei', repo: 'fork', base: 'feature/new-1', head: 'upstream:dev'
    })
    expect(github.repos.compareCommits).nthCalledWith(3, {
      owner: 'wei', repo: 'fork', base: 'hotfix/bug-1', head: 'upstream:dev'
    })
    expect(github.search.issues).toHaveBeenCalledTimes(3)
    expect(github.pullRequests.create).toHaveBeenCalledTimes(2)
    expect(github.pullRequests.create).nthCalledWith(1, {
      owner: 'wei', repo: 'fork', base: 'feature/new-1', head: 'upstream:dev', maintainer_can_modify: false, title: helper.getPRTitle('feature/new-1', 'upstream:dev'), body: helper.getPRBody('wei/fork')
    })
    expect(github.pullRequests.create).nthCalledWith(2, {
      owner: 'wei', repo: 'fork', base: 'hotfix/bug-1', head: 'upstream:dev', maintainer_can_modify: false, title: helper.getPRTitle('hotfix/bug-1', 'upstream:dev'), body: helper.getPRBody('wei/fork')
    })
    expect(github.issues.edit).toHaveBeenCalledTimes(2)
    expect(github.issues.edit).nthCalledWith(1, {
      owner: 'wei', repo: 'fork', number: 12, assignees: ['tom'], labels: ['pull'], body: helper.getPRBody('wei/fork', 12)
    })
    expect(github.issues.edit).nthCalledWith(2, {
      owner: 'wei', repo: 'fork', number: 16, assignees: ['wei'], labels: ['pull'], body: helper.getPRBody('wei/fork', 16)
    })
    expect(github.pullRequests.createReviewRequest).toHaveBeenCalledTimes(2)
    expect(github.pullRequests.createReviewRequest).nthCalledWith(1, {
      owner: 'wei', repo: 'fork', number: 12, reviewers: ['jerry']
    })
    expect(github.pullRequests.createReviewRequest).nthCalledWith(2, {
      owner: 'wei', repo: 'fork', number: 16, reviewers: ['wei']
    })
  })
})

describe('pull - checkAutoMerge', () => {
  test('bad parameters', async () => {
    const pull = getPull()
    expect(await pull.checkAutoMerge()).toBeNull()
  })

  test('should honor autoMerge flag', async () => {
    const pull = getPull()
    await pull.checkAutoMerge({
      number: 10,
      base: { ref: 'master', label: 'wei:master' },
      head: { ref: 'master', label: 'upstream:master' },
      state: 'open',
      user: { login: 'pull[bot]' },
      mergeable: true,
      mergeable_state: 'clean'
    })
    expect(github.pullRequests.get).not.toHaveBeenCalled()
    expect(github.gitdata.updateReference).not.toHaveBeenCalled()

    github.pullRequests.get
      .mockResolvedValueOnce({ data: { mergeable: null, mergeable_state: 'unknown' } })
    setTimeout(() => {
      github.pullRequests.get.mockResolvedValueOnce({ data: { mergeable: true, mergeable_state: 'clean' } })
    }, 500)
    await pull.checkAutoMerge({
      number: 12,
      base: { ref: 'feature/new-1' },
      head: { ref: 'dev', label: 'upstream:dev', sha: 'sha1-placeholder' },
      state: 'open',
      user: { login: 'pull[bot]' },
      mergeable: null,
      mergeable_state: 'unknown'
    })
    expect(github.pullRequests.get).toHaveBeenCalledTimes(2)
    expect(github.pullRequests.get).toHaveBeenCalledWith({ owner: 'wei', repo: 'fork', number: 12 })
    expect(github.pullRequests.merge).toHaveBeenCalledWith({ owner: 'wei', repo: 'fork', number: 12 })
    expect(github.gitdata.updateReference).not.toHaveBeenCalled()

    github.pullRequests.get = jest.fn()
      .mockResolvedValueOnce({ data: { mergeable: null, mergeable_state: 'unknown' } })
    github.pullRequests.merge = jest.fn()
    setTimeout(() => {
      github.pullRequests.get.mockResolvedValueOnce({ data: { mergeable: true, mergeable_state: 'clean' } })
    }, 500)
    await pull.checkAutoMerge({
      number: 16,
      base: { ref: 'hotfix/bug-1' },
      head: { ref: 'dev', label: 'upstream:dev', sha: 'sha1-placeholder' },
      state: 'open',
      user: { login: 'pull[bot]' },
      mergeable: null,
      mergeable_state: 'unknown'
    })
    expect(github.pullRequests.get).not.toHaveBeenCalled()
    expect(github.pullRequests.merge).not.toHaveBeenCalled()
    expect(github.gitdata.updateReference).toHaveBeenCalledWith(
      { owner: 'wei', repo: 'fork', ref: `heads/hotfix/bug-1`, sha: 'sha1-placeholder', force: true }
    )
  })

  test('should not merge if mergablity is null', async () => {
    github.pullRequests.get.mockResolvedValueOnce({ data: { mergeable: null, mergeable_state: 'unknown' } })

    const pull = getPull()
    await pull.checkAutoMerge({
      number: 12,
      base: { ref: 'feature/new-1' },
      head: { ref: 'dev', label: 'upstream:dev', sha: 'sha1-placeholder' },
      state: 'open',
      user: { login: 'pull[bot]' },
      mergeable: null,
      mergeable_state: 'unknown'
    }, { isMergableMaxRetries: 1 })
    expect(github.pullRequests.get).toHaveBeenCalledTimes(1)
    expect(github.pullRequests.get).toHaveBeenCalledWith({ owner: 'wei', repo: 'fork', number: 12 })
    expect(github.gitdata.updateReference).not.toHaveBeenCalled()
  })

  test('should not merge if mergable_status is dirty', async () => {
    github.pullRequests.get.mockResolvedValueOnce({ data: { mergeable: null, mergeable_state: 'unknown' } })
    setTimeout(() => {
      github.pullRequests.get.mockResolvedValue({ data: { mergeable: false, mergeable_state: 'dirty' } })
    }, 500)

    const pull = getPull()
    await pull.checkAutoMerge({
      number: 12,
      base: { ref: 'feature/new-1' },
      head: { ref: 'dev', label: 'upstream:dev', sha: 'sha1-placeholder' },
      state: 'open',
      user: { login: 'pull[bot]' },
      mergeable: null,
      mergeable_state: 'unknown'
    }, { isMergableMaxRetries: 2 })
    expect(github.pullRequests.get).toHaveBeenCalledTimes(2)
    expect(github.pullRequests.get).toHaveBeenCalledWith({ owner: 'wei', repo: 'fork', number: 12 })
    expect(github.gitdata.updateReference).not.toHaveBeenCalled()
  })

  test('hard reset failed', async () => {
    github.pullRequests.get.mockResolvedValueOnce({ data: { mergeable: true, mergeable_state: 'clean' } })
    github.gitdata.updateReference.mockRejectedValue(new Error('Update reference failed'))

    const pull = getPull()
    await pull.checkAutoMerge({
      number: 12,
      base: { ref: 'hotfix/bug-1' },
      head: { ref: 'dev', label: 'upstream:dev', sha: 'sha1-placeholder' },
      state: 'open',
      user: { login: 'pull[bot]' },
      mergeable: null,
      mergeable_state: 'unknown'
    })
    expect(github.pullRequests.get).not.toHaveBeenCalled()
    expect(github.gitdata.updateReference).toHaveBeenCalledWith(
      { owner: 'wei', repo: 'fork', ref: `heads/hotfix/bug-1`, sha: 'sha1-placeholder', force: true }
    )
  })

  test('should handle same repo auto merge', async () => {
    github.pullRequests.get.mockResolvedValueOnce({ data: { mergeable: true, mergeable_state: 'clean' } })
    github.gitdata.updateReference.mockRejectedValue(new Error('Update reference failed'))

    const config = { version: '1', rules: [{ base: 'dev', upstream: 'master', autoMerge: true }] }
    const pull = new Pull(github, { owner: 'wei', repo: 'fork', logger: robot.log }, config)
    await pull.checkAutoMerge({
      number: 16,
      base: { ref: 'dev' },
      head: { ref: 'master', label: 'wei:master', sha: 'sha1-placeholder' },
      state: 'open',
      user: { login: 'pull[bot]' },
      mergeable: null,
      mergeable_state: 'unknown'
    })
    expect(github.pullRequests.get).toHaveBeenCalledTimes(1)
    expect(github.pullRequests.get).toHaveBeenCalledWith({ owner: 'wei', repo: 'fork', number: 16 })
    expect(github.gitdata.updateReference).not.toHaveBeenCalled()
  })
})

describe('pull - misc', () => {
  test('functions with bad parameters', async () => {
    github.pullRequests.get.mockResolvedValueOnce({ data: { mergeable: true, mergeable_state: 'clean' } })

    const pull = getPull()
    await pull.isMergeable(12)
    expect(github.pullRequests.get).toHaveBeenCalledTimes(1)
    await expect(pull.addReviewers()).resolves.toBeNull()
    await expect(pull.addReviewers(12)).resolves.toBeNull()
    await expect(pull.addReviewers(12, [])).resolves.toBeNull()
    await expect(pull.mergePR()).resolves.toBeNull()
    await expect(pull.mergePR(12)).resolves.not.toBeNull()
    await expect(pull.hardResetCommit()).resolves.toBeNull()
    await expect(pull.hardResetCommit('master')).resolves.toBeNull()
    await expect(pull.hardResetCommit('', 'sha1-placeholder')).resolves.toBeNull()
  })
})
