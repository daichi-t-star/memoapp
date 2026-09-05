import { useEffect, useState } from "react";
import {
  Download,
  FileText,
  LoaderCircle,
  RotateCcw,
  X,
  ImageOff,
} from "lucide-react";
import { getBlob, putBlob } from "./db";
import { isImage, formatSize, type Attachment } from "./model";
import type { Remote } from "./remote";
import { download } from "./backup";

export function AttachmentView({
  attachment: a,
  scope,
  remote,
  remove,
  preview,
  ready,
}: {
  attachment: Attachment;
  ready: boolean;
  scope: string;
  remote: Remote | null;
  remove?: () => void;
  preview: (url: string, name: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [blob, setBlob] = useState<Blob>();
  const [busy, setBusy] = useState(false);
  const image = isImage(a);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setUrl("");
    setError("");
    setBlob(undefined);
    // Only images are loaded on opening a note. Other files load when requested.
    if (!image) return;
    setBusy(true);
    if (!ready) return;
    if (a.external) {
      setUrl(a.path);
      return;
    }
    setBusy(true);
    (async () => {
      let data = await getBlob(scope, a.path);
      if (!data) {
        if (!remote)
          throw new Error("画像の取得にはGitHubへの接続が必要です。");
        data = await remote.blob(a.path);
        await putBlob(scope, a.path, data);
      }
      objectUrl = URL.createObjectURL(new Blob([data], { type: a.type }));
      if (!cancelled) {
        setUrl(objectUrl);
        setBlob(data);
      } else URL.revokeObjectURL(objectUrl);
    })()
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [a.path, a.type, a.external, image, remote, scope, retry, ready]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (a.external) {
        window.open(a.path, "_blank", "noopener,noreferrer");
        return;
      }
      let data = blob || (await getBlob(scope, a.path));
      if (!data) {
        if (!remote)
          throw new Error("ファイルの取得にはGitHubへの接続が必要です。");
        data = await remote.blob(a.path);
        await putBlob(scope, a.path, data);
      }
      download(new Blob([data], { type: a.type }), a.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`attachment ${image ? "attachment-image" : ""}`}>
      {image &&
        (url && !error ? (
          <button
            className="image-preview"
            onClick={() => preview(url, a.name)}
            aria-label={`${a.name}を拡大`}
          >
            <img
              src={url}
              alt={a.name}
              loading="lazy"
              onError={() =>
                setError(
                  "画像を表示できません。再試行またはダウンロードしてください。",
                )
              }
            />
          </button>
        ) : (
          <div className="image-placeholder">
            {busy ? <LoaderCircle className="spin" /> : <ImageOff />}
            <span>{busy ? "画像を読み込み中" : "画像を読み込めません"}</span>
          </div>
        ))}
      <div className="attachment-info">
        {!image && (
          <span className="file-icon">
            <FileText size={21} />
          </span>
        )}
        <div>
          <strong title={a.name}>{a.name}</strong>
          <span>{formatSize(a.size)}</span>
        </div>
        <button
          className="icon-button"
          title="ダウンロード"
          aria-label={`${a.name}をダウンロード`}
          disabled={busy || !ready}
          onClick={save}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Download size={16} />
          )}
        </button>
        {remove && (
          <button
            className="icon-button"
            onClick={remove}
            aria-label={`${a.name}の添付を外す`}
            title="添付を外す"
          >
            <X size={15} />
          </button>
        )}
      </div>
      {error && (
        <div className="attachment-error" role="alert">
          {error}
          <button onClick={() => (image ? setRetry((n) => n + 1) : save())}>
            <RotateCcw size={13} />
            再試行
          </button>
        </div>
      )}
    </div>
  );
}
