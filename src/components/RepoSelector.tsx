import { useRepo } from '../contexts/RepoContext';
import { GitBranch } from 'lucide-react';
import type { ChangeEvent } from 'react';

export function RepoSelector() {
  const {
    repos,
    reposLoading,
    selectedOwner,
    selectedRepo,
    selectRepo,
    selectedBranch,
  } = useRepo();

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (!value) return;
    const repo = repos.find((r) => r.full_name === value);
    if (repo) {
      selectRepo(repo.owner.login, repo.name, repo.default_branch);
    }
  };

  const currentValue =
    selectedOwner && selectedRepo ? `${selectedOwner}/${selectedRepo}` : '';

  const hasCurrentInList =
    currentValue && repos.some((r) => r.full_name === currentValue);

  return (
    <div className="repo-selector">
      <div className="repo-selector-field">
        <GitBranch size={14} />
        <select
          value={currentValue}
          onChange={handleChange}
          disabled={reposLoading}
        >
          <option value="">
            {reposLoading ? 'Loading repos...' : 'Select repository'}
          </option>
          {!hasCurrentInList && currentValue && (
            <option value={currentValue}>{currentValue}</option>
          )}
          {repos.map((r) => (
            <option key={r.full_name} value={r.full_name}>
              {r.full_name}
            </option>
          ))}
        </select>
      </div>
      {selectedBranch && (
        <div className="repo-selector-branch">branch: {selectedBranch}</div>
      )}
    </div>
  );
}
