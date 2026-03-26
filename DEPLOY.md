# ローカル開発サーバー

```bash
npm run dev
```

Vite の開発サーバーが起動し、`http://localhost:5173` でアクセスできます。

停止するにはターミナルで `Ctrl+C`。ローカル専用なので放置しても外部からアクセスされることはなく、リソース消費も軽微なため害はありません。

---

# GitHub Pages 反映手順

このプロジェクトは `gh-pages` ブランチに `dist` を公開して、GitHub Pages に配信しています。

## 反映方法（ソース変更後）

以下の順で実行します。

```bash
# 1) 変更をコミット
git add .
git commit -m "変更内容"

# 2) main へ push
git push origin main

# 3) Pages 用の公開ブランチを更新
npm run deploy
```

上記で自動的に以下が行われます。

- `npm run build` で `dist` を再生成
- `dist` の内容を `gh-pages` ブランチへ公開

※ `git push origin main` と `npm run deploy` は別作業です。  
`main` へ push しても自動では Pages 反映されないため、毎回 `npm run deploy` が必要です。

数分後に以下URLへ反映されます。

- <https://daichi-t-star.github.io/memoapp/>

## 注意

- GitHub Pages 側の設定は `gh-pages` / `/ (root)` になっていること
- `vite.config.ts` の `base` は `'/memoapp/'` のままにすること
