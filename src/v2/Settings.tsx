import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Github,
  HardDrive,
  LoaderCircle,
  X,
} from "lucide-react";
import { Remote } from "./remote";
import type { Connection, Repository } from "./model";

export function Settings({
  connection,
  token,
  close,
  connect,
}: {
  connection: Connection | null;
  token: string;
  close: () => void;
  connect: (c: Connection | null, t: string) => void;
}) {
  const [input, setInput] = useState(token);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selected, setSelected] = useState("");
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const repo = repos.find((r) => r.full_name === selected);
  async function verify() {
    setBusy(true);
    setError("");
    setUser("");
    setRepos([]);
    try {
      const remote = new Remote(input.trim(), {
        owner: "",
        repo: "",
        branch: "",
      });
      const account = await remote.user();
      const list = await remote.repos();
      setUser(account.login);
      setRepos(list);
      const current = connection
        ? `${connection.owner}/${connection.repo}`
        : "";
      setSelected(list.some((r) => r.full_name === current) ? current : "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-card settings-card">
      <div className="modal-header">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h2>保存先と同期</h2>
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label="設定を閉じる"
        >
          <X size={20} />
        </button>
      </div>
      <div className="storage-option">
        <HardDrive size={22} />
        <div>
          <strong>この端末に自動保存</strong>
          <p>入力した内容は、すぐにブラウザ内に保存されます。</p>
        </div>
        <Check size={17} />
      </div>
      <div className="connection-details">
        <Github size={22} />
        <div>
          <strong>GitHubと同期</strong>
          <p>
            {connection
              ? `${connection.owner}/${connection.repo} · ${connection.branch}`
              : "ほかの端末でも、いつものメモを。"}
          </p>
        </div>
      </div>
      <p className="help-text">
        以前と同じリポジトリを選ぶと、既存のメモを取り込めます。元のファイルは残ります。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify();
        }}
      >
        <label htmlFor="github-token">アクセストークン</label>
        <input
          id="github-token"
          type="password"
          autoComplete="off"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setUser("");
            setRepos([]);
          }}
          placeholder="GitHub Personal Access Token"
        />
        <p className="help-text">
          選択するリポジトリの Contents
          読み書き権限が必要です。トークンはこのブラウザに保存されます。
        </p>
        <button
          className="button secondary full"
          disabled={!input.trim() || busy}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Github size={16} />
          )}
          接続先を確認
        </button>
      </form>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {user && (
        <div className="repo-picker">
          <p className="verified">
            <Check size={15} />
            {user} として接続
          </p>
          <label htmlFor="repository">メモの保存先</label>
          <select
            id="repository"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">リポジトリを選択</option>
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.full_name} {r.private ? "（非公開）" : "（公開）"}
              </option>
            ))}
          </select>
          {repo && (
            <p className="help-text">
              {repo.private
                ? "非公開リポジトリに保存します。"
                : "公開リポジトリです。同期したメモや添付は誰でも閲覧できます。"}{" "}
              この端末専用のメモは、この保存先に自動では移動しません。
            </p>
          )}
          <button
            className="button primary full"
            disabled={!repo}
            onClick={() => {
              if (repo)
                connect(
                  {
                    owner: repo.owner.login,
                    repo: repo.name,
                    branch: repo.default_branch,
                  },
                  input.trim(),
                );
            }}
          >
            この保存先を使う
          </button>
        </div>
      )}
      <a
        className="text-link"
        href="https://github.com/settings/personal-access-tokens/new"
        target="_blank"
        rel="noreferrer"
      >
        トークンを作成する
        <ArrowUpRight size={14} />
      </a>
      {connection && (
        <button
          className="button secondary full local-switch"
          onClick={() => connect(null, token)}
        >
          <HardDrive size={16} />
          この端末専用のメモへ切り替え
        </button>
      )}
      {token && (
        <button className="text-button full" onClick={() => connect(null, "")}>
          GitHubから接続解除
        </button>
      )}
    </div>
  );
}
